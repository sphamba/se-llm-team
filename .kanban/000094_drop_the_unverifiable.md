---
name: "chore: drop the unverifiable typecheck acceptance line; name the runnable checks"
priority: "low"
state: "to-merge"
worktree: "chore/94-drop-the-unverifiable"
---

# Summary
The standing acceptance line "Typecheck and the full test suite pass" cannot be executed: the repo has no tsconfig, no package.json script, no installable TypeScript, and a strict run reports ~25 pre-existing errors across src/webui.ts and src/hub.ts. Update the PM skill so acceptance criteria name only runnable checks (the three node suites), and ad hoc tsc baseline comparisons are Notes evidence rather than acceptance.

# Specs
Finding from the live test of #47: the acceptance line "Typecheck and the full test suite pass" cannot be verified. This task takes the second of the two options the finding proposed - drop the unverifiable line and name the runnable checks. The alternative (a real gate: tsconfig + `tsc --noEmit` + typescript devDependency, with the errors fixed) was evaluated and is deliberately deferred, see the facts below; it should be its own medium task if the user wants it.

Facts (verified 2026-10-11):
- No tsconfig anywhere in the repo (`ls tsconfig*` is empty); package.json has no scripts; the `tsc` on PATH (under the nvm node bin) is the npm placeholder package, not a compiler. The three suites run via node type stripping: `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts`.
- The "Typecheck and the full test suite pass" line appears only in PM-written task Specs. A repo-wide grep for "typecheck" outside .kanban/ and .worktrees/ finds nothing - not in README, agents/*.md, docs/, or skills/. There is no template file; skills/se-llm-team/SKILL.md step 5 is the only place that defines how acceptance criteria are written ("write needs, constraints, and acceptance criteria in full detail").
- An ad hoc strict run on current main 50c7d38 (TypeScript 5.9.3 + @types/node from another local checkout; flags `--noEmit --strict --target es2022 --lib es2022,dom,dom.iterable --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --types node`) over src/kanban.ts, src/orchestrator.ts, src/webui.ts, src/hub.ts and the three test files reports 25 `error TS` lines, nearly all implicit-any or index-signature findings in src/webui.ts and src/hub.ts, before counting anything #47's merge adds. #47's review measured 4 errors in src/webui.ts on the then-current main and 16 on the branch, one of them src/webui.test.ts:148 calling cardHtml with a partial Task literal.
- A dependency-based gate cannot be installed by this pipeline: `corepack pnpm add -D typescript` fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / "Read-only file system" (same limitation as #89), reproduced in /tmp even with custom `--store-dir`, `--state-dir`, `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME` and `PNPM_HOME` redirections. Adding dependencies would also contradict #89's "no dependencies, no committed lockfile" premise and README's "There are no dependencies and no lockfile yet" line.
- The gate therefore needs the full src error set fixed (webui.ts + hub.ts + tests) plus a working package install: not a low chore, and it touches the same files as the queued webui tasks #77 / #79 / #81 / #88.

Changes:
1. In skills/se-llm-team/SKILL.md, state the acceptance baseline for task Specs: acceptance criteria must be checkable commands that exist in the repo - `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts`, plus any task-specific browser or CLI check.
2. State explicitly that this repo has no tsconfig and no typecheck command, so "Typecheck and the full test suite pass" must not be written as an acceptance criterion; an ad hoc strict tsc comparison against the pre-change baseline may be reported in # Notes as supporting evidence only, never as acceptance.
3. Keep it short: a few lines in the existing step 5 / Specs guidance. Do not restructure the skill or import a new format.

Acceptance:
- skills/se-llm-team/SKILL.md names the three suite commands as the runnable acceptance baseline and no longer implies a typecheck requirement.
- No other file changes: README's Checks section belongs to #90, don't touch it.
- `node src/kanban.test.ts`, `node src/orchestrator.test.ts` and `node src/webui.test.ts` still pass (docs-only change).

Constraints:
- File: skills/se-llm-team/SKILL.md only.
- Do not add tsconfig.json, package.json scripts, dependencies, a lockfile or any TypeScript tooling in this task - that is a separate decision (see facts).
- Do not edit other task files, other agents' prompts or the board.

# Notes
- Changed `skills/se-llm-team/SKILL.md` step 5 only (commit b31fae3): added two bullets naming `node src/kanban.test.ts`, `node src/orchestrator.test.ts` and `node src/webui.test.ts` as the acceptance baseline, and stating the repo has no tsconfig and no typecheck command, so "Typecheck and the full test suite pass" must not be an acceptance criterion (an ad hoc strict tsc comparison against the pre-change baseline belongs in # Notes as evidence only).
- No other file changed; README untouched (belongs to #90). No tsconfig, package.json scripts, dependencies, lockfile or TypeScript tooling added.
- Ran all three suites on the branch: `node src/kanban.test.ts` (all assertions passed), `node src/orchestrator.test.ts` (all smoke parts passed), `node src/webui.test.ts` (all assertions passed).
- Review: acceptance met. The diff against main is two bullets under step 5 of `skills/se-llm-team/SKILL.md` and no other tracked or untracked file. The first bullet names `node src/kanban.test.ts`, `node src/orchestrator.test.ts` and `node src/webui.test.ts` as the acceptance baseline, plus task-specific browser or CLI checks. The second bullet states that the repo has no tsconfig and no typecheck command, bans the typecheck acceptance line, and allows an ad hoc strict `tsc` comparison in # Notes as evidence only. The skill was not restructured. No tsconfig, package.json scripts, dependencies, lockfile or TypeScript tooling added. README untouched. Ran the three suites on the branch: all pass, exit 0. A dry-run merge of main into the branch is clean, and main did not touch `skills/se-llm-team/SKILL.md` since the merge base. No fixes made.
- Live test (2026-10-11, branch b31fae3):
  - Read the changed section as a user of the skill: `skills/se-llm-team/SKILL.md` step 5 now carries exactly two added bullets. The first names `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` as the acceptance baseline plus task-specific browser or CLI checks. The second states the repo has no tsconfig and no typecheck command, bans "Typecheck and the full test suite pass" as acceptance, and allows an ad hoc strict tsc comparison in # Notes as evidence only. Step 5 was not restructured.
  - Grep for "typecheck" outside `.kanban/` and `.worktrees/`: only the two new lines in `skills/se-llm-team/SKILL.md`. README untouched.
  - Ran the three runnable suites: `node src/kanban.test.ts` (all assertions passed, exit 0), `node src/orchestrator.test.ts` (all smoke parts passed, exit 0), `node src/webui.test.ts` (all assertions passed, exit 0).
  - Confirmed no tsconfig (`ls tsconfig*` empty), package.json has no scripts, no dependencies and no devDependencies.
  - `git diff main...HEAD --name-only` lists only `skills/se-llm-team/SKILL.md`; `git status --porcelain` is empty. No tsconfig, package.json scripts, dependencies, lockfile or TypeScript tooling added.
  - Result: all acceptance criteria met. No issues found.
