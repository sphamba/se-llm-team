---
name: "fix: pnpm pin makes every pnpm invocation write an untracked pnpm-lock.yaml"
priority: "low"
state: "done"
worktree: ""
---

# Summary
The `packageManager: "pnpm@12.11.2"` pin from #86 makes every pnpm invocation in the project (even read-only ones like `pnpm --version` / `pnpm pkg get`) write an untracked pnpm-lock.yaml (a pnpm 12 env lockfile with `packageManagerDependencies`). It is not gitignored, so the workspace dirtied after the first pnpm command, and the README line "There are no dependencies and no lockfile yet" stops being true. Gitignore the file and keep the README statement accurate.

# Specs
Genuine finding from the live test of #86 (priority low).

Facts (verified on current chore/86-configure-the-project tree):
- package.json pins `"packageManager": "pnpm@12.11.2"` (plus engines.pnpm >= 12.11.2); .gitignore contains only `.worktrees`, `node_modules/`, `.kanban/`.
- Any pnpm invocation inside the project writes an untracked `pnpm-lock.yaml` (pnpm 12 env lockfile recording `packageManagerDependencies` for the pinned pnpm) because of the pin; a control project without the pin does not produce it. Reproduced even for read-only commands (`pnpm --version`, `pnpm pkg get`).
- README.md line ~49 states "There are no dependencies and no lockfile yet."

Changes:
1. Add `pnpm-lock.yaml` to .gitignore so the workspace stays clean after any pnpm command. Do not commit a lockfile: the repo has no dependencies, so the generated file is only the pnpm env lockfile, and #86's spec deliberately excluded dependencies/lockfiles.
2. Adjust the README "Package manager" sentence so it stays accurate: keep the fact that there are no dependencies and no committed lockfile, and note that pnpm generates an env lockfile which is gitignored. Keep it short - one sentence, no invented workflows.

Acceptance:
- After `corepack pnpm --version` (or another pnpm invocation) in the project, `git status --porcelain` is empty.
- README no longer claims there is no lockfile while a generated one exists.
- `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` all pass.

Constraints:
- Files: .gitignore, README.md only.
- Do NOT try to fix `pnpm install` failing with ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK: reproduced in a control project without the pin, so it is a sandbox mount limitation, not a project defect.

# Notes

Developer run (fix/89):
- Added `pnpm-lock.yaml` to .gitignore (after `node_modules/`).
- README "Package manager" sentence now reads: "There are no dependencies and no committed lockfile (pnpm writes an env lockfile that is gitignored)."
- Checks: `corepack pnpm --version` prints 12.11.2, creates `pnpm-lock.yaml`, and `git status --porcelain` shows only the two intended file edits (lockfile is ignored; `git check-ignore -v pnpm-lock.yaml` confirms .gitignore:3). `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` all pass.
- Commit: cd6c16c. `pnpm install` left alone per the constraint (sandbox mount limitation).

Reviewer run (fix/89), reviewed cd6c16c:
- Diff touches only `.gitignore` and `README.md`, as the constraint requires. `pnpm install` untouched.
- Acceptance verified in the worktree: `corepack pnpm --version` printed 12.11.2 and created `pnpm-lock.yaml` (fresh timestamp), then `git status --porcelain` was empty; `git check-ignore -v pnpm-lock.yaml` resolves to `.gitignore:3`. The lockfile is not tracked (`git ls-files pnpm-lock.yaml` empty).
- README line 49 no longer claims there is no lockfile; the other "lockfile" mention (line 59) is the orchestrator lock, unrelated.
- `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` all pass.
- No fixes made; no open questions.

Live-tester run (fix/89), tested cd6c16c:
- Removed the generated `pnpm-lock.yaml` to start clean; `git status --porcelain` was empty before.
- Ran `corepack pnpm --version` -> 12.11.2, and it created `pnpm-lock.yaml` (4606 bytes, contains `packageManagerDependencies: pnpm 12.11.2`, i.e. the pnpm env lockfile). `git status --porcelain` was empty afterwards.
- Ran `corepack pnpm pkg get packageManager` -> `pnpm@12.11.2`; `git status --porcelain` still empty.
- `git check-ignore -v pnpm-lock.yaml` -> `.gitignore:3:pnpm-lock.yaml`. `git ls-files pnpm-lock.yaml` empty (not tracked). `.gitignore` line order intact (`.worktrees`, `node_modules/`, `pnpm-lock.yaml`, `.kanban/`).
- README line 49 now reads "There are no dependencies and no committed lockfile (pnpm writes an env lockfile that is gitignored)." The only other "lockfile" mention is the orchestrator lock (`.kanban/.orchestrator.lock`), unrelated. Statement is accurate.
- `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` all pass.
- All acceptance criteria met. No issues found. No open questions.

Merger run (merge fix/89-pnpm-pin-makes -> main):
- Step 1 (worktree): merged main into the branch; git auto-resolved the only overlapping file (README.md) and both intended changes survived: .gitignore has `pnpm-lock.yaml` after `node_modules/`, and README line 49 reads "There are no dependencies and no committed lockfile (pnpm writes an env lockfile that is gitignored)." No conflicts, no manual resolutions needed. Test suites `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` all pass on the merge commit (9b08473); no extra fixes required.
- Step 2 (root): merged fix/89-pnpm-pin-makes into main as a fast-forward (b4914bf..9b08473). `git status --porcelain` clean in root and worktree after both merges. `pnpm install` left alone per the constraint.
