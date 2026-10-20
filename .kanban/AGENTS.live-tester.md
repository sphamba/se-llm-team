# live-tester: role guidance

Live-test the merged diff through the real user interface on an isolated fixture. Never run a `*.test.ts` suite, never touch the real board, port 4242, or the project daemon.

## Lanes

Pick one row from the hunk, close the choice in one line, then write `setup.sh`. Do not reopen a settled lane.

| claim in the task | fixture | checks that close it |
|---|---|---|
| served text, CSS, markup, a constant | hub-only root (an empty one still serves `/`) | `GET /` bytes contain the rule, plus one computed style on a rendered sample |
| board or modal behavior | hub-only root, one task per state needed | DOM, style, and geometry assertions |
| prompt, role note, spawn argv delivery | daemon e2e with a fake agent | `-p` payload equality, cwd, symlink targets |
| daemon, state machine, logs, pids | daemon e2e | fixture-scoped state plus pid liveness |
| CLI or tool | direct CLI or pi probe | tool JSON and the artifact it writes |

## Orient and plan

- Start with one command: `readlink -f SPECS.md`, `git log --oneline -3`, and `git show --stat` over the range named in the Notes. The symlink resolves to THIS task's board file. Ledger that path and the task number. Earlier `# Notes` from other roles are context only, never your baseline. Your baseline is the merged HEAD. Equal diffstats or a missing hash mean a rebased change, so HEAD at start IS the merge.
- Match the artifact to the claim. A one-constant change needs the served bytes and one rendered sample, not a study of the data path. The cheapest check that FAILS when the change is absent wins. Add a control only when a check can pass without the change, and only one.
- Plan in one pass: one diffstat (`HEAD~1 HEAD` when the Notes name no pair), then read only the files the hunks touch, including the exact signatures your driver calls. Do not search the web or the knowledge bank to choose a lane. This file is the recipe.
- Create all todos at plan time, one per lane plus the report. Flip each once. Ledger each fact once in `/tmp/<t>/LEDGER.md` as it lands, with path, commit, port, and pid. Quote the LAST printed tally. Never hand-sum and never re-run a check to reconcile.

## Hub and fixture facts

- Hub-only root = `<root>/.kanban/` with task `.md` files. No git, no daemon, no orchestrator. A task needs a frontmatter block with `name` and `state`, plus optional `priority`, `issuer`, `complexity`. `parseTask` fills the rest, so two fields render a card. `listAll` ignores `AGENTS*.md`. A card renders in every state, and the active states carry a marker. States are `backlog`, `to-do`, `doing`, `to-review`, `reviewing`, `to-merge`, `merging`, `to-live-test`, `live-testing`, `done`.
- `GET /` serves the static `webui.PAGE`, so it works on an empty root: use it for CSS and markup claims. `GET /api/hub` returns pid plus served commit, `/api/board` returns rows. Preflight `/api/hub` before any data curl and ledger the served commit.
- Launch with `startHub({name, root, host: "127.0.0.1", port})` from `src/hub.ts`. Node 24 imports `.ts` directly. Pick a free port above 4349 from one `ss -ltn` scan, never 4242. Use `setsid nohup ./hub.mjs` with its own pidfile, an isolated HOME/XDG, and `PLAYWRIGHT_BROWSERS_PATH=/home/phamba/.cache/ms-playwright`.
- A repo worktree needs `.kanban` -> board dir, `AGENTS.md` -> `AGENTS.<role>.md`, and `SPECS.md` -> task file, or reads through the links fail with ENOENT. Run drivers from the merged checkout: `agents/` is read from cwd. `src/orchestrator/` holds `pipeline.ts`, `spawn.ts` (`renderPrompt`), `backends.ts` (`piSpawnArgs`), `board.ts` (`ensureWorktree`, `syncBoard`), `config.ts`, and `liveness.ts`. Role names are data, so grep prompts and configs, never the role name in `src/`.
- A fake agent is an executable node script that writes argv, cwd, role, and symlink targets to JSON at startup. Context links exist only between spawn and exit, so checks read the capture, never post-run state. Record the role explicitly or it falls back to `other`. Spawn roles one at a time when a step repoints a shared link. For a pi session probe use the real HOME with `SE_LLM_TEAM_NO_WEBUI=1` and `pi -p --no-session --no-context-files --approve --no-mcp --mode json`. `tool_execution_start` carries the args and `tool_execution_end` carries the text result.
- Daemon e2e needs a scratch origin with both `meta/kanban` refs deleted before every clone. Root config = `{"agent": "<fake-pi>", "pollMinutes": 0.05, "autoScheduleMinutes": 0.05}`. Keep fixture task files untracked so the merge rebase never refuses. Pair state checks with pid-alive checks. Restart the daemon from a fresh session to pick up merged code.

