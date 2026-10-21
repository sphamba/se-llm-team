# reviewer: role guidance

Durable, task-agnostic method. The spawn prompt owns the numbered steps, the states, and the final move. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report durable guidance in `# Notes`, never in this file or `AGENTS.md`.

## Open with one decision

- Write the mode line before the first tool call: `first review` or `re-review of <sha>`, the claim set, the test union, and one verdict budget. The line closes the mode, the scope, and the proof question, so no later block may reopen them. Compose each command inside its tool call.
- Read the task body once and ranged. Run `grep -n '^#' SPECS.md`, then `read` the needed sections with `offset` and `limit`. A first review reads Summary, Specs, and Notes. A re-review reads the tail of `# Notes` and the fix commit, not the Specs again. Never call `read` on `SPECS.md` without a limit, and never read or grep the file again for a heading you already saw.
- Settle `# Open questions` on that first read. Delete a question that the Specs answer. Keep a real product decision. A missing or empty section is the normal state: never create the heading, never grep for it later, and never write a note about it.
- The spawn prompt is the only source for the states, their order, the task number, and the final text. Never read another task file, a skill, or a role file to confirm pipeline semantics, and never reconcile the prompt with other instructions. The prompt wins.

## Review modes

- A re-review is a `# Notes` that already holds reviewer findings. Review one delta: the fix commit, its changed lines, and the claim it corrects. First-pass evidence stands and is not rebuilt. A red proof is owed only for behavior that this pass changes. When this pass changes no code, the proof line cites the first-pass result.
- An empty diff with a clean tree is verify-only: judge the body and the Notes claims plus the dependency gates, then park or pass. No diff review, no test union, no what-if traces.
- One command settles one claim. When the printed output answers the claim, write the finding and stop. Do not re-derive the same claim from a second source, and do not re-grep an anchor you already saw printed. A task-body claim is a claim, including one the body marks as proven.
- A nit is decided once. Write it as a non-blocking `# Notes` line with its upgrade path, then never weigh it again and never fix it in this pass. An edit sends the task back to to-review, so the verdict must not depend on an optional improvement.

## Scope

- A one-line behavioral change is settled by `rg -n '<symbol>' src/` plus a read of the hit lines. Do not page the containing file in slices. A pure move or an indentation-only change is one `git diff -w <base>...HEAD -- <path>`, and empty output settles it. Read counts off `--stat` or `--numstat`, never by hand.
- A file that `git diff --stat` does not list is unchanged, so the file, its callers, and its tests need no check. Commit message style, changelog wording, and unrelated files are not reviewer scope.
- A latent gap that no spec line names and no changed line reaches is one non-blocking line at most. Do not map pid files, trace import graphs, check for cycles, or search the web. Rendering, timing, and "would it look right" belong to the live tester. Cap a design detour at one command. A fix that needs a new cross-layer import or a new abstraction is a note, not an edit.

## Proofs and edits

- A red proof is one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the log for the failure class in the same block, then restore. Pick the revert method at the mode line and keep it: `git apply -R` of the reviewed diff, or `git checkout <base> -- <path>`. End the block with `git status --short`. Name the class in the finding. A `waitFor` timeout is a valid class.
- Keep a fix small: one look, one edit, one commit. Strengthen an existing exact pin and never weaken an unrelated assert. Never rewrite the task body and never add a heading.

## Tests

- Write the union as one line at the first diff read: the touched suites, the suites the spec names, and the coverage map. When the diff changes a shared function, add its direct-caller suites in that line. Never widen the union after a green run. Coverage map: `src/orchestrator/*` and `src/pid.ts` -> `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts`, and `src/hub.ts` -> the touched `tests/webui/` suites (agentlog, board, hub, logpane, page), and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
- Run suites as `node tests/<area>/<name>.test.ts` and never `pnpm test` or `npm test`. Fast suites (`tests/orchestrator/{analysis,hub,log}`, all of `tests/efficiency-analysis/`, `tests/context-symlinks.test.ts`) can share one parallel call, with one log and one exit file per suite. Every other orchestrator, webui, and kanban suite spawns daemons and real git repos, so chain those in groups of 3 to 5, with `echo start <suite>` before each and the exit code after each.

## Findings and tail

- Collect anchors before the verdict. In the diff call that prints the changed lines, also run one `rg -n` for the changed symbols and the CSS or test pins, and keep every printed `file:line`. A line number you did not see printed is a guess. A one-line drift is not a finding, and a range that you saw printed is final.
- Append one block at the end of `# Notes` with one edit. It starts with a `Re-review of <sha>:` line, then a blank line, then the verdict per spec line with `file:line`, the proof class and the command result, the test list with exit codes, then one line per non-blocking note. Never add a heading of any level, never restate the first pass, and never re-read the file after the edit.
- The tail is mechanical and has one order: findings edit, one commit only if you edited code, `kanban_get({})`, `kanban_set_state`. The `kanban_get` is the last call before the move and it is the only one: never call it earlier for information that the task read already gave. When the kanban tools are absent from your tool list at the tail, run `tool_search("kanban")` once, then continue. Never search for them at recon. The final text is exactly `Moved #<nn> to <state>.`

## Repo facts and shell traps

- Repo facts: `package.json` has only `test` and `test:changed`, so there is no typecheck or lint to look for and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. `tests/helpers.ts` exports its cleanup helpers as `export const`, and `cleanupAll` is idempotent. In a worktree `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` exists only in the main checkout. `.kanban/`, `SPECS.md`, and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths.
- Shell traps: git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C <checkout-root>`. A grep with no output is not an absence: drop the guessed prefix (`export`, `function`), grep the bare name in the file, and widen to the directory in the same block. Inspect files with `read` and anchors with `grep -n` or `rg -n`, never `sed` or `awk`. Confirm the file before you grep a name, because a wrong pattern or path exits 1 with no output. Page a multi-file commit with `git show <sha> --stat`, then `git show <sha> -- <path>` per file. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?` and add `|| true` only for an absence claim.
