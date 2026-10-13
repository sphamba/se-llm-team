---
name: "fix: report tasks unblocked by the same done sweep"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#190"
complexity: "simple"
shortName: "report-same-sweep-unblocked"
---

# Summary
A backlog task whose blockedBy ref is satisfied by the same sweep's done move is not promoted in that sweep; it is promoted silently one sweep later, and no board report ever names it, although the Specs read as if the sweep schedules the unblocked tasks and lists them in its one report.

# Specs
Found in the live test of #190.

Repro (fixture): a to-merge task with nothing to merge (000006_epsilon.md), a backlog task blocked by it (000009_schedblocked.md, blockedBy "#6"), and an already-unblocked backlog task (000008_sched.md). Run a daemon with --rescan-seconds 1. 000006 reaches done in the sweep that queues report 2026-10-13T11-40-00-550Z.md; the report's Scheduled section lists only 000008. The daemon log shows the next sweep (one rescan later) at 11:40:01.222 dropping the now-satisfied blocker ref "#6" and promoting 000009 at 11:40:01.223, with no report for that sweep (a report is composed only when a task moves to done).

Root cause: dropDoneBlockers and promoteBacklog in src/orchestrator/pipeline.ts decide blockers from the sweep's pre-state snapshot, so a blockedBy ref satisfied by that same sweep's done move is handled one sweep later.

Expected behavior to decide: either promote the unblocked backlog task in the same sweep and name it in that sweep's report (matching the Specs: "On the sweep that moves one or several tasks to done: first schedule unblocked tasks, then compose ONE report ... The tasks the sweep scheduled"), or keep the one-sweep-later delay as accepted behavior.

Note: in the normal pipeline dependents usually promote when their blocker enters the live test, so this only bites the done-without-live-test path (e.g. to-merge with nothing to merge) and hand-set done moves.

Acceptance: an orchestrator-flow fix, checked against the real daemon path (fixture above) rather than only unit tests.

# Notes

# Open questions
Should a backlog task whose blocker reaches done in the same sweep be promoted in that sweep and named in that sweep's report, or is the one-sweep-later silent promotion acceptable?
