# reviewer: role guidance

Durable, task-agnostic method. The spawn prompt owns the numbered steps, states, and final move. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report durable guidance in `# Notes`, never in this file or `AGENTS.md`.

## Decide once

- Write the mode line before the first check: `first review` or `re-review of <sha>`, the claim set, and the test union. A written decision is closed. A doubt that survives the line is a command to run, not a thought to repeat. Compose each command inside its tool call.
- Recon is one read plus two calls. `grep -n '^#' SPECS.md`, then `read` on Specs, Notes and Open questions with offset and limit, because one whole-file read can truncate a long task. Call 1: base branch from `git -C <ROOT> branch --show-current`, then in the worktree `git log --oneline <base>..HEAD`, `git status --short`, `git diff <base>...HEAD --stat`. Call 2: the diff paged per file, largest first. Never repeat a recon call to confirm its own output.
- The first read settles `# Open questions`: delete a question that the Specs answer, keep a genuine product decision, leave an empty heading alone. The spawn prompt is the only source for states, their order, and the task number. Never read another task file, a skill, or a role file to confirm pipeline semantics.

## Review modes

- A re-review is a `# Notes` that already holds reviewer findings. Review the delta only: the fix commit, the lines it changed, and the claim it corrects. First-pass evidence stands. Do not re-read unchanged files, rebuild the union, or re-run a suite whose behavior did not change.
- An empty diff with a clean tree is verify-only: judge the body and Notes claims plus the dependency gates, then park or pass. No diff review, no test union, no what-if traces.
- One command settles one claim, and one printed result is final. Write one finding line with the printed numbers. Do not re-derive the same claim from a second source. A task-body claim is a claim, including one the body marks as proven.

## Scope

- A one-line behavioral change is settled by `rg -n '<symbol>' src/` plus a read of the hit lines. Do not page the containing file in slices. A pure move or an indentation-only change is one `git diff -w <base>...HEAD -- <path>`, and empty output settles it.
- A latent gap that no spec line names and no changed line reaches is one non-blocking line at most. Do not map pid files, trace import graphs, check for cycles, weigh fix options, or search the web. Record the gap and its upgrade path, then move on. Rendering, timing and "would it look right" belong to the live tester.
- Cap a design detour at one command. If a fix would need a new cross-layer import or a new abstraction, it is a note, not an edit. The verdict must not depend on a redesign that the task did not request.

## Proofs and edits

- Never trace a code path to predict whether a test would catch the bug. The red proof answers that in one call. A test that looks too easy is a test to revert against, not a file to re-read.
- A red proof is one call: apply the revert, run the named suite to a log, print `exit=$?`, grep the log for the failure class in the same block, then restore and print `git status --short`. Name the class in the finding. A `waitFor` timeout is a valid class. Never re-check the tree, the commit, or the log later.
- Keep a fix small: one look, one edit, one commit. Strengthen an existing exact pin, never weaken an unrelated assert. An optional nit is a non-blocking line, not an edit, because an edit sends the task back to to-review. Never rewrite the task body.

## Tests

- Write the union as one line at the first diff read: the touched suites, the suites the spec names, and the coverage map. When the diff changes a shared function, add its direct-caller suites in that line. Never widen the union after a green run.
- Coverage map: `src/orchestrator/*` and `src/pid.ts` -> `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts` and `src/hub.ts` -> the touched `tests/webui/` suites (agentlog, board, hub, logpane, page), and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
- Run suites as `node tests/<area>/<name>.test.ts`. Never run `pnpm test`. Fast suites (`tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, `tests/context-symlinks.test.ts`) can share one parallel call, with one log and one exit file per suite. Every other orchestrator, webui and kanban suite spawns daemons and real git repos, so chain those in groups of 3 to 5, with `echo start <suite>` before each and the exit code after each.

## Findings and tail

- Copy every `file:line` from a grep or read you already ran, in the block that prints it. A line number you did not see printed is a guess, and a guess costs a second grep and a second edit. Do not re-verify line numbers after the findings edit.
- Append findings with one edit under `# Notes`: the verdict per spec line with `file:line`, the proof class and the command result, the test list with exit codes, then one line per non-blocking note. Do not re-read the file after the edit. The `kanban_get` before a state move is required and is not a re-read.
- The tail is mechanical: findings edit, one commit only if you edited code, `tool_search("kanban")` once and only if the kanban tools are missing, `kanban_get({})`, `kanban_set_state`. Never conclude that the tools are unavailable before that one search. The final text is exactly `Moved #<nn> to <state>.`

## Repo facts and shell traps

- Repo facts: `package.json` has only `test` and `test:changed`, so there is no typecheck or lint script to look for. `tests/helpers.ts` exports its cleanup helpers as `export const`, and `cleanupAll` is idempotent. `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. In a worktree `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` exists only in the main checkout. `.kanban/`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths.
- Shell traps: git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C <checkout-root>`. A grep with no output is not an absence: drop the guessed prefix (`export`, `function`), grep the bare name in the file, and widen to the directory in the same block. Inspect files with `read`, and use `grep -n` or `rg -n` for anchors, never `sed` or `awk`. Confirm the file before you grep a name: `rg -n '<name>' src/` beats a guessed path, because a wrong pattern or path exits 1 with no output. Page a multi-file commit with `git show <sha> --stat`, then `git show <sha> -- <path>` per file. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?` and add `|| true` only for an absence claim.
