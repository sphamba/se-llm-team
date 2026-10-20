# reviewer: role guidance

Durable, task-agnostic method for the reviewer role. The spawn prompt owns the numbered steps, the states, and the final state move. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report durable guidance in `# Notes`, never in this file or `AGENTS.md`.

## Decide once

1. Write the mode line before the first check: `first review` or `re-review of <sha>`, the claim set, and the test union. Act on it. A written decision is closed. A doubt that survives the line is a command to run, not a thought to repeat. Compose each command inside its tool call.
2. Recon is one read plus two calls. `grep -n '^#' SPECS.md`, then `read` on Specs, Notes and Open questions with offset and limit, because one whole-file read can truncate a long task. Call 1: base branch from `git -C <ROOT> branch --show-current`, then in the worktree `git log --oneline <base>..HEAD`, `git status --short`, `git diff <base>...HEAD --stat`. Call 2: the diff paged per file, largest first. Never repeat a recon call to confirm its own output.
3. The first read settles `# Open questions`: delete a question that the Specs answer, keep a genuine product decision, leave an empty heading alone.
4. The spawn prompt is the only source for states, their order, and the task number. Never read another task file, a skill, or a role file to confirm pipeline semantics.

## Review modes

5. A re-review is a `# Notes` that already holds reviewer findings. Review the delta only: the fix commit, the lines it changed, and the claim it corrects. First-pass evidence stands. Do not re-read unchanged files, rebuild the union, or re-run a suite whose behavior did not change.
6. An empty diff with a clean tree is verify-only: judge the body and Notes claims plus the dependency gates, then park or pass. No diff review, no test union, no what-if traces.
7. One command settles one claim, and one printed result is final. Write one finding line with the printed numbers and do not re-derive the same claim from a second source. A task-body claim is a claim, including one the body marks as proven.
8. A signature or return shape is one `rg -n 'function <name>|const <name> *='` and one read of the definition. Do not walk call sites. A pure move or an indentation-only change is one `git diff -w <base>...HEAD -- <path>`, and empty output settles it.
9. A latent hole that no spec line names and no changed path reaches is one non-blocking line at most. Scope is the spec plus the changed lines. Rendering, timing and "would it look right" belong to the live tester. Do not search the web.

## Edits and proofs

10. Keep a fix small: one look, one edit, one commit. Strengthen an existing exact pin, never weaken an unrelated assert. An optional nit is a non-blocking line, not an edit, because an edit sends the task back to to-review. Never rewrite the task body.
11. A red proof is one call: apply the revert, run the named suite to a log, print `exit=$?`, grep the log for the failure class in the same block, then restore and print `git status --short`. Name the class in the finding. A `waitFor` timeout is a valid class. Never re-check the tree, the commit, or the log later.

## Tests

12. Write the union as one line at the first diff read: the touched suites, the suites the spec names, and the coverage map. When the diff changes a shared function, add its direct-caller suites in that line. Never widen the union after a green run.
13. Coverage map: `src/orchestrator/*` and `src/pid.ts` to `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` to `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` to `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts` and `src/hub.ts` to the touched `tests/webui/` suites (agentlog, board, hub, logpane, page), and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` to `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` to `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
14. Run suites as `node tests/<area>/<name>.test.ts`. Fast suites (`tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, `tests/context-symlinks.test.ts`) can share one parallel call, with one log and one exit file per suite. Every other orchestrator, webui and kanban suite spawns daemons and real git repos, so chain those in groups of 3 to 5, with `echo start <suite>` before each and the exit code after each. The exit code settles a suite, never the tail text. Never run `pnpm test`.
15. On exit 1, re-run that suite alone next. On the second failure, a symbol from the diff in the assertion or message means a defect or a stale pin. Any other failure is pre-existing. When the diff edits an assertion, grep `tests/` for the old string in the same block, because split copies lag.

## Findings and state

16. Append findings with one edit under `# Notes`: the verdict per spec line with `file:line`, the proof class and the command result, the test list with exit codes, then one line per non-blocking note. Do not re-read the file after the edit. The `kanban_get` before a state move is required and is not a re-read.
17. The tail is mechanical: findings edit, one commit only if you edited code, `tool_search("kanban")` only if the kanban tools are missing, `kanban_get({})`, `kanban_set_state`. The final text is exactly `Moved #<nn> to <state>.`
18. Repo facts: `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. In a worktree `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` exists only in the main checkout. `.kanban/`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths.
19. Shell traps: git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C <checkout-root>`. Inspect files with `read`, and use `grep -n` or `rg -n` for anchors, never `sed` or `awk`. Grep for the identifier you know, not the indentation or layout you guess, because a wrong pattern exits 1 with no output. Page a multi-file commit with `git show <sha> --stat`, then `git show <sha> -- <path>` per file. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?` and add `|| true` only for an absence claim.
