---
name: "fix: createTask lock wait is shorter than the stale-lock steal threshold"
priority: "low"
state: "live-testing"
worktree: "fix/179-create-lock-wait-threshold"
issuer: "#174"
complexity: "simple"
shortName: "create-lock-wait-threshold"
---

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

## 2026-10-12, reviewer

- Reviewed 8f63b8f against the Specs. The fix matches the accepted approach: both the steal threshold and the give-up deadline derive from one LOCK_STALE_MS constant, so the two values can no longer cross; deadline = threshold + 5 s margin. Age-based steal semantics unchanged.
- The new test reproduces the #174 live evidence (8 s-backdated lock, under the threshold at call time) and asserts createTask waits, steals, succeeds and leaves no lock file. utimesSync seconds-vs-ms usage is correct.
- node src/kanban.test.ts passed 4x (allocation path touched, per load-sensitive guidance), including the multi-process concurrent create test. No other lock staleness values in src.
- Assumptions are documented in the task's # Assumptions section (visible, not silent). No unvoiced assumptions that affect the direction. No user/client questions.

## 2026-10-12, developer

- Replaced the 100-iteration give-up loop with a real-time deadline derived from one `LOCK_STALE_MS` constant (10 s): deadline = threshold + 5 s, so the give-up window can no longer be shorter than the steal threshold. Steal check now uses the same constant. Age-based steal semantics unchanged, so a live holder is never stolen mid-critical-section.
- Added a test in `src/kanban.test.ts`: a `.create.lock` backdated 8 s (the #174 live evidence) is under the threshold at call time and ages past it while `createTask` waits. Old code failed after about 1 s. New code waits, steals, succeeds, and leaves no lock file.
- `node src/kanban.test.ts` passes (2.5 s, the new wait included). `orchestrator.test.ts` and `extension.test.ts` pass. The multi-process concurrent create test is unchanged and still passes.
- Committed as 8f63b8f on fix/179-create-lock-wait-threshold.

## 2026-10-12, merger

- Step 1: merged main into fix/179-create-lock-wait-threshold in the worktree. Clean merge (ort strategy, no conflicts), commit 8521d5b. main had moved ahead with webui work (src/webui.ts, src/webui.test.ts); no overlap with the fix. Test suites skipped per the clean-merge rule.
- Step 2: merged fix/179-create-lock-wait-threshold into main in the project root. Fast-forward to 8521d5b, no conflicts.
- No user/client questions.

# Open questions

# Assumptions
- Steal threshold stays at 10 s. I extended the give-up window instead of lowering the threshold, so a live-but-slow holder never loses its lock mid-critical-section.
- The give-up window is threshold + 5 s margin (15 s total). Long waits only happen when a holder is genuinely dead or stuck.
- The lock value (pid string) and all other lock semantics stay unchanged.
