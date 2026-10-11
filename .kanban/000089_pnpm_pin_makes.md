---
name: "fix: pnpm pin makes every pnpm invocation write an untracked pnpm-lock.yaml"
priority: "low"
state: "backlog"
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
