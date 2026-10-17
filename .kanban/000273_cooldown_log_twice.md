---
name: "fix: poll.test.ts cooldown log fires twice on main"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#270"
complexity: "moderate"
shortName: "cooldown-log-twice"
---

# Summary
node tests/orchestrator/poll.test.ts fails on a clean main checkout: the "respawn waits for the idle cooldown" log fires twice within the 30 s window but the test asserts exactly once (actual 2, expected 1). The log site is designed to fire exactly once per death streak (bumpCounter === RESPAWN_CAP + 1), so either the streak cleared and re-reached the cap, or a bounce/counter change after the test split broke the exactly-once property.

# Specs
Goal: find the root cause of the double cooldown log on main and fix the behavior (or the test, if the behavior is intended); the full suite must be green on main again.

Facts (verified 2026-10-17 on a clean main checkout, only an untracked TODO.md):
- node tests/orchestrator/poll.test.ts fails: tests/orchestrator/poll.test.ts:46 assert.equal(..., 1, "cooldown log fired exactly once") — actual 2, expected 1. The preceding waitFor (line 45, 30 s window) waits for the FIRST occurrence, so both occurrences land inside that window.
- The log site: bounceDead in src/orchestrator/liveness.ts:88-92. The line `${slug}: agent died ${RESPAWN_CAP}+ times; respawn waits for the idle cooldown (state ${next})` fires ONLY when bumpCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1 (RESPAWN_CAP default 5, config.ts defaults) — exactly once per death streak by design ("logged once at cap+1, like the old give-up line").
- The streak clears in clearDeadStreak (liveness.ts:95-99): a completed run (exit-0 handling) resets the dead counter to 0 and logs "run completed, cleared the dead-agent counter". A cleared streak that re-reaches RESPAWN_CAP + 1 logs the cooldown line a second time.
- The bounce is unconditional past RESPAWN_CAP ("a frozen mid-flight task is worse than a bounced one, only the respawn backs off"); under the cap each respawn is immediate (the test: 600 ms poll, six deaths = six bounces).
- The test scenario (poll.test.ts, scenario B, taskB/rootB): six deaths, six bounces, each carrying a per-run death marker, then the cooldown log expected exactly once at cap+1, then the task file is aged past the idle interval (utimesSync) to release the deferred respawn.
- tests/orchestrator/poll.test.ts was only touched by the test-split chore (commit 5b3e980); the regression came from a src/ change after that split.
- The Reviewer of task #270 found this in its union run (2026-10-17, base cfb11c2): poll.test.ts "cooldown log fired exactly once" fails twice on that tree, judged pre-existing relative to #270's diff and not verdict-changing. It fails on plain main too (verified).

Hunt:
1. git log the cooldown/bounce/streak area (src/orchestrator/liveness.ts, the poll exit-0 path, and anything touching `${slug}.dead` counters) since 5b3e980 to find the change that made the log fire twice.
2. Decide whether the double log is a real behavior defect (a cleared streak legitimately re-reaching the cap and logging again, or a double-bounce corrupting the death counter) or a test artifact (the fixture now triggers two streaks within the window). Fix the root cause: if the behavior is intended (a new streak may log again), make the assert match the intent and say so; if not, fix the code.
3. Check the interaction with task #266's review-counter reset (pipeline.ts rescan to-do branch) and any in-flight task touching liveness.ts (#269/#271/#272 are doing in worktrees — do not wait for them, but note if their areas overlap).
4. Keep every existing poll.test.ts assert unless the intended behavior changed; a dropped assert needs a reason.

Acceptance: node tests/orchestrator/poll.test.ts passes on main, pnpm test passes, and the exactly-once (or intended) cooldown-log property is asserted.

Out of scope: the respawn-cap semantics themselves, the webui, and the marker/scope work of #269.

# Notes
