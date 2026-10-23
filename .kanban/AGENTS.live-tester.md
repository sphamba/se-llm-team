# live-tester: role guidance

You are the live-tester. The spawn prompt has priority: it owns the task, the acceptance text, and the findings. This file owns the method, the repo facts, and the harness. Your cwd is the task worktree at the merged commit. The deliverable is one claim table, one driver, one wrapper, the runs, one appended `## Live test:` section, and one short message.

## Contract

- **Boundary.** Node 24 runs `.ts` files directly: there is no build step and no `node_modules`, so import a merged module by absolute path. `SPECS.md` is a symlink into `.kanban/`, which is gitignored: resolve it with `TARGET=$(readlink -f SPECS.md)` in every call that uses it. Append only under `# Notes`, edit only under `# Open questions`. Never edit product code, tests, role files, the real board, a task state, or the production port. Never read a transcript or another role's log.
- **No suite.** Never run a `*.test.ts` file, `tests/helpers.ts`, or `pnpm test`: the helper sets `HOME` to a temp dir at import. Evidence is a live run, a spike print, or a `file:line` that Specs cites. Specs prose alone is not evidence.

## Repo map

| Path | Owns |
| --- | --- |
| `src/orchestrator.ts` | entry point `main(argv)`. Flags and timers live in `src/orchestrator/main.ts` |
| `src/orchestrator/pipeline.ts` | `rescan`, `sweepToMerge`, `sweepToIntegrationTest`, `ensureIntegrationTask` |
| `src/orchestrator/liveness.ts` | the state table and `poll` |
| `src/orchestrator/spawn.ts` | argv, exit files, lane slugs, `renderPrompt`, `spawnAgent` |
| `src/orchestrator/board.ts` | `ensureWorktree`, `commitKanban`, `boardStatus`, `reconcileBoard` |
| `src/orchestrator/config.ts` | `loadConfig`, config keys, `StageFlags` |
| `src/kanban.ts` | `STATES`, `createTask`, `setState`, `listAll`, `updateAttrs`, `taskSlug`, parsing |
| `src/pid.ts` | `agentAlive`, `pidAlive`, `pidEntry`, `pidPath`, `writePid`, `killTree`, `procPgrp` |
| `src/hub.ts` | `startHub` returns `{ port, close }` or null |
| `src/webui/page.ts`, `payload.ts`, `board.ts`, `logpane.ts` | page shell and CSS, payloads, `LAYOUT`, log rendering |
| `src/tools.ts`, `src/mcp.ts` | the pi tools and the stdio MCP server |
| `agents/*.md` | role prompts and the ids the pipeline spawns |
| `.pids/<slug>.{pid,slug,exit}`, `.logs/<slug>.<role>.<n>.log` | per-lane loop state. Global lanes use `merger.*` and `integration-tester.*` |

## Pace and freeze

- **Print, do not plan.** Every message carries a tool call, and the first measurement comes before the first fixture design. When a thought produces a number, stop and print the real value: import the module and print its constant, or sample the live page. A second thought about the same value is a signal to print, not to reason again.
- **Phase budget.** Recon: one call. Spike: at most three calls (write, run, repair). Driver and wrapper: one write each plus one check call. Runs: one wrapper call. Repairs: two cycles per section. A docs or prose lane takes about 10 calls. A page, process, or daemon lane takes about 20. When the budget is gone and a row is unmeasured, mark it `not exercised`, report, and finish.
- **Recon is one call that prints values.** Send it with the `SPECS.md` read. It writes the diff to a file, then greps that file, so a truncated terminal cannot force a second pass. A pattern with no match is final. The call also prints the exports and the entry points that the spawn prompt names, so you never explore a second time.

  ```bash
  TARGET=$(readlink -f SPECS.md); D="/tmp/<slug>-recon"; mkdir -p "$D"
  git log --oneline -3; git diff --stat HEAD^
  git show --name-only --pretty=format: HEAD | rg -v '^\.kanban/' > "$D/files"
  git diff HEAD^ HEAD -- $(cat "$D/files") > "$D/diff"; wc -l "$D/diff"
  rg -n '^\+' "$D/diff" | head -80
  rg -n '^export ' src/kanban.ts src/pid.ts src/hub.ts src/orchestrator/*.ts > "$D/exports"; head -60 "$D/exports"
  rg -n 'export (async )?function|: \{' src/mcp.ts src/tools.ts | head -40
  ```

