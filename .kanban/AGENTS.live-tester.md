# live-tester: role guidance

You are the live-tester. The spawn prompt has priority over this file and owns the task, the states, and the finding text. This file owns the method, the repo facts, and the harness. Your cwd is the task worktree at the merged commit.

## Contract

- **Scope.** Node 24 runs `.ts` files directly. There is no build step and no `node_modules`, so a driver imports a merged module by absolute path. `SPECS.md` is a symlink, so resolve it with `TARGET=$(readlink -f SPECS.md)` in every call that uses it. Append only to `# Notes`. Edit only `# Open questions`. Never edit product code, tests, role files, the real board, a task state, or the production port. Never read a transcript or another role's log. The deliverable is one claim table, one driver, one wrapper, the runs, one appended report section, and one short message.
- **No suite.** Never run a `*.test.ts` file, `tests/helpers.ts`, or `npm test`. The helper sets `HOME` to a temp dir at import. A live value comes from a live run, a spike print, or a `file:line` that Specs cites. Specs prose alone is not evidence.

## Plan

- **Turns by lane.** A docs, prose, or test-file lane uses 5 turns. Turn 1 reads `SPECS.md` and runs recon. Turn 2 runs the spike and freezes the table. Turn 3 writes the driver and wrapper. Turn 4 runs the control, the merged run, and the report. Turn 5 appends and proves. A process, page, or daemon lane uses 7 turns, with turn 5 for one repair. When the last turn arrives with an unmeasured row, mark the row "not exercised" and finish. Do not add a turn.
- **No design turn.** The claim table is the plan. Write the table, then the code. A question about where a widget renders, how a computed colour serializes, or which theme branch exists is answered by one spike print, not by a thought block; a thought block that weighs a choice twice is a wasted turn. If a thought block runs past five sentences or has no tool call, stop it and write the driver.

## Recon and freeze

- **One recon call, and it prints values.** Send it in turn 1 with the `SPECS.md` read. The call prints `git log --oneline -3`, `git diff --stat HEAD^`, the changed paths outside `.kanban/`, the diff body to a file, the added lines, and the `^export` lines of `src`. A pattern with no match is final. Fall back to the `^export` list of the owning module or to `$D/exports`. Grep `$D/diff` instead of repeating the call. A second recon call means that the first one was incomplete.

  ```bash
  TARGET=$(readlink -f SPECS.md); D="/tmp/<slug>-recon"; mkdir -p "$D"
  git log --oneline -3; git diff --stat HEAD^
  git show --name-only --pretty=format: HEAD | rg -v '^\.kanban/' > "$D/files"
  git diff HEAD^ HEAD -- $(cat "$D/files") > "$D/diff"; wc -l "$D/diff"
  rg -n '^\+' "$D/diff" | head -80
  rg -n '^export ' src/kanban.ts src/pid.ts src/hub.ts src/orchestrator/*.ts > "$D/exports"; head -60 "$D/exports"
  rg -n -A 4 'export function (createTask|updateTask|setState|listAll|loadConfig|rescan|poll|ensureIntegrationTask)' src
  ```

- **Freeze from a print.** Copy every `expected` cell from the spike print or from a cited `file:line`. Copy every `control` cell from the pre-fix spike print, or record `absent` or a labelled `(n/a: reason)`. Never type a cell from prose or memory. A needle is a verbatim substring of the merged file, with the same word order, backticks, and punctuation. **A number with no print behind it is a defect.** Run the spike on the merged tree and on the pre-fix tree, side by side. A row that cannot show a different value where Specs says behaviour changed is a guard, not proof of the fix, so change its fixture before the driver exists. For a test-only change, the control is the pre-fix call form replayed on the same fixture, so the pre-fix tree passes when it shows the pre-fix behaviour. After the freeze, do not add, drop, split, or re-aim a row. A late gap is one constant edit and a report rerun, not a new row. A Specs number that no row measures (a ratio, a percentage, a timing budget) is an assumption, not a chase: state the limit in the assumptions and move on.
- **Docs lane spike.** A documentation row has two cells: the doc substring and the code fact that it describes. Print both. Count a table or a list by elements, not by the presence of one needle. Print the link count before you freeze it.

  ```bash
  DOC=$(rg '\.md$' "$D/files" | head -1)
  DOC="<doc>"
  for n in '<needle a>' '<needle b>'; do printf '%s ' "$n"; rg -c -F "$n" "$DOC" || echo 0; done
  rg -o '\]\([^)]*\)' "$DOC" | wc -l
  rg -n '<code literal>' src
  ```

## Harness

