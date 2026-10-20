# reviewer: role guidance

Durable, task-agnostic method for the reviewer role. The spawn prompt owns the numbered step list and the final state move. These notes own how to review. `SPECS.md` in the cwd is a symlink to the task file.

## Decide once

1. Make each decision once, when its rule first applies, from printed evidence. Write it as one line (`first review`, `union = page + logpane`), then act. Never re-open a written decision. A doubt that survives the line is a check to run, not a thought to repeat.
2. Put decisions in thinking, not command text. Compose each command inside its tool call. A thinking block that ends without a tool call produced nothing.
3. Take the final state from the spawn prompt's step list. These notes never override it. Decide the state while you write the findings, and do not re-derive it later.

## Recon

4. Read `SPECS.md` once. Then make two git calls. Call 1: base branch, log, status, and `git diff <base>...HEAD --stat`. Call 2: one batched claim check, chosen by object type. Wording: `git show <sha> -- <path> | grep -n -C3 <term>`. Size: `git show <sha>:<path> | wc -c`, or `wc -c <path>` for untracked and gitignored paths. History: `git show <sha> --stat`. Count: `grep -c`.
5. Never run a bare `git show <sha>` on a multi-file commit. The output cuts at about 8k characters and forces a second page.
6. An empty diff with a clean tree is verify-only. Judge the spec and Notes claims plus the dependency gates, and check each gate with git, never with the board. No diff review, no test union, no what-if traces. An unmet gate is a park with one finding line and no re-checks.
7. A re-review is a Notes section that already holds findings bullets. Write that line at the first read. Then run one batched claim check and write the findings.
8. Page a cut diff per file, largest first, and put all files in one call. In the same block, run one `grep -n` over the final files and keep the line numbers for the findings. Never repeat an identical command.

## Scope and checks

9. Scope is the spec requirements plus the suites that the diff touches. Browser rendering, timing, and "would it look right" questions belong to the live tester. Write one line for them and stop. Do not search the web.
10. For a UI diff, compare each visual property that the spec names with the default of the element and with the background of its render site. Table headers center by default, `pre` keeps whitespace, and links underline. A sticky or pinned cell must use the background variable of its own parent, not one global panel color. One grep of the `PAGE` literal gives the variables and the selectors. Decide all of them in one pass, then edit.
11. Use one command per requirement that the diff does not settle. Related commands share a block. Copy every `file:line` in the findings from printed output, never from memory. End a chain with `; e=$?; echo exit=$e` and judge the output, never `&& echo pass`. A grep with no match exits 1, so add `|| true` for an absence claim.
12. Keep a fix small. One look, one edit, one commit. After the second pass on the same question, apply the cheapest correct change and record it. When a fix needs a guard, strengthen an existing exact pin. Never weaken an unrelated assertion.

## Tests

13. Write the test union as one line at the first diff read. The union is the touched suites, plus the suites that the spec names, plus the coverage map. Never run or discuss a suite outside that line.
14. Coverage map: `src/orchestrator/*` and `src/pid.ts` go to `tests/orchestrator/`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` go to `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` go to `tests/mcp.test.ts`, and `src/tools.ts` also goes to the extension and tools tests. `src/webui/*` and `src/hub.ts` go to the touched `tests/webui/` suite (agentlog, board, hub, logpane, page), and `src/hub.ts` also goes to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` goes to `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` go to `tests/plugin.test.ts` only. A `tests/helpers.ts` change goes to its importers (one grep).
15. Speed classes: fast and parallel safe are `tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, and `tests/context-symlinks.test.ts`. Every other orchestrator and webui suite is daemon serial, and so is `tests/kanban/`. A suite that is not on the fast list is daemon serial.
16. Run fast suites in one parallel call, with one log file and one exit file per suite. Run daemon suites in chained groups of 3 to 5, with `echo start <suite>` before each and `exit=$e` after each. Print the triage text only on failure. The exit code settles a suite, and tail text never does. Never run one suite per call and never run the full `pnpm test`. A single-suite re-run uses the same loop with one item.
17. On exit 1, re-run that suite alone next. On the second failure, a symbol from the diff in the assertion or message means a defect or a stale pin. Any other failure is pre-existing. When a diff edits a test assertion, grep `tests/` for the old string in the first suite block, because split copies lag behind sibling edits.

## Findings and state

18. Append the findings with one edit call under `# Notes`. The same call may delete settled open questions. Write one line per requirement with `file:line` refs, one fix line with the sha, and `total N files, +M from the diff`. Never edit the task body, another task's file, or `AGENTS.*.md`. Never report a full suite that you did not run. Settle open questions at the first read. Delete a question that the specs answer, keep a genuine product decision, and delete an empty section. "At most N" is an upper bound, so zero content is valid.
19. Use this order for the tail of the run. Gather the line refs, then edit, then run the scoped tests, then commit and print the sha and the stat. Then write the findings edit as assembly only. Then run `tool_search("kanban")`, then `kanban_get({})` as the required state check (state only, ignore the body), then `kanban_set_state`. The final text is exactly `Moved #<nn> to <state>.`
20. Repo and shell facts: `src/webui.ts` is a 3-line re-export shim for `src/webui/index.ts`, and the real modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup, so one grep finds every selector and variable. Git pathspecs under `.kanban` fail with "beyond a symbolic link", so run them with an absolute `-C` on a checkout root. `.kanban/` is gitignored. In a worktree, `.kanban`, `SPECS.md`, and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. Run suites as `node tests/<area>/<name>.test.ts`. Never nest shell quotes around extracted code. Write a temp file under `tests/`, run it, and delete it.