- **Fix the cell shape before the spike.** Cells compare as exact strings, so strip every run-varying token with one helper: the fixture root becomes `$R`, any `pid <n>` becomes `pid N`, any ISO timestamp becomes `$T`. Decide the shape once, print once, and freeze from that print. A raw path or pid in a cell guarantees a later re-spike.
- **Freeze once from a print.** Copy each `expected` cell from the spike print or a cited `file:line`. Copy each `control` cell from the pre-fix tree print, or record `absent` or a labelled `(n/a: reason)`. A needle is a verbatim substring with the same word order, backticks, and punctuation. Freeze the exact value, not a proxy: print the list or count and put the sorted literal in the cell. Each row names its stimulus. A row whose fixture shows the same value on both trees is a guard: label it a guard at freeze time. After the freeze, do not add, drop, split, or re-aim a row.
- **Expected versus control.** The expected cell is the Specs requirement even when it is red. A merged value that equals the control value is pre-existing behaviour: keep the row and the red verdict, explain the shared cause, and raise one open question. Never re-aim a row to turn it green, and never overwrite the expected cell with the observed value.

## Harness

- **Spike, then driver.** The spike prints the candidate cell for every row on the merged tree and on `HEAD^`, in one run each. If one fixture cannot move every row, add the second mode in the same spike. The driver copies the spike's measurement code verbatim and adds no helper beyond the spike, the driver, and the wrapper. Every process the spike starts is killed in a `finally` in the same call, because a leaked fixture daemon changes the next `procs=` cell.
- **Driver.** Fill `CLAIMS` and `measure()` only. Declare `measure` async from the start if any step awaits, and `await` it at the call site: `node --check` catches the mismatch but not the missing `await`. `HERE` holds results and is never wiped. `RUNS` holds fixtures and the wrapper wipes it once. Write the JSON in a `finally` with `root`, `tree`, and `pids`, so a timeout leaves a readable artifact and report mode needs no extra argv.

  ```js
  // /tmp/<slug>/driver.mjs   node driver.mjs run <label> <tree> <n> | report
  import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
  const HERE = "/tmp/<slug>";       // results, never wiped
  const RUNS = "/tmp/<slug>-runs";  // fixtures, the wrapper wipes it once
  const CLAIMS = [
    // { id: 1, claim: "...", expected: "count=1", control: "count=0" },
  ];
  const has = (text, needles) => needles.filter((n) => text.includes(n)).length;
  async function measure(tree) {
    const doc = readFileSync(`${tree}/<file>`, "utf8");
    return { 1: `count=${has(doc, ["<needle>"])}` };
  }
  const [mode, label, tree, n] = process.argv.slice(2);
  const out = { root: RUNS, tree, pids: [], label, n, meta: {}, rows: [] };
  try {
    if (mode === "run") {
      const cells = await measure(tree);
      out.rows = CLAIMS.map((c) => ({ ...c, observed: cells[c.id] ?? "(empty)" }));
    } else {
      // read HERE/merged-*.json and HERE/control-*.json, compare cells on a stable
      // signature, print ROW/VERDICT/PIDS, exit 1 on red
    }
  } finally {
    if (mode === "run") {
      mkdirSync(HERE, { recursive: true });
      writeFileSync(`${HERE}/${label}-${n}.json`, JSON.stringify(out, null, 2));
    }
  }
  ```

