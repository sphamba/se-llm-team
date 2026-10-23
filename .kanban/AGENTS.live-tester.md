# live-tester: role guidance

You are the live-tester. The spawn prompt has priority over this file and owns the task, the states, and the finding text. This file owns the method, the repo facts, and the harness. Your cwd is the task worktree at the merged commit.

## Contract

- **Scope and boundary.** Node 24 runs `.ts` files directly. There is no build step and no `node_modules`, so a driver imports a merged module by absolute path. `SPECS.md` is a symlink, so resolve it with `TARGET=$(readlink -f SPECS.md)` in every call that uses it. Append only to `# Notes`. Edit only `# Open questions`. Never edit product code, tests, role files, the real board, a task state, or the production port. Never read a transcript or another role's log. The deliverable is one claim table, one driver, one wrapper, the runs, one appended report section, and one short message.
- **No suite.** Never run a `*.test.ts` file, `tests/helpers.ts`, or `pnpm test`. The helper sets `HOME` to a temp dir at import. A live value comes from a live run, a spike print, or a `file:line` that Specs cites. Specs prose alone is not evidence.

## Pace

- **Every message carries a tool call.** A prose-only message buys no data and spends a turn. Put the plan in the same message as the first tool call. When you catch yourself computing a number (a width, an index, a ratio), stop and run the one print that shows it. A second thought about the same choice is a signal to print, not to think.
- **Lane budget.** A docs, prose, or test-file lane takes about 10 tool calls. A page, process, or daemon lane takes about 20. Allow one repair cycle per section. When the budget is gone and a row is still unmeasured, mark it "not exercised", report what you have, and finish. Do not start a new spike to rescue one row.

## Recon and freeze

- **One recon call, and it prints values.** Send it in the first message with the `SPECS.md` read. The call prints `git log --oneline -3`, `git diff --stat HEAD^`, the changed paths outside `.kanban/`, the diff body to a file, the added lines, and the `^export` lines of `src`. A pattern with no match is final. Fall back to the `^export` list of the owning module or to `$D/exports`. Grep `$D/diff` instead of repeating the call. A second recon call means that the first one was incomplete.

  ```bash
  TARGET=$(readlink -f SPECS.md); D="/tmp/<slug>-recon"; mkdir -p "$D"
  git log --oneline -3; git diff --stat HEAD^
  git show --name-only --pretty=format: HEAD | rg -v '^\.kanban/' > "$D/files"
  git diff HEAD^ HEAD -- $(cat "$D/files") > "$D/diff"; wc -l "$D/diff"
  rg -n '^\+' "$D/diff" | head -80
  rg -n '^export ' src/kanban.ts src/pid.ts src/hub.ts src/orchestrator/*.ts > "$D/exports"; head -60 "$D/exports"
  rg -n -A 4 'export function (createTask|updateTask|setState|listAll|loadConfig|rescan|poll|ensureIntegrationTask)' src
  ```

- **Freeze from a print.** Copy every `expected` cell from the spike print or from a cited `file:line`. Copy every `control` cell from the pre-fix spike print, or record `absent` or a labelled `(n/a: reason)`. Never type a cell from prose or memory. A needle is a verbatim substring of the merged file, with the same word order, backticks, and punctuation. **A number with no print behind it is a defect.** Run the spike on the merged tree and on the pre-fix tree, side by side. A row that cannot show a different value where Specs says behaviour changed is a guard, not proof of the fix, so change its fixture before the driver exists. For a test-only change, the control is the pre-fix call form replayed on the same fixture. After the freeze, do not add, drop, split, or re-aim a row. A late gap is one constant edit and a report rerun, not a new row. A Specs number that no row measures (a ratio, a percentage, a timing budget) is an assumption, not a chase. A docs row has two cells: the doc substring and the code fact that it names. Count a list or a table by elements, and print the link count before you freeze it.
- **Expected versus control.** The expected cell is the Specs requirement even when it is red. A merged value that equals the control value is pre-existing behaviour: keep the row, keep the red verdict, explain the shared cause, and raise one open question. Never split or re-aim the row to turn the verdict green, and never overwrite the expected cell with the observed value.

## Harness