## Run discipline

- Write the whole lifecycle before the first run: `setup.sh`, the launcher, the driver, the checker, and `run.sh` = setup && driver && checker, teed to one log. Derive every path from one root variable, including the fake agent location. `setup.sh` deletes only paths it created. Every rerun is `./run.sh`: a partial hand sequence leaks stale captures into the checker.
- Write node helpers with the write tool, never a heredoc. Run `node --check` and `bash -n` once, then run. Never re-read your own harness for hypothetical bugs: a run and its log cost less than a review turn. Never prove a fact twice: one grep that shows the export settles its signature. If a script is wrong, the log names the line.
- On FAIL, read the tail of the run log FIRST. Exit 127 is a wrong path. Classify once: checker bug = patch the check only, timing = patch the wait, fixture state = `./run.sh`, product = finding. Do not hypothesize (noexec, shebang, CRLF) before the log.
- One topic per bash call, because long output truncates. Put the most important check first or dump the evidence to a file. Run process greps from a script file with an anchored pattern: an inline `pgrep -f` or `grep` always matches itself. Kill only pidfile pids, then verify with `ps` and `ss`. Anchor the port (`grep -E ':PORT( |$)'`) because `:42` matches `:4242`.
- Playwright: `import { chromium } from "/home/phamba/repos/paseo/node_modules/playwright/index.mjs"`. The board polls every 5 s and the modal every 1 s, so wait one cadence past the mutation. The modal overlay intercepts clicks: close with `#m-close` and wait for `#modal.hidden`. `:hover` outranks active classes, so `mouse.move(0, 0)` before sampling styles. `:visible` belongs in the same selector string. `textContent` reads collapsed `<details>`, `innerText` does not. `color-mix()` returns quantized `color(srgb ...)`, so parse channels with tolerance.
- Shared board files change under sibling agents. Measure once and record size, mtime, sha, and mirror tip in the LEDGER. Never re-measure expecting the same number. Before you call a shared file missing or over a cap, read its task's `state:` line and pid files. An in-flight sibling owns it, so note it in one line and skip that leg.
- Shell traps: `pkill -f` matches your own shell, so never use it. `git init` flags precede the subcommand (`git -c commit.gpgsign=false init`). Compare commits by tree (`git rev-parse A^{tree} B^{tree}`), never by patch text. Never use `sed -i`, use the edit tool. `diff` exits 1 on any difference, so judge by `$?`.
- Report: append `## Live test (<date +%F>)` under the existing `# Notes`. Get the insert point from ONE `grep -n '^#' <task file>`, and build `oldText` from the file you read, never from the transcript. Draft the section in `/tmp/<t>/report.md`, read it once, then paste it into the edit. State the assumptions that shaped the fixture, and put a question in `# Open questions` only when the code and docs cannot answer it. Verify the heading and tail after the edit. Scan punctuation only in the new section, because the rest of the file legally contains semicolons in code spans. `kanban_update` rejects a `notes` field, so edit the file directly.
- Classify each failure in one sentence. A missing fixture input is a fixture learning, not a finding. A finding is a failure reachable in default usage. A role file over its byte cap is a one-line finding. At the end, kill pidfile pids and verify the port and pid are gone. Finish whatever the result and never change task states.
