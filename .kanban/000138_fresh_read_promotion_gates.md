---
name: "fix: promotion re-checks the gates on a fresh task read"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
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

- Fixed in worktree commit 8d2eb82. `promoteBacklog` now re-reads the board (`listAll`) and re-checks the three gates (not conflicted, state still backlog, empty openQuestions, no undone blockedBy ref) just before `setState`. The snapshot gates stay as a cheap pre-filter. A task deleted mid-sweep skips. The `promoting` log line now fires only when the fresh re-check passes.
- Both call sites are covered: `rescan` and `poll` share `promoteBacklog`.
- `dropDoneBlockers` stays on the snapshot read on purpose: it is board hygiene, not a promotion gate (the spec scope is the promotion gates), and its stale case only defers a ref drop to the next sweep. Reviewer may flag it if wanted.
- Regression test part AR in `src/orchestrator.test.ts`: a mid-sweep done rewrite, an openQuestions edit and a blockedBy ref all survive a promotion pass on a stale snapshot, and a clean candidate still promotes. All four suites pass (orchestrator, kanban, webui, extension).
- Review of 8d2eb82 (2026-10-12): the promotion fix is correct. `promoteBacklog` re-reads the board per candidate and re-checks the gates on fresh data, both call sites share the pass, and part AR covers the three gate overrides plus a clean promote. All four suites pass on my run.
- Found one gap against the Suggested fix: `dropDoneBlockers` wrote a kept list derived from the stale snapshot. `updateAttrs` writes that value over the fresh file, so a ref the PM added mid-sweep was erased, and the promotion gate then saw no blocker and promoted. The note claim that the stale case "only defers a ref drop" was not complete. Fixed in worktree commit d657959: the kept/dropped split now comes from a fresh task read just before the write. The snapshot `blockedBy` stays as a cheap pre-filter, and a vanished or conflicted task skips. Part AR now also covers a mid-sweep added ref and a mid-sweep removed ref. All four suites pass.
- State set back to to-review for a re-review of d657959.
- Review of d657959 (2026-10-12): correct against the Specs. `promoteBacklog` re-reads the board per candidate and re-checks the gates (vanished, not conflicted, state still backlog, empty openQuestions, no undone blockedBy ref) on the fresh copy just before setState. `dropDoneBlockers` computes the kept and dropped lists from a fresh task read just before the write. Both call sites (rescan, poll) share the passes. Part AR covers the three promotion overrides, the clean promote, the mid-sweep added ref and the mid-sweep removed ref. All five check suites pass on my run (orchestrator, kanban, webui, extension, index). No fixes made.
- Two cosmetic comment notes, left as is: the dropDoneBlockers doc comment ends with a dangling possessive ("over the snapshot's"), and the poll call site comment does not mention the fresh re-read (the snapshot is the input; the fresh read follows).
- Merged 2026-10-12. Step 1: in worktree fix/138-fresh-read-promotion-gates, merge main was already up to date (main tip d5a1ca1 is the branch merge-base), clean, no conflicts, no test run per merge policy. Step 2: in project root on main, merged fix/138-fresh-read-promotion-gates as a clean fast-forward to d657959 (src/orchestrator.ts and src/orchestrator.test.ts, +73/-10). Root checkout was on main at both steps, not detached. No open questions.
