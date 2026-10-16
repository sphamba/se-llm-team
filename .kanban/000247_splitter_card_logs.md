---
name: "feat: Splitter card and logs on the task details view"
priority: "medium"
state: "done"
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
- Splitter pass (#247): no split. The work is one tight chain, not parallel pieces: the role validation (LOG_ROLES + agentLogPath regex) feeds agentHistory, which feeds the detail payload's t.agents, which renderAgent, taskStats, and openLog all read. Backend and frontend pieces would both add tests to the shared 2000-line tests/webui.test.ts hub, and two review/merge/live-test cycles outweigh two ~20-line coupled diffs. Run as one moderate task.
- Shipped (commit 19e7853): LOG_ROLES leads with "splitter" (pipeline order, before the developer) and agentLogPath's role regex accepts it, so splitter handles resolve for .log and .log.gz, sub=list and chunked reads; agentHistory enumerates the role, so the detail payload's t.agents carries splitter runs, taskStats sums them through the shared agents array, and the log pane opens a splitter log like any other run card. Card order needed no explicit role ordering: the Splitter runs on the to-do task before the Developer (startTodo, src/orchestrator/pipeline.ts), so the history sort (start ?? mtime) already puts it first.
- renderAgent gives a splitter run's card a new agent-splitter class instead of reusing agent-doctor: the relation-chain selectors (#m-agent-btns > .agent-col > .agent-card:not(.agent-doctor)) must keep counting it as a run card, so the doctor class would break the splitter-to-developer connector. The CSS mirrors the doctor trio (rest text, .agent-card-active outline and highlight, .check) off the same --doctor-fg/--doctor-bg-strong variables.
- Tests (red first, then green): LOG_ROLES membership, a renderAgent class pin and three CSS pins in tests/webui.test.ts, plus a daemon block asserting the history order (splitter 0 before the developer, backdated mtime via utimesSync to mirror the pipeline chronology), the taskStats sum, sub=list 200 with an empty list, and tail and poll reads. webui.test.ts is the scoped suite (all changed files) and passes; the full pnpm test was not run (scoped suite stands in, stated as the deviation). Live check (fixture /tmp/spl247, port 4399, Playwright): a done probe with splitter and developer JSONL run logs renders the Splitter card first with 2k · 30s in rgb(47, 111, 221), clicking it opens the splitter log in the log pane and marks the card active, and the developer click switches logs.

- Re-review at 19e7853: all seven spec points hold. Req 1 settles in the diff (LOG_ROLES leads with "splitter", the agentLogPath regex accepts it); req 2 via agentHistory iterating LOG_ROLES (payload.ts:105); req 3 via startTodo spawning the Splitter before the Developer fall-through (pipeline.ts:47), so the start/mtime sort puts the card first with no explicit role ordering; reqs 4-7 via the shared data-handle/stats paths and the --doctor-fg/--doctor-bg-strong palette. Scoped webui.test.ts exit=0 (history order, taskStats "2k · 40s", sub=list 200, tail and poll reads). No fixes. The Open-questions note was a technical contingency (answerable in code), not a user question, and is removed.

## Live test (merged 19e7853)
Fixture: hub-only, root /tmp/lt247/repo on port 4351 with an isolated HOME. Task 000300_FIXTURE_spl_probe (done) has a splitter.0 run log, a developer.0 run log and a past developer.0.doctor log. Task 000301_FIXTURE_gz_probe (done) has only a splitter.0.log.gz. The fixture keeps the real pipeline chronology (the splitter log starts 60 s before the developer's). Script /tmp/lt247/check.mjs: 21 checks, 0 failed. No product issue.

- Log handles: a splitter tail read answers 200 and renders `<p>SPLITTERMARKER splitter plan paragraph</p>` for the plain .log and `<p>GZMARKER splitter gz paragraph</p>` for the .log.gz. `sub=list` answers 200 `[]`. An unknown role handle stays 404.
- Detail payload: `/api/task-detail?num=300` lists splitter (2400 tokens, 30 s) before developer (600 tokens, 10 s). The gz splitter run reaches the history of task 301.
- Board footer: the done card's `.card-stats` reads `3k · 40s`, the splitter plus the developer run.
- Detail view: the run cards sit in DOM order splitter then developer. The splitter card carries `agent-card agent-splitter agent-past` (not agent-doctor) with a past `.check`. Its stats read `2k · 30s` against the developer's `600 · 10s`.
- Palette (measured, light theme): the splitter text and check are `rgb(47, 111, 221)`, equal to the doctor card's, and the developer run card stays `rgb(242, 151, 24)`. The active splitter card shows border `rgb(47, 111, 221)` and background `rgba(47, 111, 221, 0.24)`, equal to the active doctor card's.
- Log pane: clicking the splitter card opens the pane with the splitter log and no developer text, and the card turns active. A developer click switches the log. A second splitter click reopens the splitter log. No page errors.
- Chunked poll: an appended no-timestamp line read at the recorded tail streams only `<p>SPLITTERLATEMARKER appended paragraph</p>`.
- Assumptions: the probe task is a done task with past cards (no pid, no aliveness). The splitter log carries the earlier start, so the history sort puts its card first. That is the real pipeline order.
- Fixture-side remark, not a product finding: the hub caches the agent stats of done tasks per task file and parses a log per file size. A fixture log rewrite without a size change keeps the old values until a hub restart.
