---
name: "fix: promotion re-checks the gates on a fresh task read"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#133"
complexity: "moderate"
shortName: "fresh-read-promotion-gates"
---

# Summary
The orchestrator's rescan and poll read the board once and then promote from that stale snapshot. A user or PM edit that lands while a sweep is in flight (for example setting a backlog task to done, or adding a blockedBy ref or an openQuestion) is silently overwritten by the promotion pass. Re-check the three promotion gates on a fresh read just before setState.

# Specs
# Context

Live test of #133 on scratch board `/tmp/lt133/d` against worktree commit `00e35bf` (2026-10-12). The new promotion pass can silently overwrite a board file edit that lands while a sweep is in flight.

# Problem

In `src/orchestrator.ts`, `rescan` and `poll` take one `listAll` board snapshot, run the state loop, then call `dropDoneBlockers` and `promoteBacklog` on that snapshot. `promoteBacklog` evaluates the three gates (not conflicted, empty openQuestions, no undone blockedBy ref) on the snapshot and calls `setState`, which reads the file fresh but patches only the `state` attribute. So a file edit that lands after the snapshot but before the promotion pass is never re-checked.

# Live evidence

- Reproduction 1: at 04:11:49.590 the user created a new unblocked backlog task `000003_victim_two.md`. At 04:11:52.595 the user set it to done while the sweep triggered by the create was still in its state loop (600 filler files made the sweep slow). At 04:12:18.452 that same sweep logged "promoting 000003_victim_two.md to to-do (blockers done)" and rewrote the state from done back to to-do. The daemon then spawned a developer for the cancelled task.
- Reproduction 2: an existing backlog task showed the same result — "promoting 000002_victim.md to to-do (blockers done)" at 04:11:33.632, after the user set it to done at 04:11:07.177.

# Impact

- A cancelled (done) task restarts.
- The same window can ignore a blockedBy ref or an openQuestions edit the PM makes during a sweep, so a task can start before its blocker is registered or before the user answer is written. That breaks the strict gates this feature introduced.
- The window is tens of milliseconds on a fast sweep and stretches with board size or slow git operations: a sweep over 600 files took 30 to 60 s in the test, because the create loop re-hashes the whole board for each new file (pre-existing).

# Notes

- The review of #133 argued the race has no in-process window. That is true for sweep/poll interleaving (they are synchronous on one event loop), but an external file edit is not in-process.

# Suggested fix

- In `promoteBacklog`, re-read the task (`getTask` or `listAll` of that file) and re-check the three gates on the fresh copy before `setState`, or make the promotion conditional on the current state still being `backlog`.
- Do the same fresh read in the done-ref drop pass (`dropDoneBlockers`) so a newly added blocker is not dropped or missed.

# Notes