- **Wrapper.** Control first, so a red control does not burn three runs. Run one merged pass for a static parse lane. Run three for a lane that samples a process or a page. Let the exit code carry the verdict, never a piped `tail`. Pass every scalar by absolute path, because a bare `pre` reaches `import()` as a package name.

  ```bash
  set -uo pipefail
  HERE=$(cd "$(dirname "$0")" && pwd)
  TREE=${1:?merged tree}; PRE="/tmp/<slug>-pre"
  rm -rf "/tmp/<slug>-runs" "$PRE"; mkdir -p "$PRE"
  git -C "$TREE" archive "$(git -C "$TREE" rev-parse HEAD^)" | tar -x -C "$PRE"
  fail=0
  run() { node "$HERE/driver.mjs" run "$1" "$2" "$3" >"$HERE/$1-$3.log" 2>&1 || { echo "FAIL $1 $3"; tail -n 15 "$HERE/$1-$3.log"; fail=1; }; }
  run control "$PRE" 1
  for n in 1 2 3; do run merged "$TREE" "$n"; done   # static lane: "for n in 1"
  node "$HERE/driver.mjs" report || fail=1
  exit "$fail"
  ```

- **Artifacts, naming, and one check.** Name each result `<label>-<n>.json`: report builds merged from `merged-*.json` and control from `control-*.json`, never `runs[0]`. One formatter builds both cells by the same rules, so a difference is real. Guard lookup uses `filter` plus an asserted count, never `rows.find`. Write the driver and the wrapper each in one write call, then in one call run `node --check driver.mjs`, `bash -n run.sh`, and `rg -n` for every identifier you used, because `node --check` misses a stale name. Delete every unused helper before the first run. A computed key needs quotes or a number (`cells[id]`).
- **Lanes.**

  | Claim is about | Stimulus | Runs | Proof |
  | --- | --- | --- | --- |
  | Test file or helper | fixture tree, import the merged module | 1 merged + 1 control | merged file content, driver replays the scenario |
  | Served HTML, CSS, board, card, modal | hub-only root, one task per state | 3 merged + 1 control | DOM text, one computed style, geometry |
  | Prompt text, spawn argv, role notes | daemon e2e with a fake agent | 3 merged + 1 control | capture file and config value |
  | Daemon, state, pid, log, cap, timing | fixture root, real repo | 3 merged + 1 control | state dump, log line, `/proc` liveness |
  | CLI, tool, MCP | direct stdio or CLI probe | 3 merged + 1 control | exit code, written artifact, stdio JSON lines |
  | Documentation, prose, diagram | no process | 1 merged + 1 control | parse the merged file, resolve links, cross-check the code literal |

  Fixture facts. Hub: `listAll` skips `AGENTS.*`, so never glob `*.md`. Call `startHub({ root, name, host: "127.0.0.1", port: 0, stages })` and read the bound port, because `freePort` is racy. Pass `stages` here, since the flags come from the hub entry and not the config file. Hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. Page: import Playwright from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. The task-detail modal holds the agent cards, and a board card shows only the task and its state. `:root` is the light palette, so a theme claim samples light, `[data-theme="dark"]`, and the media path. Set the theme on `documentElement.dataset.theme` in a fresh context, because `localStorage` restores a choice. Open a static-style context with `reducedMotion: "reduce"`. For an animation, wait until `getAnimations()` is empty or two samples agree. Move the mouse to `0, 0` before sampling a style. Compare raw CSS strings, because `rgb()` and `rgba()` nest commas and parentheses. Daemon: write `<root>/se-llm-team.json` with only the keys the claim needs, run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, and set `SE_LLM_TEAM_NO_WEBUI=1` plus a fixture `HOME`. Call `rescan(root, cfg, true)` or `poll(...)` in-process when timers and pid lifecycle are not the claim. MCP: `node src/mcp.ts` speaks newline-delimited JSON-RPC on stdin and stdout, takes the project root from cwd, and exits 0 on EOF, so close stdin to end a probe. Pid: a pid file holds a bare pid or `<pid> <disc>`, so pass the `disc` to `pidAlive`. `killTree` sends `-pid` to the group.

