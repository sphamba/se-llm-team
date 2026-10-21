# reviewer: role guidance

Durable, task-agnostic method. The spawn prompt owns the steps, the states, the task number, and the final text. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report durable guidance in the task's `# Notes`, never in this file or `AGENTS.md`.

## Open the run

- Write the mode line in the first reply: `first review` or `re-review of <sha>`, the claim set, `test union: TBD after diff read`, and one verdict budget. Compose the recon call with it: `grep -n '^#' SPECS.md`, `b=$(git -C /home/phamba/repos/se-llm-team branch --show-current)` and reuse `$b`, `git log --oneline -6`, and `git diff --stat "$b"...HEAD`. The mode line closes the mode, the scope, and the proof question. No later block may reopen them.
- Read the task body once in one ranged `read`: start at `# Summary` from the heading grep and read to EOF with a `limit` that covers the rest. Do not use `sed`, do not read the frontmatter twice, and never call `read` on `SPECS.md` without a limit. Settle `# Open questions` on that read: delete a question that the Specs answer, keep a real product decision. A missing or empty section is the normal state. Never create the heading, never grep for it again, never write a note about it.
- The spawn prompt is the only source for the states, their order, and the final text. Never read another task file, a skill, or a role file to confirm pipeline semantics, and never reconcile the prompt with other instructions. The prompt wins.

## Choose the mode

- A re-review is a `# Notes` that already holds reviewer findings. Read the tail of `# Notes` and the fix commit only. First-pass evidence stands and is not rebuilt. When this pass changes no code, the verdict cites the first-pass result.
- An empty diff with a clean tree is verify-only: judge the body and the Notes claims plus the dependency gates, then pass or park. No diff review, no test union, no what-if traces.
- One command settles one claim. When the printed output answers the claim, write the finding and stop. A task-body claim is a claim, including one the body marks as proven. Decide a nit once: write it as a non-blocking `# Notes` line with its upgrade path, then never weigh it again. Do not fix it in this pass, because an edit sends the task back to to-review.
- A red proof is owed only for behavior that this pass changes. With no source edit, cite the pass result and run nothing. With a source edit, use one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the log for the failure class in the same block, restore, then `git status --short`. Pick the revert method at the mode line and keep it: `git apply -R` of the reviewed diff, or `git checkout <base> -- <path>`. Name the class in the finding. A `waitFor` timeout is a valid class.

## Keep the scope

- A one-line behavioral change is settled by `rg -n '<symbol>' src/` plus a read of the hit lines. Do not page the containing file in slices. A pure move or an indentation-only change is one `git diff -w <base>...HEAD -- <path>`, and empty output settles it. A file that `--stat` does not list is unchanged, so the file, its callers, and its tests need no check. Read counts off `--stat` or `--numstat` in the recon call, never by hand. Commit message style, changelog wording, and unrelated files are out of reviewer scope.
- A latent gap that no spec line names and no changed line reaches is one non-blocking line at most. Do not map pid files, trace import graphs, check for cycles, or search the web. Rendering, timing, and "would it look right" belong to the live tester. Cap a design detour at one command. A fix that needs a new cross-layer import or a new abstraction is a note, not an edit.
- Keep a fix small: one look, one edit, one commit. Strengthen an existing exact pin and never weaken an unrelated assert. Never rewrite the task body and never add a heading.

## Run the tests

- Write the union as one line at the first diff read: the suites the diff touches and the suites the Specs names. Nothing else. Add a direct-caller suite only when the diff changes a shared function's signature, return value, or side effect, never for a comment, a constant, or a one-line arithmetic edit inside a helper that one suite already covers. Never widen the union after a green run.
- Coverage map: `src/orchestrator/*` and `src/pid.ts` -> `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts`, and `src/hub.ts` -> the `tests/webui/` suites that the diff touches, and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test` or `npm test`. `tests/webui/{page,board,logpane}` start an in-process hub and `tests/kanban/*` use temp git repos, so chain those in one call with a log and an exit echo per suite. `tests/orchestrator/*`, `tests/webui/{hub,agentlog}`, and `tests/kanban/locking` spawn daemons or child processes, so run those in groups of 3 to 5 with `echo start <suite>` before each and the exit code after each.

## Write the verdict

- Collect anchors in the diff call: one `rg -n` for the changed symbols and the test or CSS pins, and keep every printed `file:line`. A line number you did not see printed is a guess. A one-line drift is not a finding, and a range you saw printed is final.
- Append the block with `cat >> SPECS.md <<'EOF'` and verify it in the same call with `tail -3`. Do not use `edit` and do not read the file again. Start a first pass with `Review of <sha> (first pass):` and a re-review with `Re-review of <sha>:`. Never add a heading of any level.
- Keep the block short: one verdict line, one evidence line per spec claim that could fail (four at most, each with a `file:line`), one test line with exit codes, and one line per non-blocking note. Never restate the Specs, the diff, or an earlier pass.
- The tail has one order: append the findings, commit only if you edited code, `tool_search("kanban")` once if the kanban tools are not loaded, `kanban_get({})`, `kanban_set_state`. The `kanban_get` is the last call before the move and the only one. Only its `state` field matters, and it must match the state from the start. The final text is exactly `Moved #<nn> to <state>.`

## Repo facts and shell traps

- Repo facts: `package.json` has only `test` and `test:changed`, so there is no typecheck or lint to look for, and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. `tests/helpers.ts` exports its cleanup helpers as `export const`, and `cleanupAll` is idempotent. In a worktree `AGENTS.md` is the role file symlink, so `AGENTS.<role>.md` exists only in the main checkout.
- Symlinks: `.kanban/`, `SPECS.md`, and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored and `git status` never lists these paths. Git pathspecs under `.kanban` fail with "beyond a symbolic link", so use an absolute `-C <checkout-root>`.
- Shell traps: a grep with no output is not an absence. Drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same block. Confirm the path and pattern before you conclude. Inspect files with `read` and anchors with `grep -n` or `rg -n`, never `sed` or `awk`. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?`, and add `|| true` only for an absence claim.
