---
name: "chore: merge origin/main into main"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Merge origin/main (199 commits since fee5420) into local main so subsequent work builds on the newest code, including the merged fixes for tasks 000037, 000042, 000043, 000045. Required before the .kanban reconcile fix.

# Specs
# Context

Local main and origin/main diverged at fee5420 (89 local commits vs 199 on origin/main). origin/main carries merged fixes this project needs as a base: mirror commit label handling, fresh-clone bootstrap materialize, webui scrollbar/theme, orchestrator_wait board feed from project root. The user approved merging origin/main into local main before new work.

# Specs

- In the task worktree (branched from main), run `git merge origin/main`.
- Expect conflicts around src/orchestrator.ts, src/kanban.ts, src/webui.ts, test files, SPECS.md. Resolution policy: keep origin/main's versions for the fixes it carries (listed above); keep local-only additions from the 89 local commits; where both sides changed the same function, merge both intents.
- Do NOT touch .kanban/ contents; the board is untracked on both branches. Do not stage or unstage anything (the main checkout's staged .kanban files are handled by another task).
- After resolving, run the repo's full check (see package.json scripts; typecheck/build plus the test suite) and make it pass on the merged tree.
- Commit the merge on the task branch; the orchestrator merges it into main.
- Do not push.

# Acceptance

- After the done-merge, `git merge-base --is-ancestor 59f2233 main` succeeds.
- Typecheck/build and the full test suite pass on the merged tree.
- The merge diff touches no .kanban files.

# Notes