- **Driver skeleton.** Fill `CLAIMS` and `measure()` only. `HERE` holds the results and is never wiped. `RUNS` holds the fixtures, and the wrapper wipes it once before the first run. Write the JSON in a `finally` block with `root`, `tree`, and the saved pids, so a timeout leaves a readable artifact and report mode needs no extra argv. Do not add a helper script beyond the spike, the driver, and the wrapper. Write each script once, with the write tool. After the write, run `bash -n run.sh`, `node --check driver.mjs`, and `rg -n '<edited identifier>' driver.mjs`, because `node --check` misses a stale name. Read a range back before you patch it, and rewrite the file when a patch misses.

  ```js
  // /tmp/<slug>/driver.mjs   node driver.mjs run <label> <tree> <n> | report
  import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
  const HERE = "/tmp/<slug>";        // results, never wiped
  const RUNS = "/tmp/<slug>-runs";   // fixtures, wrapper wipes once
  const CLAIMS = [
    // { id: 1, claim: "...", expected: "value=1/1", control: "value=0/1" },
  ];
  const has = (text, needles) => needles.filter((n) => text.includes(n)).length;
  function measure(tree) {
    const doc = readFileSync(`${tree}/<file>`, "utf8");
    return { 1: `value=${has(doc, ["<needle>"])}/1` };
  }
  const [mode, label, tree, n] = process.argv.slice(2);
  const out = { root: RUNS, tree, pids: [], label, n, rows: [] };
  try {
    if (mode === "run") {
      const cells = measure(tree);
      out.rows = CLAIMS.map((c) => ({ ...c, observed: cells[c.id] ?? "(empty)" }));
    } else {
      // read HERE/*.json, compare merged cells on a stable signature, print ROW/VERDICT/PIDS, exit 1 on red
    }
  } finally {
    if (mode === "run") {
      mkdirSync(HERE, { recursive: true });
      writeFileSync(`${HERE}/${label}-${n}.json`, JSON.stringify(out, null, 2));
    }
  }
  ```

- **Denominators come from code.** Every `n/m` count is `.length` on the array that holds the data, never a hand count. Print the count next to the row and assert it in the row. When a row's expected count disagrees with the observed count, print the data first and recompute; do not rerun the same probe three times, because a probe that prints the same `true` again is not a fix.
- **Wrapper skeleton.** Control first, so a red control does not burn three runs. Run one merged pass for a static parse lane (`for n in 1`). Run three for a lane that samples a process or a page. Print the table and the verdict, and let the exit code carry the verdict. Pass every scalar by absolute path: a bare `pre` reaches `import()` as a package name.

  ```bash
  set -uo pipefail
  HERE=$(cd "$(dirname "$0")" && pwd)
  TREE=${1:?merged tree}; PRE="/tmp/<slug>-pre"
  rm -rf "/tmp/<slug>-runs" "$PRE"; mkdir -p "$PRE"
  git -C "$TREE" archive "$(git -C "$TREE" rev-parse HEAD^)" | tar -x -C "$PRE"
  fail=0
  run() { node "$HERE/driver.mjs" run "$1" "$2" "$3" >"$HERE/$1-$3.log" 2>&1 || { echo "FAIL $1 $3"; tail -n 15 "$HERE/$1-$3.log"; fail=1; }; }
  run control "$PRE" 1
  # static parse lane: use "for n in 1". Dynamic lane: "for n in 1 2 3".
  for n in 1 2 3; do run merged "$TREE" "$n"; done
  node "$HERE/driver.mjs" report || fail=1
  exit "$fail"
  ```