- **Driver skeleton.** Fill `CLAIMS` and `measure()` only. `HERE` holds the results and is never wiped. `RUNS` holds the fixtures, and the wrapper wipes it once before the first run. Write the JSON in a `finally` block with `root`, `tree`, and the saved pids, so a timeout leaves a readable artifact and report mode needs no extra argv. Do not add a helper script beyond the spike, the driver, and the wrapper.

  ```js
  // /tmp/<slug>/driver.mjs   node driver.mjs run <label> <tree> <n> | report
  import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
  const HERE = "/tmp/<slug>";       // results, never wiped
  const RUNS = "/tmp/<slug>-runs";  // fixtures, the wrapper wipes it once
  const CLAIMS = [
    // { id: 1, claim: "...", expected: "value=1/1", control: "value=0/1" },
  ];
  const has = (text, needles) => needles.filter((n) => text.includes(n)).length;
  function measure(tree) {
    const doc = readFileSync(`${tree}/<file>`, "utf8");
    return { 1: `value=${has(doc, ["<needle>"])}/1` };
  }
  const [mode, label, tree, n] = process.argv.slice(2);
  const out = { root: RUNS, tree, pids: [], label, n, meta: {}, rows: [] };
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

- **Write once, then check.** Write the driver with the write tool in one call. In the same message run `node --check driver.mjs`, `bash -n run.sh`, and `rg -n` for every identifier you just used, because `node --check` misses a stale name. Delete every helper and constant that you do not call before the first run. A computed key needs a quoted or numeric key (`cells[id]`, `cells[String(id)]`): `cells[6b]` is a syntax error, and a stale helper hides the next one.
- **Selectors and counts.** Select by class (`.c-<state>`, `.col`, `.pair`) and filter the list, never by child index. The relations overlay SVG is inserted as `#board.firstChild`, so `#board.children` is not the column list, and a single state column can sit inside a `.pair`. Reuse the spike's selector code verbatim in the driver. Every `n/m` count is `.length` on the array that holds the data, never a hand count. A probe that prints the same value twice is not a fix: print the data, find the shared cause, and fix it once.
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
  # static parse lane: "for n in 1". Dynamic lane: "for n in 1 2 3".
  for n in 1 2 3; do run merged "$TREE" "$n"; done
  node "$HERE/driver.mjs" report || fail=1
  exit "$fail"
  ```

- **Result identity and expected exits.** Name each result `<label>-<n>.json`. The report builds the merged set from the `merged-*.json` prefix and the control from `control-*.json`. Never use `runs[0]` for identity, because the control sorts first. Print the header tree from the merged result. `report` exits 1 on a red verdict by design, so keep stdout and stderr or add `|| true`, then `rg` the generated section. Never send the command to `/dev/null`: you then cannot tell a red report from a crash.

## Fixtures

- **Hub page.** Write `.kanban/<slug>.md` with `createTask` and `setState`, one task per state, plus `.kanban/.logs/<slug>.<role>.<n>.log`. `listAll` skips `AGENTS.*`, so use it, never a raw `*.md` glob. Call `startHub({ root, name, host: "127.0.0.1", port: 0, stages })` and read the bound port, because `freePort` is racy. The stage flags reach the page from the hub entry, not from the config file, so pass `stages` here. `startHub` unrefs its server, so hold a ref'd `setInterval` and clear it on SIGTERM and SIGINT. Give the fixture base a unique prefix, one root per run, and `rm -rf` it before the control.
- **Playwright.** Import from `/home/phamba/repos/paseo/node_modules/playwright/index.mjs` with `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. A board card shows only the task and its state. The agent cards, the active role, and the dead run render in the task-detail modal (`#m-agent`, `#m-agent-btns`, `#m-doctor`). Theme: `:root` is the light palette, `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` are the two dark paths, so a theme claim needs all three samples. Set the theme through `document.documentElement.dataset.theme` in a fresh context, because `localStorage.theme` restores a previous choice. For a static style claim open the context with `reducedMotion: "reduce"`. For an animation claim keep motion and wait until `el.getAnimations()` is empty or two samples agree. Move the mouse to `0, 0` before you sample a style, because `:hover` outranks the active class. `textContent` reads collapsed `<details>`, and `innerText` does not. Parse `px` and `rem` to a number and print the raw value next to the normalized one. Never split a computed CSS function on `)` or `,`, because `rgb()` and `rgba()` nest both: compare the raw string.
- **Daemon, pid, and git.** Write `<root>/se-llm-team.json` with a fake agent path, a small `pollMinutes`, `backlogIdleMinutes: 0`, and only the keys that the claim needs. Run `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` from the worktree, so the entry point and `agents/` come from the merged tree. Set `SE_LLM_TEAM_NO_WEBUI=1` and a fixture `HOME`. One `rg -n 'XDG_CONFIG_HOME' src` decides whether that variable matters, and a no-match is final. Delete an env var with `delete process.env.X`, never with `= undefined`. Call `rescan(root, cfg, true)` or `poll(root, stallMinutes, now, backlogIdleMinutes)` in-process when timers, pid lifecycle, and the CLI are not part of the claim. A pid file holds a bare pid or `<pid> <disc>`, so pass the `disc` to `pidAlive`. The wrapper pid is the group leader, and `killTree` sends `-pid`. A root that makes a worktree or reaches merge needs a real repo: `git init -b main`, a local `user.name` and `user.email`, and `git config commit.gpgsign false`, because a host global setting breaks fixture commits. `task.worktree` is a branch name, never a filesystem path. A fake agent is an executable node script with a shebang, and the prompt is `process.argv[process.argv.indexOf("-p") + 1]`. Map the role marker to the lowercase id, then append one JSON line of role, task, cwd, and pid to a capture path baked into the script, because env may not reach the spawned agent.

