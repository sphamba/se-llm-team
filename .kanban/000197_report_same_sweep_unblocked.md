---
name: "fix: report tasks unblocked by the same done sweep"
priority: "low"
state: "doing"
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

# Open questions

