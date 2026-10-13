---
name: "feat: orchestrator PM reports queued to the chat"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "pm-report-queue"
blockedBy: "#188"
---

# Summary

When one or several tasks move to done, the orchestrator schedules unblocked tasks, then queues a report message to the pi session that runs at the same ROOT as itself. The report reaches the chat through a report-file queue read by the extension. The watcher subagent and the orchestrator_wait tool go away; SKILL.md simplifies to say the orchestrator sends reports and instructions.

# Specs

## Report composition (orchestrator, src/orchestrator/)
- On the sweep that moves one or several tasks to done: first schedule unblocked tasks, then compose ONE report covering every task that moved to done in that sweep (one report per done sweep, even for several tasks).
- The orchestrator writes the report to .kanban/.reports/<sortable-timestamp>.md (atomic write: tmp file + rename; oldest file first).
- Report content:
  - The done tasks (name and shortName).
  - The tasks the sweep scheduled (the unblocked backlog tasks it promoted, with their new state).
  - Per finished task: its live-test findings — the tasks whose issuer attribute is the finished task's number, each with its name and its '# Open questions' body section (the section carries the issues, the assumptions, and the open questions).
  - Instructions for the PM: create new tasks based on the report, and ask the user the open questions immediately via the structured dialogs.
- The orchestrator prunes .kanban/.reports/ files older than the delivery cutoff on each sweep (bounded growth).

## Delivery (extension, index.ts)
- The extension watches .kanban/.reports/ (fs.watch started from session_start, same lifecycle as ensureBoardWatcher) in every session.
- Only a session whose cwd is the repo root consumes reports: the gate is the git worktree topology check (git rev-parse --git-common-dir equals --show-toplevel at the root; a worktree session differs). Extract that check into a shared helper (src/kanban.ts or src/pid.ts) and reuse it in src/hub.ts (the #168 hub-candidacy rule) and the extension gate.
- Consumption protocol: claim the oldest report by atomic rename (e.g. <name>.claiming), call pi.sendMessage({customType: "board-report", content: <report text>, display: true}, {triggerTurn: true when idle, deliverAs: "followUp" when busy}), then delete the claimed file. A process death between claim and send is cleaned by the orchestrator prune.
- On session start at the root: drain the queue — deliver the latest reports (younger than a 1 h cutoff) and delete them; discard (delete) older ones. A report landing while no session is open is therefore delivered on the next start or dropped when stale.
- Worktree sessions (the role agents after #187) never consume; they stay silent. pi.sendMessage is a session-core call and works in all modes.

## Remove the old ritual
- Delete the orchestrator_wait tool (index.ts) and its waitForBoardCommits function (src/orchestrator/board.ts) with its tests. Reports are the only channel.
- Delete .pi/agents/watcher.md. The PM spawns no watcher subagents.

## SKILL.md simplification
- The Watcher section and the board-check rituals are replaced by a short paragraph: the orchestrator sends reports and instructions to the PM session when tasks move to done; the PM creates new tasks from the report and asks the user the open questions immediately. No watcher subagent and no orchestrator_wait references remain. The rest of the skill (pipeline, per-role notes) stays.

## Tests
- Report composition (tests/orchestrator.test.ts, real daemons): a done sweep writes one report with the done tasks, the scheduled tasks, the issuer-matched findings with their open-questions sections, and the PM instructions; several done tasks land in one report.
- Prune: reports and claims older than the cutoff are pruned on the sweep.
- Delivery (index/extension suites, stubbed pi): a root session consumes a report (sendMessage fired, file deleted), a worktree session does not, and a session start drains fresh reports and discards stale ones.
- The orchestrator_wait tool and waitForBoardCommits are gone; .pi/agents/watcher.md is gone.

## Docs
- README.md: the PM-report flow replaces the watcher ritual; no orchestrator_wait references remain.

# Notes
- The 1 h delivery cutoff is a deliberate choice for "the latest reports"; adjust it in one constant.
