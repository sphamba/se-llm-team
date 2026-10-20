# reviewer: role guidance

Durable, task-agnostic method for the reviewer role. The spawn prompt owns the numbered step list and the final state move. `SPECS.md` in the cwd is a symlink to the task file.

## Decide once

1. Decide each question once, from printed evidence. Write the decision as one line (`first review`, `test union = page + logpane`) and act. Never re-open a written decision. A doubt that survives the line is a check to run, not a thought to repeat. Compose each command inside its tool call.
2. Recon is one read plus two git calls. Call 1: base branch from the project root, `git log`, `git status`, and `git diff <base>...HEAD --stat`. Call 2: one batched claim check by object type: `git show <sha> -- <path> | grep -n -C3 <term>`, `git show <sha>:<path> | wc -c`, `git show <sha> --stat`, or `grep -c`. Never run a bare `git show <sha>` on a multi-file commit.
3. An empty diff with a clean tree is verify-only. Judge the spec and Notes claims plus the dependency gates, each gate with git. No diff review, no test union, no what-if traces. An unmet gate is one park line.
4. A re-review is a `# Notes` that already holds reviewer findings bullets. Write that line at the first read, then run one batched claim check.
5. The spawn prompt's step list is the only source for states and their order. Never grep the skill, a role file, or another task file to confirm pipeline semantics or conventions. Never read another task's body.
6. Page a cut diff per file, largest first, all files in one call. Run one `grep -n` over the final files in the same block and keep the numbers for the findings.

## Scope and checks

7. Scope is the spec requirements plus the suites that the diff touches. Browser rendering, timing, and "would it look right" belong to the live tester. Write one line, defer, and stop. Do not search the web.
8. For a UI diff, compare each visual property that the spec names with the element default and the render-site background. One grep of the `PAGE` literal gives the selectors and the variables. Decide all of them in one pass, then edit.
9. Prove a pure move or an indentation-only change with one `git diff -w <base>...HEAD -- <path>`. Empty output settles it, because the behavior cannot change. Never hash line ranges, never align offsets by hand, and never import two copies of a module to compare output.
10. Run one command per requirement that the diff does not settle. Related commands share a block. Copy each `file:line` from printed output, never from memory. End a chain with an `e=$?` capture and `echo exit=$e`. Add `|| true` only for an absence claim.
11. Keep a fix small: one look, one edit, one commit. After the second pass on one question, apply the cheapest correct change and record it. Strengthen an existing exact pin. Never weaken an unrelated assert. An optional nit is one non-blocking line, not an edit, because an edit resets the task to to-review.

## Tests

12. Write the union as one line at the first diff read: the touched suites, the suites that the spec names, and the coverage map. Coverage map: `src/orchestrator/*` and `src/pid.ts` to `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` to `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` to `tests/mcp.test.ts`, and `src/tools.ts` also to the extension and tools tests. `src/webui/*` and `src/hub.ts` to the touched `tests/webui/` suites (agentlog, board, hub, logpane, page), and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` to `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` to `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
13. Fast suites (`tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, `tests/context-symlinks.test.ts`) run in one parallel call, with one log and one exit file per suite. Every other orchestrator and webui suite, and `tests/kanban/`, is daemon serial. Run those in chained groups of 3 to 5, with `echo start <suite>` before each and the exit code after each. The exit code settles a suite, never the tail text. A single re-run uses the same loop with one item. Never run the full `pnpm test`.
14. On exit 1, re-run that suite alone next. On the second failure, a symbol from the diff in the assertion or message means a defect or a stale pin. Any other failure is pre-existing. When the diff edits an assertion, grep `tests/` for the old string in the first suite block, because split copies lag.
15. A served-source test proven red on the reverted fix and green on the fix is settled. Do not re-audit its harness, its extraction regex, or its neighbours after green. A red from a crash (for example `ReferenceError`) still proves that the harness runs the browser source. Name the red class in the finding. Stop when each acceptance criterion has printed evidence, and do not hunt for a nit to justify the review.

## Findings and state

16. Append findings with one edit under `# Notes`. Settle open questions at the first read: delete a question that the specs answer, keep a genuine product decision, and leave an empty `# Open questions` heading alone. Never scan other tasks for the convention. "At most N" is an upper bound. Never edit the task body, another task's file, or `AGENTS.*.md`.
17. Tail order: gather the refs, edit, run the scoped tests, commit, print the sha and the stat, write the findings edit as assembly only, run `tool_search("kanban")`, run `kanban_get({})` (state only), then `kanban_set_state`. The final text is exactly `Moved #<nn> to <state>.`
18. Repo facts: `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup, and it interpolates client helpers as source, so a served helper must be self-contained. In a worktree, `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` does not exist there. `.kanban/`, `SPECS.md` and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths.
19. Shell traps: git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C` on a checkout root. Inspect files with `read`, never with `sed` or `awk`, and use `grep -n` for anchors. Run suites as `node tests/<area>/<name>.test.ts`. Never nest quotes around extracted code. Put a temp script under `tests/`, run it, then delete it.
