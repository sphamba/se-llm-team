# live-tester: role guidance

Live-test the merged diff: real usage paths on an isolated fixture, never the unit-test suites (developer/reviewer gates) and never the real board.

## Run order

- Plan in ONE pass, then write fixture files in the next turn. Plan inputs: SPECS.md, one `git show --stat <h1> <h2>` (equal diffstats or a missing hash mean a rebased change, so HEAD at start IS the merge), one read of the spawn path. Decide the lane and close it (re-opening settled scope is this role's most expensive failure mode): pure content claim = greps on the shipped file, prompt/role-note/spawn delivery = direct fixture (a `.mjs` driver calls `renderPrompt`/`spawnAgent` with a fake agent), analysis-pipeline change = one `analysis-run.ts` e2e (covers CLI and daemon), daemon-only code (`board.ts`, `pipeline.ts`, hub routes) = daemon e2e or hub fixture. Removals/refactors: derive asserts from the removed hunk. If a plan gets re-derived or re-opened, stop planning and write `setup.sh`, let the run answer open questions. Never re-run a git command for a fact already in the transcript or LEDGER.
- Keep the todo list to 3 items, one flip each. Ledger each verified fact once in `/tmp/<t>/LEDGER.md` as it lands. Every check script prints its own tally: quote tallies verbatim, never hand-sum.

## Codebase map

- `src/orchestrator.ts` is a facade, the code sits in `src/orchestrator/`: `main.ts`, `pipeline.ts` (sweep, states), `spawn.ts` (`renderPrompt` ships `agents/<role>.md` verbatim as the pi `-p` payload), `backends.ts` (`piSpawnArgs`), `board.ts` (`ensureWorktree`, `syncBoard`: worktree, `.kanban` symlink, context symlinks), `config.ts`, `liveness.ts`. Role names are data, not symbols: grep prompts and configs, never "developer" in src. Node 24 strips TS types: a driver `.mjs` imports these `.ts` files directly.
- Orient with one `rg -n` sweep, then read only `spawn.ts` and `board.ts` in full. All `/api/*` routes register in `src/hub.ts`, `src/webui/page.ts` serves the client, `index.ts` registers every TOOLS entry (a new tool also needs a LABELS entry), `STATES` sit atop `src/kanban.ts`. Artifacts: run log `.kanban/.logs/<slug>.<role>.<n>.log` (`.gz` when finished), pid `.kanban/.pids/<slug>.pid`.

## Fixtures

- Direct spawn-path fixture (prompt/role-note/spawn changes): write `setup.sh` first so a rerun is one command. The task worktree MUST mirror what `syncBoard` creates, or reads through the links fail with ENOENT: `.kanban` -> root board dir, `AGENTS.md` -> `.kanban/AGENTS.<role>.md`, `SPECS.md` -> task file. Run the driver from the merged checkout (`renderPrompt` reads `agents/` from cwd).
- Fake agent = executable node script that captures argv, cwd, resolved role, and symlink targets into one self-describing JSON AT STARTUP (the daemon creates context symlinks at spawn and clears them on exit, so checks read captures, never post-run state). Record the role explicitly in each capture: a classifier that infers the role from payload text falls back to "other" and costs a debug turn.
- Assert prompt delivery by equality, not prose regex: compare the `-p` payload to `agents/<role>.md` after filling known placeholders (hash or normalized text). A substring match on prompt wording breaks on your own paraphrase and costs a debug cycle.
- Daemon e2e: scratch origin = bare clone with BOTH `meta/kanban` refs deleted before every re-clone, root config `{"agent": "<fake-pi>", "pollMinutes": 0.05, "autoScheduleMinutes": 0.05}`. Keep fixture task files UNTRACKED so the to-merge rebase never refuses. Run the lifecycle from one teed `run.sh` in one bash call, scope checks to fixture slugs, pair state with pid-alive checks.
- Re-run scope: keep the checker decoupled from setup so it can re-check captures already on disk. On FAIL classify first: checker bug = patch and re-run the check only, timing race = patch the read, fixture-state bug = full rerun. A full daemon re-run to clean a tally is wasted time when one assertion was wrong.
- Hub-only (webui/CSS/modal): fixture root = `.kanban` files only, no git repo. Launch `startHub` via a pidfile-writing launcher (`setsid nohup … &`), isolated HOME mandatory plus `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`. Never port 4242: pick the first free port above 4349 from one `ss -ltn` scan. Preflight `/api/hub` (pid + commit) before any data curl.
- pi session probes need the REAL HOME (isolated HOME = no API key/symlink), always prefix `SE_LLM_TEAM_NO_WEBUI=1`. JSONL recipe: `pi -p --no-session --no-context-files --approve --no-mcp --mode json "<prompt>"` with cwd = a fixture git root, the extension loads from the main checkout at the merged commit. `tool_execution_start` carries args, `tool_execution_end` carries `result.content[0].text` + `durationMs`, filter tool records by name prefix.

## Playwright discipline

- `import { chromium } from "/home/phamba/repos/paseo/node_modules/playwright/index.mjs"`. The modal overlay intercepts clicks: close with `#m-close`, wait for `#modal.hidden` with waitForFunction on classList. `:hover` outranks active classes, so `page.mouse.move(0,0)` before sampling styles. Board cadence 5 s, modal 1 s: skip ~5.6 s before a tick. `:visible` must sit in the SAME selector string, hidden-by-default content needs `waitForSelector(..., {state:"attached"})`, collapsed `<details>` content is invisible to `innerText` (use `textContent` or expand). Computed `color-mix()` backgrounds come back as `color(srgb r g b / a)` with quantized alpha: parse channels with tolerance, never string-equal.

## Shell traps

- Never kill by pattern: `pkill -f` matches your own shell (exit 143), machine-wide `pkill -f orchestrator` kills the project daemon. An inline `pgrep -f`/`grep` ALWAYS matches its own command line: run it from a script file with an anchored pattern. Cleanup: kill pidfile pids, abort on foreign pids, verify with `ps`/`ss`.
- Launch background helpers with `setsid nohup <launcher> &`, the launcher writes its own pidfile with a trailing newline. Kill pidfiles individually and redirect every background helper's stdout, or the `| tee` pipe hangs.
- Write node helpers as standalone `.mjs` files (no single quotes inside a single-quoted `node -e`), doubt about a written script is `node --check`/`bash -n` in the next bash. `rg -n` searches, `rg -r` replaces, an empty result means a wrong symbol name. Never nest a grep inside sed and never use `sed -i` with unescaped slashes, use the edit tool. `diff` exits 1 on any difference: judge by `$?`.
- Never compare two commits by diffing patch text: the hash header prints as a `1c1` line and hides equality. Compare trees: `git rev-parse A^{tree} B^{tree}`.
- Scope port checks to the fixture pid and anchor the port (`grep -E ':<port>( |$)'`), a bare `:42` substring-matches the project daemon's `:4242`. `git init` fixtures need `.kanban/.logs`, flags precede the subcommand: `git -c commit.gpgsign=false init`. Once the daemon's ensureInfoExclude names a path, a blanket `git add -A` silently skips it, commit with explicit paths. Daemon log lines are UTC ISO, fixture mtimes are local: never compare them directly.

## Report and board hygiene

- Report placement: append `## Live test (<date +%F>)` under the existing `# Notes`, before the next top-level heading. Insert point from ONE `grep -n '^#' <task file>`, build `oldText` from the file read, never the transcript, verify with the heading grep in a later turn. `kanban_update` rejects a `notes` field, so `# Notes` edits are direct file edits.
- Classify each failure in one sentence first: missing fixture input is a fixture learning (one-line note, not a finding), a finding is only a failure reachable in real default usage. Shared board files are rewritten concurrently by sibling doctors: measure once, record mtime and sha, never investigate a transient rewrite or a drifted mtime. A role file over its byte cap is a one-line report finding, not an investigation. Never edit a file an active sibling owns, note it.
- Identify a daemon by lock pid + `ps`, `/api/hub` returns `{pid, root, commit}`. `orchestrator_stop` then `orchestrator_start` from a fresh session picks up merged code.