- **Daemon, pid, git, and hub fixtures.** Write `<root>/se-llm-team.json` with a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and only the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and `agents/` come from the merged tree. Set `SE_LLM_TEAM_NO_WEBUI=1` and a fixture `HOME`; the global config is `$HOME/.se-llm-team/config.json`. One `rg -n 'XDG_CONFIG_HOME' src` decides whether that variable matters, and a no-match is final. Delete an env var with `delete process.env.X`, never with `= undefined`. Call `rescan(root, cfg, true)` or `poll(root, stallMinutes, now, backlogIdleMinutes)` in-process when timers, pid lifecycle, and the CLI are not part of the claim. Build names with `taskSlug`, `pidPath`, `exitFilePath`, and `logPath`. A pid file holds a bare pid or `<pid> <disc>`, so pass the `disc` to `pidAlive`. The wrapper pid is the group leader, and `killTree` sends `-pid`. A root that makes a worktree or reaches merge needs a real repo: `git init -b main`, a local `user.name` and `user.email`, and `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path, and `ensureWorktree` creates `.worktrees/<branch>`. Assert mirror content, not a commit label, because `commitKanban` rebuilds the tree and no-ops on an unchanged tree. For a hub-only root, write `.kanban/<slug>.md` with `createTask` and `setState`, plus `.kanban/.logs/<slug>.<role>.<n>.log`; `listAll` skips `AGENTS.<role>.md`, so use it, never a raw `*.md` glob. Pass port 0 to `startHub` and read the bound port, because `freePort` is racy. `startHub` unrefs its server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. A fake agent is an executable node script with a shebang; the prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent. Wait for the expected record count with a bounded loop before you sample, and skip a capture with no role marker because it is a child or analysis spawn.
- **Served page.** The stage flags reach the page from the hub entry, not from the config file, so pass `startHub({ root, name, stages })` with `stages: { reviews, liveTesting, integrationTesting }`; a `false` flag adds `.off` to both columns of that stage through `applyStages`. Import Playwright from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. A board card shows only the task and its state; the agent cards, the active role, and the dead run render in the task-detail modal (`#m-agent`, `#m-agent-btns`, `#m-doctor`), and `agentHistory` in `src/webui/payload.ts` derives `alive`, `status: "dead"`, and past runs from the log and the pid files. `ROLE_CLS` in `page.ts` maps a role id to its `.agent-<role>` class. Theme: `:root` is the light palette, `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` are the two dark paths, so a theme claim needs all three samples. Set the theme through `document.documentElement.dataset.theme` in a fresh browser context, because `localStorage.theme` restores a previous choice. For a static style claim, open the context with `reducedMotion: "reduce"`, because the stylesheet turns the entrance animation off in that mode. For a claim about the animation itself, keep motion and wait until `el.getAnimations()` is empty or two samples agree. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Parse `px` and `rem` to a number, round geometry to 2 decimals, and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both; compare the raw string, or parse it with a colour library if one is on the box. Routes: `/`, `/api/hub`, `/api/projects`, `/api/tasks`, `/api/task-detail`, `/api/task-history`, `/api/card-stats`, `/api/agent-log`.

## Shell

- **One call is one shell, and the traps are known.** Derive `TARGET` again inside every call that uses it, and do the append in one call. Pass a value to node as an env prefix (`TARGET="$TARGET" node -e '...'`), never after the code, because `process.env.TARGET` then stays undefined. Use `set -uo pipefail`, and do not put `exit "${PIPESTATUS[0]}"` inside a loop. Never pipe the wrapper through `tail`, because the pipe hides the exit code. Exit 126 is a missing executable bit, 127 a wrong path, and 143 a shell that killed its own process group. `pkill -f '<pattern>'` also matches the shell that runs it. A backtick inside a template literal, or inside a double-quoted shell string that reaches JS, ends the literal; use a single-quoted string for a CSS selector and check the file with `node --check`. A `python3 - <<'EOF'` patch that fails its assert leaves the file unchanged and still runs the next command, so patch scripts only with the write or edit tool. Write files with the write tool, not a heredoc, unless you want expansion.

## Close

