---
name: "feat: Splitter card and logs on the task details view"
priority: "medium"
state: "to-do"
worktree: ""
issuer: "#241"
complexity: "moderate"
shortName: "splitter-card-logs"
---

# Summary
Close the Splitter visibility gap: splitter runs get no card on the task details view and their logs 404 because the log-role validation omits "splitter". Show a Splitter card (before the Developer card, Doctor's blue palette, token/duration stats) and make its log open in the log pane.

# Specs
## Goal
The task details view shows agent run cards (Developer) and Doctor cards, but Splitter runs are invisible: the log-role validation omits "splitter", so splitter runs get no card and their logs 404. Decided UX: show the Splitter card and its logs on the task details view, before the Developer card, with the Doctor's blue palette.

## Facts (measured)
- The Splitter feature (#241, commit 1b1120d) spawns splitter runs that write logs named <slug>.splitter.0.log under .kanban/.logs.
- LOG_ROLES (src/webui/logpane.ts:16) and agentLogPath's role regex (src/webui/payload.ts:177) omit "splitter": splitter runs get no card in the detail view; GET /api/agent-log?file=<slug>.splitter.0&sub=list answers 404 (verified).
- Agent run cards render in renderAgent (src/webui/page.ts:739-783) reading the task detail's t.agents; stats come from agentStatsText (src/webui/board.ts:51-53); the log pane opens via openLog/pollLog with logUrl (page.ts:625).
- Doctor cards render in renderDoctor (src/webui/page.ts:789-824) with a blue palette.
- The detail endpoint (GET /api/task-detail?num=N -> taskDetail, payload.ts:474-492) serves the agent history; the run row sort lives at payload.ts:88-99.

## Required changes
1. Accept the "splitter" role in log handle validation: LOG_ROLES (src/webui/logpane.ts:16) and the agentLogPath role regex (src/webui/payload.ts:177) include "splitter", so splitter logs resolve (.log and .log.gz) and sub=list and chunked reads work.
2. The agent history (and therefore the detail endpoint) includes splitter runs, so the detail view renders a card per splitter run.
3. Card ordering: the Splitter card renders before the Developer card (chronological order if that already puts it first, otherwise explicit role ordering).
4. Splitter card styling: the same blue palette color the Doctor card uses.
5. Splitter stats (tokens/duration) in the card, like the other agent run cards.
6. The board card footer (taskStats) counts splitter runs consistently with the other roles.
7. The log pane (openLog/pollLog) opens a splitter run's log like any other agent card's log.

## Constraints
- No new dependencies, no framework; keep the template-string client.
- Do not change the .kanban task file format or the log file formats.
- Do not change the /api/tasks light-row contract (#245) or the task detail modal's loading UX (#246).

## Acceptance criteria
- `pnpm test` passes, including tests in tests/webui.test.ts that assert: a splitter log handle resolves, sub=list answers 200 (an empty list is valid when the run spawned no subagents), and the chunked read works; the agent history includes splitter runs; the detail renders the Splitter card before the Developer card.
- Manual check (live test): open a task that went through a Splitter pass; the Splitter card shows before the Developer card in the Doctor's blue palette with token/duration stats, and clicking it opens the splitter log in the log pane.

# Notes
