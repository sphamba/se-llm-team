---
name: "fix: report tasks unblocked by the same done sweep"
priority: "low"
state: "reviewing"
worktree: "fix/197-report-same-sweep-unblocked"
issuer: "#190"
complexity: "simple"
shortName: "report-same-sweep-unblocked"
---

# Summary
A backlog task whose blockedBy ref is satisfied by the same sweep's done move is not promoted in that sweep; it is promoted silently one sweep later, and no board report ever names it, although the Specs read as if the sweep schedules the unblocked tasks and lists them in its one report.

# Specs
Found in the live test of #190.

Decision (user, 2026-10-13): a backlog task whose blockedBy ref is satisfied by the same sweep's done move must be promoted in that same sweep, and that sweep's board report names it in its Scheduled section. The one-sweep-later silent promotion is not accepted.

Repro (fixture): a to-merge task with nothing to merge (000006_epsilon.md), a backlog task blocked by it (000009_schedblocked.md, blockedBy "#6"), and an already-unblocked backlog task (000008_sched.md). Run a daemon with --rescan-seconds 1. 000006 reaches done in the sweep that queues report 2026-10-13T11-40-00-550Z.md; the report's Scheduled section lists only 000008. The daemon log shows the next sweep (one rescan later) at 11:40:01.222 dropping the now-satisfied blocker ref "#6" and promoting 000009 at 11:40:01.223, with no report for that sweep.

Root cause: dropDoneBlockers and promoteBacklog in src/orchestrator/pipeline.ts decide blockers from the sweep's pre-state snapshot, so a blockedBy ref satisfied by that same sweep's done move is handled one sweep later.

Required behavior: the done sweep itself drops the satisfied blocker ref, promotes the newly-unblocked backlog task in the same sweep, and the report composed by that sweep names it in its Scheduled section. No one-sweep delay, no silent promotion.

Note: in the normal pipeline dependents usually promote when their blocker enters the live test, so this only bites the done-without-live-test path (e.g. to-merge with nothing to merge) and hand-set done moves.

Acceptance: an orchestrator-flow fix, checked against the real daemon path (fixture above) rather than only unit tests: with the fixture, 000009 is promoted by the same sweep that completes 000006, and that sweep's queued report lists 000009 under Scheduled.

# Notes

- Fix in `src/orchestrator/pipeline.ts` (commit 064592d): `rescan` re-read the board (`listAll`) after the state loop and passed the fresh list to `dropDoneBlockers` and `promoteBacklog`; `reportDone` keeps the pre-loop snapshot, so a done move the sweep itself made stays this sweep's transition. The per-task fresh-read gates in `promoteBacklog` are unchanged.
- Verified against the real daemon path, fixture from the repro (temp root, stub agent, `--rescan-seconds 1 --no-webui`): one sweep logs `000006_epsilon.md: nothing to merge, set done`, then `000009_schedblocked.md: dropped satisfied blocker ref(s) #6`, then `promoting 000009_schedblocked.md to to-do (blockers done)`, then queues the report. That report's Scheduled section lists 000008 and 000009. No one-sweep delay, no silent promotion.
- Left a deterministic check behind: `orchestrator.test.ts` part AW drives `rescan` with the fixture and asserts the same-sweep promotion, the same-sweep ref drop, and the report naming 000009 under Scheduled. Full suite green (`npm test`, exit 0).
- Residual ceiling, accepted: a done write landing in the sub-second window between the post-loop re-read and the promote pass still promotes one sweep later (no report). Narrower than the old whole-sweep window; closing it fully would need the report to cover promotions without a done transition (out of scope here).

# Open questions

Assumptions (no questions): the fix targets only the blocker-decision staleness the repro names. A done write landing in the sub-second window between the sweep's post-loop re-read and the promote pass still promotes one sweep later with no report; closing that residual race fully would need the report to cover promotions without a done transition, which I read as out of scope for this fix.