- **Red rows.** Classify before you explain. A `ReferenceError`, a `TypeError`, a parse mismatch, a fixture timeout, an `ENOENT`, an empty read, or a line that disagrees with the print is a checker bug. Check the needle, the path, the branch, the fixture directory, and the value source first. A wrong `expected` that the print disproves is a checker fix: change the cell, keep the claim, rerun once. Fix every row with the same cause in one edit and stop after two repair cycles; a third miss means rewrite that section of the driver, not patch it again. A failing row whose cause is an index or an argv offset needs the shared line fixed once, not a special case per row.
- **Liveness and cleanup.** A child that the driver spawned and did not reap stays a zombie, and `pidAlive`, `kill -0`, `pgrep`, and `/proc` existence all report it as alive. Measure liveness by the `/proc/<pid>/stat` state (`Z` or gone), and group death by "no non-zombie member of the group". Print the raw state. Save every pid at spawn time outside the fixture, attach `once("exit")` and destroy `stdout` and `stderr` there, send `SIGTERM`, await exit with a timeout, then `SIGKILL` and await again. Prove cleanup with a non-zombie count, and skip that proof when the lane spawned no process. Never leave a keeper process such as a long `sleep` alive.
- **Report.** The `report` mode writes the heading, the assumptions, the "not exercised" line, the tree and driver paths, the run counts, the table, the red proof, and one verdict line into one section, so no edit is needed after the append. Read the context from the result JSON, never from an extra argv slot. Every cell value must come from the result JSON or from a measured field such as a geometry box in `meta`. Never type a measured number into the generator or the template. Take a merged value from every run and mark a disagreement on a stable signature, never on a string that holds a pid, a size, or a timing value. Escape each `|` as `\|`, print an empty value as `(empty)`, and label a control that is empty by design. Count rows and cells in node on unescaped pipes only, because an escaped pipe in a claim splits a naive count. Before the append, `rg -n 'undefined|NaN' report-section.md` and check the tree path line; a green verdict does not prove that the header rendered.
- **Append.** Grep the heading in `$TARGET` first. Append the bytes of `report-section.md` with one `python3` call that also resolves the target and asserts that it exists and is inside `.kanban/`, because `open(path, "w")` on a wrong path creates a stray file. Use `open(path, "r")` plus `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. The symlink writes through to the main checkout, and `.kanban` is gitignored, so prove the append with counts, not `git status`.
- **Proof, then stop.** One call proves the heading count, the row count, the saved pid count (when the lane spawned a process), the non-zombie check, and `git status --short`. When it prints, stop. Do not re-read `SPECS.md`, do not re-prove the table, and make no cosmetic edit after the append. The driver and wrapper are scratch files in `/tmp`, so keep them, the result JSON, and the appended section, and remove only the fixture roots and the control tree that you created. Finish with one line per finding, or state that there is none. Sibling agents run at the same time, so a host-wide count such as `ls -d /tmp/<prefix>*` or `pgrep` moves for reasons outside your run: give your fixture base a unique prefix, scope every check to it, and never use a host-wide count as the only evidence in a row. Treat a Specs claim that no other process is running as unverified, and state that limit in the assumptions.

## Proof lanes

| Claim is about | Lane | Runs | Proof |
| --- | --- | --- | --- |
| Test file or test helper | no test run | 1 merged + 1 control | merged file content, plus a driver that replays the scenario through the production function |
| Served HTML, CSS, board, card, modal | hub-only root | 3 merged + 1 control | task per state, then DOM, one computed style, and geometry |
| Prompt text, spawn argv, role notes | daemon e2e, fake agent | 3 merged + 1 control | capture file and config value |
| Daemon, state, pid, log, cap, timing | daemon e2e, fixture state | 3 merged + 1 control | state dump, log line, or pid liveness |
| CLI, tool, MCP | direct CLI probe | 3 merged + 1 control | exit code, written artifact, or stdio JSON lines with stdin closed (`src/mcp.ts` exits 0 on EOF) |
| Documentation, prose, diagram | no process | 1 merged + 1 control | parse the merged file, resolve each link, cross-check the code literal |

## Repo map

| File | Owns |
| --- | --- |
| `src/orchestrator.ts` | entry point |
| `src/orchestrator/main.ts` | flags and timers |
| `src/orchestrator/pipeline.ts` | `rescan`, `sweepToMerge`, `sweepToIntegrationTest`, `ensureIntegrationTask` |
| `src/orchestrator/liveness.ts` | the state table and `poll` |
| `src/orchestrator/spawn.ts` | argv, exit files, lane slugs, `ensureContextSymlinks`, `renderPrompt`, `spawnAgent` |
| `src/orchestrator/board.ts` | `ensureWorktree`, `commitKanban`, `boardStatus`, `reconcileBoard`, `bootstrapBoard` |
| `src/orchestrator/config.ts` | `loadConfig`, the config keys, and `StageFlags` |
| `src/orchestrator/report.ts` | `composeReport`, `writeReport`, `reportDone`, `reportsDir` |
| `src/orchestrator/log.ts` | `logPath`, `log`, run indices |
| `src/kanban.ts` | `STATES`, `createTask`, `setState`, `listAll`, `updateAttrs`, `taskSlug`, parsing |
| `src/pid.ts` | `agentAlive`, `pidAlive`, `pidEntry`, `pidPath`, `writePid`, `killTree`, `procPgrp` |
| `src/hub.ts` | the hub (`startHub` returns `{ port, close }` or null) |
| `src/webui/page.ts` | the page shell, the client render, the modal, and all CSS |
| `src/webui/payload.ts` | `taskPayload`, `cardStatsPayload`, `taskDetail`, `taskHistory`, `agentLogPayload`, `logStats`, `agentHistory` |
| `src/webui/board.ts` | the shell, columns, `applyStages`, cards, `agentLabel`, `agentRowSig`, `syncAgentStats` |

Role ids are the file stems in `agents/`. `renderPrompt(...)` in `src/orchestrator/spawn.ts` builds the spawn prompt, so a prompt claim can be replayed in-process; the daemon capture is the stronger proof. Loop lane state lives in `.pids/<slug>.pid`, `<slug>.slug`, `<slug>.exit`, and `.logs/<slug>.<role>.<n>.log`. A per-task run uses the task slug. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`.