## Shell

- **One call is one shell, and the traps are known.** Derive `TARGET` again inside every call that uses it. Pass a value to node as an env prefix (`TARGET="$TARGET" node -e '...'`), never after the code, because `process.env.TARGET` then stays undefined. Use `set -uo pipefail`, and do not put `exit "${PIPESTATUS[0]}"` inside a loop. Never pipe the wrapper through `tail`, because the pipe hides the exit code. Exit 126 is a missing executable bit, 127 a wrong path, and 143 a shell that killed its own process group. `pkill -f '<pattern>'` also matches the shell that runs it, so scope every check to your unique fixture prefix. A backtick inside a template literal, or inside a double-quoted shell string that reaches JS, ends the literal: use a single-quoted string for a CSS selector. An `rg` pattern with `{`, `}`, or `(` is a regex: add `-F` for a literal. Never invent a module name in `node -e`; import the real path. A `python3 - <<'EOF'` patch that fails its assert leaves the file unchanged and still runs the next command, so patch scripts only with the write or edit tool. Write files with the write tool, not a heredoc, unless you want expansion. The edit tool takes an array of `{ oldText, newText }`, and a string argument fails validation.

## Close

- **Red rows.** Classify before you explain. A `ReferenceError`, a `TypeError`, a parse mismatch, a fixture timeout, an `ENOENT`, an empty read, or a line that disagrees with the print is a checker bug. Check the needle, the path, the branch, the fixture, and the value source first. A wrong `expected` that the print disproves is a checker fix: change the cell, keep the claim, rerun once. Fix every row with the same cause in one edit and stop after two repair cycles. A third miss means rewrite that section of the driver, not patch it again. A failing row whose cause is an index or an argv offset needs the shared line fixed once, not a special case per row.
- **Report.** The `report` mode writes the heading, the assumptions, the "not exercised" line, the tree and driver paths, the run counts, the table, the red proof, and one verdict line into one section, so no edit is needed after the append. Read the context from the result JSON, never from an extra argv slot. Every cell value must come from the result JSON or from a measured field such as a geometry box in `meta`. Never type a measured number into the generator or the template. Take a merged value from every run and mark a disagreement on a stable signature, never on a string that holds a pid, a size, or a timing value. Escape each `|` as `\|`, print an empty value as `(empty)`, and label a control that is empty by design. Count rows and cells in node on unescaped pipes only. Before the append, `rg -n 'undefined|NaN' report-section.md` and check the tree path line: a green verdict does not prove that the header rendered.
- **Append.** Grep the heading in `$TARGET` first. Append the bytes of `report-section.md` with one `python3` call that also resolves the target and asserts that it exists and is inside `.kanban/`, because `open(path, "w")` on a wrong path creates a stray file. Use `open(path, "r")` plus `open(path, "w")`, because `sed -i` replaces the symlink with a regular file. The symlink writes through to the main checkout, and `.kanban` is gitignored, so prove the append with counts, not `git status`.
- **Proof, then stop.** One call proves the heading count, the row count, the saved pid count (when the lane spawned a process), the non-zombie check, and `git status --short`. When it prints, stop. Do not re-read `SPECS.md`, do not re-prove the table, and make no cosmetic edit after the append. Keep the driver, the wrapper, the result JSON, and the appended section. Remove only the fixture roots and the control tree that you created. A child that the driver spawned and did not reap stays a zombie, and `pidAlive`, `kill -0`, `pgrep`, and `/proc` existence all report it alive: measure liveness by the `/proc/<pid>/stat` state (`Z` or gone), and group death by "no non-zombie member of the group". Sibling agents run at the same time, so never use a host-wide count as the only evidence in a row. Treat a Specs claim that no other process is running as unverified, and state that limit in the assumptions. Finish with one line per finding, or state that there is none.

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
| `src/webui/page.ts` | the page shell, the client render, the modal, the relations overlay, and all CSS |
| `src/webui/payload.ts` | `taskPayload`, `cardStatsPayload`, `taskDetail`, `taskHistory`, `agentLogPayload`, `logStats`, `agentHistory` |
| `src/webui/board.ts` | `LAYOUT`, `pairLayout`, `buildShell`, `applyStages`, cards, `agentLabel`, `agentRowSig`, `syncAgentStats` |

Role ids are the file stems in `agents/`. `renderPrompt(...)` in `src/orchestrator/spawn.ts` builds the spawn prompt, so a prompt claim can be replayed in-process. The daemon capture is the stronger proof. Loop lane state lives in `.pids/<slug>.pid`, `<slug>.slug`, `<slug>.exit`, and `.logs/<slug>.<role>.<n>.log`. A per-task run uses the task slug. The global merger and integration lanes use `merger.pid`, `merger.slug`, `integration-tester.pid`, and `integration-tester.slug`.
