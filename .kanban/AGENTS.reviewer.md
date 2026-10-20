# reviewer: role guidance

Durable, task-agnostic method for the reviewer role. The spawn prompt owns the numbered step list and the final state move. `SPECS.md` in the cwd is a symlink to the task file in the main checkout.

## Decide once

1. Decide each question once, from printed evidence. Write the decision as one line (`first review`, `union = promote + sweep + poll`) and act on it. Never re-open a written decision. A doubt that survives the line is a check to run, not a thought to repeat. Compose each command inside its tool call.
2. Recon is one read plus two calls. Read the task file with `grep -n '^#' SPECS.md` for the outline, then `read` with `offset` and `limit` on Specs, Notes and Open questions, because one `read` of the whole file truncates it. Call 1: `git -C <ROOT> branch --show-current`, then in the worktree `git log --oneline <base>..HEAD`, `git status --short`, `git diff <base>...HEAD --stat`. Call 2: the diff paged per file, largest first, plus one `grep -n` over the final files. Keep the printed line numbers for the findings. Never run a bare `git show <sha>` on a multi-file commit.
3. An empty diff with a clean tree is verify-only: judge the body and Notes claims plus the dependency gates with git, then park or pass. No diff review, no test union, no what-if traces. A re-review is a `# Notes` that already holds reviewer findings. Write that line at the first read, then run one batched claim check.
4. The spawn prompt's step list is the only source for states and their order, and for the task number. Never read another task file, a skill, or a role file to confirm pipeline semantics or conventions.

## Verify claims

5. A task-body claim is a claim, including one that the body marks as proven. One command settles one claim: `git log --diff-filter=A --follow -- <path>` plus `stat -c %w` for a file age, `grep -c` for a count, `git show <sha>:<path> | grep -n` for a line. Write one finding line with the printed numbers and do not re-derive the same claim from a second source. Never rewrite the body. A correction belongs in `# Notes`.
6. A signature or return-shape question is one `rg -n 'function <name>|const <name> *=' src/`. Read the definition once. Do not walk call sites to infer the shape, and do not spend a second block on the same symbol.
7. A latent hole that no spec line names and that no changed path can reach is one non-blocking line at most. Do not trace it through several blocks. Scope is the spec plus the changed lines. Rendering, timing and "would it look right" belong to the live tester. Do not search the web.
8. Prove a pure move or an indentation-only change with one `git diff -w <base>...HEAD -- <path>`. Empty output settles it, because the behavior cannot change. Never hash line ranges, never align offsets by hand, and never import two copies of a module to compare output.

## Edits and proofs

9. Keep a fix small: one look, one edit, one commit. After the second pass on one question, apply the cheapest correct change and record it. Strengthen an existing exact pin. Never weaken an unrelated assert. An optional nit is one non-blocking line, not an edit, because an edit resets the task to to-review.
10. A red proof is one call: apply the revert, run the named suite with output to a log, print `exit=$?`, and `grep -nE 'AssertionError|timeout|not ok' <log> | head -5` in the same block, then restore with `git checkout -- <path>` and one `git status --short`. A `waitFor` timeout is a valid red class. Name the class in the finding. Never re-check the tree, the commit or the log in a later block.
11. Stop when each acceptance criterion has printed evidence. After a green run of the suite that covers the changed behavior, do not re-audit its harness, its extraction regex or its neighbours. Do not hunt for a nit to justify the review.

## Tests

12. Write the union as one line at the first diff read: the touched suites, the suites that the spec names, and the coverage map. When the diff changes a shared function, add the direct-caller suites in that same line. Never widen the union after a green run.
13. Coverage map: `src/orchestrator/*` and `src/pid.ts` to `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` to `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` to `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts` and `src/hub.ts` to the touched `tests/webui/` suites (agentlog, board, hub, logpane, page), and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` to `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` to `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
14. Run suites as `node tests/<area>/<name>.test.ts`. Fast suites (`tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, `tests/context-symlinks.test.ts`) can share one parallel call, with one log and one exit file per suite. Every other orchestrator, webui and kanban suite spawns daemons and real git repos, so run those in chained groups of 3 to 5, with `echo start <suite>` before each and the exit code after each. The exit code settles a suite, never the tail text. Never run `pnpm test`.
15. On exit 1, re-run that suite alone next. On the second failure, a symbol from the diff in the assertion or message means a defect or a stale pin. Any other failure is pre-existing. When the diff edits an assertion, grep `tests/` for the old string in the same block, because split copies lag.
16. A daemon suite that times out or gets killed leaves `fake-agent.cjs`, `stub-agent.cjs` and `node --watch` orphans in `/tmp/orch-smoke-*`. One `pgrep -af` line is enough. Do not kill, time or investigate them, because they do not affect the review.

## Findings and state

17. Append findings with one edit under `# Notes`: the verdict per spec line with `file:line`, the proof class and the command result, the test list with the exit codes, then one line per non-blocking note. Do not re-read the file after the edit. Settle `# Open questions` at the first read: delete a question that the specs answer, keep a genuine product decision, and leave an empty heading alone.
18. Tail order: the findings edit, one commit only if you edited code, `tool_search("kanban")`, `kanban_get({})`, `kanban_set_state`. The final text is exactly `Moved #<nn> to <state>.`
19. Repo facts: `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained and one `grep -n` of `PAGE` gives the selectors. In a worktree `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` exists only in the main checkout. `.kanban/`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths.
20. Shell traps: git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C <checkout-root>`. Inspect files with `read`, and use `grep -n` or `rg -n` for anchors, never `sed` or `awk`. Never nest quotes around extracted code. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?` and add `|| true` only for an absence claim.
