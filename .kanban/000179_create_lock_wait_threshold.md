---
name: "fix: createTask lock wait is shorter than the stale-lock steal threshold"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#174"
complexity: "simple"
shortName: "create-lock-wait-threshold"
---

# Summary
In src/kanban.ts createTask the lock acquisition loop gives up after about 1 s, but a leftover .create.lock is stolen only when its mtime is older than 10 s. After a creator dies while holding the lock, every kanban_create fails for up to about 10 s. Make the wait cover the steal threshold, or steal sooner.

# Specs
# Summary
In `src/kanban.ts` `createTask` the lock acquisition loop waits about 1 s (100 iterations x 10 ms) before failing with `could not lock "<dir>" for task creation`, but a leftover `.create.lock` is stolen only when its mtime is older than 10 s. After a creator process dies while holding the lock, every `kanban_create` fails for up to about 10 s.

# Specs

## Problem
- `src/kanban.ts`, `createTask`: the lock acquisition loop retries about 100 times with a 10 ms sleep (about 1 s total), then throws `could not lock "<dir>" for task creation`.
- A stale `.create.lock` is stolen only when its mtime is older than 10 s.
- Live evidence (from the #174 live test): with a fresh `.create.lock` held for 8 s, the real `kanban_create` tool returned `could not lock "/tmp/lt174/repo/.kanban" for task creation` after about 1 s. A lock backdated 60 s was stolen and creation succeeded.
- Consequence: after a creator process dies while holding the lock (crash or SIGSTOP), every `kanban_create` fails for up to about 10 s.
- Under a real 8-process concurrent load (24 creates through the `kanban_create` tool) no failure occurred, so the window requires a holder stuck for more than about 1 s.

## Fix
- Make the wait-before-failure window at least as long as the stale-lock steal threshold (so a dead holder is always recovered before the caller gives up), or steal sooner by lowering the threshold to within the current wait window. Either is acceptable; keep the two values consistent so they can no longer cross.
- Keep the age-based steal semantics: a live holder must not have its lock stolen while it is inside the critical section.

## Acceptance criteria
- `node src/kanban.test.ts` passes.
- A check demonstrates the failure window is recovered rather than fatal: with a fresh `.create.lock` held past the steal threshold, `createTask` waits, steals the stale lock and succeeds instead of failing after about 1 s (e.g. a test that holds a fresh lock and asserts creation succeeds once the threshold passes, or equivalent live CLI evidence).
- No regression in concurrent creation: the existing multi-process create test in `src/kanban.test.ts` still passes.

# Notes
- Filed from the #174 live-test report (merged commit e33bf83). The lock loop and the steal threshold are both in `src/kanban.ts`.

# Notes