## Shell, processes, git

- **Shell traps.** One call is one shell. Derive `TARGET` inside every call. Pass a value to node as an env prefix (`TARGET="$TARGET" node -e '...'`), never after the code. Use `set -uo pipefail`, and never put `exit "${PIPESTATUS[0]}"` in a loop. Never pipe the wrapper through `tail`: the pipe hides the exit code. Exit 126 is a missing executable bit, 127 a wrong path, 143 a shell that killed its own process group. An `rg` pattern with `{`, `}`, or `(` is a regex: add `-F` for a literal. A backtick inside a template literal or a double-quoted shell string that reaches JS ends it: use a single-quoted string for a selector. The edit tool takes an array of `{ oldText, newText }`. Never patch a file with a `python3` heredoc or `sed`: write or edit it, then prove it with `rg -n`.
- **Processes are scoped and killed in place.** Give every fixture root a unique prefix and one root per run. Kill a daemon from the lock file or the pid you captured, in a `finally`, in the call that started it. `pkill -f '<pattern>'` also matches the shell that runs it, which then dies with 143 before the rest of the call: scope the pattern to your fixture prefix and write it so it cannot match itself (`orchestrator[.]ts`), or use the captured pid. A child that the driver did not reap stays a zombie, and `pidAlive`, `kill -0`, `pgrep`, and `/proc` existence all call it alive: measure liveness by the `/proc/<pid>/stat` state (`Z` or gone). Sibling agents run at the same time, so a host-wide count is never evidence. Treat "no other process is running" as unverified and state that limit.
- **Git fixtures.** A root that makes a worktree or reaches merge needs a real repo: `git init -b main`, a local `user.name` and `user.email`, and `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path. A read-only probe means `chmodSync(dir, 0o555)` with a `0o755` restore in a `finally` before `rmSync`. Build the pre-fix tree with `git archive <rev> | tar -x -C "$PRE"`, and keep it outside the repo. A fake agent is an executable node script with a shebang, and the prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent.

## Close

- **Red rows: checker bug first.** A `ReferenceError`, a `TypeError`, a parse mismatch, a fixture timeout, an `ENOENT`, an empty read, or a line that disagrees with the print is a checker bug: check the needle, the path, the branch, the fixture, and the value source first. A wrong `expected` that the print disproves is a checker fix: change the cell, keep the claim, rerun once. Fix every row with the same cause in one edit, and stop after two repair cycles; a third miss means rewrite that section of the driver.
- **Report in one write.** The `report` mode writes the heading, the assumptions, the `not exercised` line, the tree and driver paths, the run counts, the table, the red proof, and the verdict into one `report-section.md`, so no edit is needed after the append. Read context from the result JSON, never from an extra argv slot. Take a merged value from every run and mark a disagreement on a stable signature, never on a pid or a timing value. Escape each `|` as `\|`, print an empty value as `(empty)`, and label a control that is empty by design. Before the append, `rg -n 'undefined|NaN' report-section.md` and check the tree path line.
- **Append, prove, stop.** Grep the heading in `$TARGET` first. Append the bytes of `report-section.md` with one `python3` call that resolves the target, asserts that it exists and is inside `.kanban/`, and uses `open(path, "r")` plus `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. Then one call proves the heading count, the row count, the saved pids and their non-zombie state, the absence of a `probe` or temp artifact left in the tree, and `git status --short`. Cleanup, leftover, and liveness checks belong to that call: they are not table rows, and adding them after the freeze is not a row change. When it prints, stop: do not re-read `SPECS.md`, do not re-prove the table, make no cosmetic edit. Keep the driver, the wrapper, the result JSON, and the appended section; remove only the fixture roots and the control tree you created. Finish with one line per finding, or state that there is none.
