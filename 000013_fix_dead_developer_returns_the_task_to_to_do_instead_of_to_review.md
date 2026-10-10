---
name: "fix: dead Developer returns the task to to-do instead of to-review"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Change DEAD_TRANSITIONS.doing in src/orchestrator.ts from to-review to to-do, so a Developer that dies without updating the task state gets a fresh re-run instead of sending possibly unfinished work to review.

# Specs
# Need

When a Developer agent dies without updating the task state, the task must return to to-do (a fresh Developer re-runs), not to to-review (a Reviewer would review unfinished work).

# Facts

- src/orchestrator.ts, DEAD_TRANSITIONS const (~:205): `{ doing: "to-review", reviewing: "to-review", "live-testing": "done" }`. The poll applies it when an agent pid is dead and the task state is unchanged. Key doing means a Developer runs; it moves to to-review today.
- The normal completion path is untouched: a finished Developer sets to-review itself, so the poll transition fires only for abnormal deaths. The poll transition is capped at 5 per task; the cap stays.
- Tasks 000005 (reviewing) and 000007 (live-testing) are in flight; 000005 edits src/orchestrator.ts in a different area (worktree and commit code). Keep this diff inside the DEAD_TRANSITIONS area so lanes stay merge-clean.

# Required behavior

1. src/orchestrator.ts DEAD_TRANSITIONS: `doing: "to-review"` → `doing: "to-do"`.
2. Grep README.md and SPECS.md for documented dead-agent transitions; update any text that says a dead Developer sends the task to review.
3. Nothing else changes: the reviewer (reviewing → to-review) and live-tester (live-testing → done) transitions stay.

# Constraints

- Minimal diff: one line plus doc text. No new config. The cap stays.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass; check src/orchestrator.test.ts for an assertion of the old doing→to-review transition and update it to to-do.
- With a dead Developer pid, the next poll moves the task to to-do and a fresh Developer spawns.

# Notes
