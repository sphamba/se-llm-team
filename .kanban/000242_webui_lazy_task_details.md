---
name: "perf: defer webui task details to a per-task detail endpoint"
priority: "medium"
state: "live-testing"
worktree: "perf/242-webui-lazy-task-details"
issuer: "user"
complexity: "complex"
shortName: "webui-lazy-task-details"
---

# Summary
Split the webui initial load: /api/tasks returns light identity+summary rows, and a new per-task detail endpoint serves body, sections, agent history and log stats on open. Fixes the slow board open with many tasks (everything currently loads at once).

# Specs
## Goal
Opening the webui must be fast on a large board. The initial load fetched everything at once:
- GET /api/tasks (src/webui/payload.ts, route in src/hub.ts:215) returned EVERY task with its full markdown body (one readFileSync per task), per-run agent history, and doctor data.
- The client (src/webui/page.ts:957) re-fetches it every 5 s (1 s while a live agent is open).
- No per-task detail endpoint existed; openTask rendered data already in the initial payload.
- Log stats (statsCache, payload.ts:219) parse whole log files; on the first open after a daemon restart this synchronously parses the whole .kanban/.logs tree. Measured on this machine: 243 task files (2.5 MB markdown) + 1116 log files (429 MB).
- The DOM is not the bottleneck (syncBoard renders 5 cards per column, src/webui/board.ts:321); the payload build and transfer are.

## Decided direction (user)
- Lazy loading for ALL tasks: /api/tasks returns light rows; full details load per task when opened. Not pagination, not done-only deferral.
- Token stats ARE back on the board cards, for visible cards only: the cards each column renders without "show more" show their token stat line again. Cards behind "show more" need no stats.
- Stats for tasks in done may be cached (done logs never change); the cache must invalidate if a task leaves done.
- Doctor data confirmed OFF /api/tasks: per-task doctor entries live in /api/task-detail with the agent history. Nothing doctor-level stays on /api/tasks.

## Required changes
1. Light list payload: GET /api/tasks returns, per task, the identity + summary fields (file, num, name, shortName, state, priority, complexity, issuer, blockedBy, worktree, updated, summary) plus the agent-history token stat data the card renderer needs for the stat line and the spinners. It must NOT include body, the specs/notes/openQuestions sections, or any doctor data.
2. Stats for the visible subset only: the stat data is required for the cards each column renders before "show more" (5 per column today, per state per project). Cards behind "show more" carry no stats until shown. Keep the board payload light: no full log-tree parsing per poll for cards the user cannot see.
3. Done-task stats cached: tasks in done have immutable logs, so their stats may be cached; invalidate the cache if the task's state leaves done.
4. Detail endpoint: GET /api/task-detail?num=N (route in src/hub.ts, builder in src/webui/payload.ts) returns the light row plus body, specs, notes, openQuestions, the agent history, and the per-task doctor entries. Unknown or non-integer num -> HTTP 404 with a JSON error body.
5. Client: openTask renders the shell from the light row, shows a loading placeholder in the body, fetches the detail on every open with no client-side cache, shows an inline error on failure, and discards a superseded open's response. The poll keeps re-fetching only the light rows; while a card is open, the tick re-fetches that task's detail and paces the 1 s/5 s cadence on the fresh detail.
6. Do not touch /api/agent-log or the log panel in this task (the log-panel fix shipped as #243).

## Constraints
- No new dependencies, no framework; keep the current template-string client.
- Keep syncBoard rendering unchanged except where data moved.
- Do not change the .kanban task file format or the log file formats.

## Acceptance criteria
- `pnpm test` passes, including tests in tests/webui.test.ts that assert: /api/tasks rows carry no body/specs/notes/openQuestions/doctor keys; the visible-card subset carries token stat data; done-task stats come from the cache; /api/task-detail?num=<existing> returns the full body, sections, agent history and doctor entries; /api/task-detail with an unknown or non-integer num returns 404 with a JSON error body.
- `pnpm test:changed` passes for the touched files.

# Notes
- Splitter pass, no split (#242): the work is one contract slice across src/webui/payload.ts, src/hub.ts, src/webui/page.ts and tests/webui.test.ts. The light rows, the detail endpoint and the client fetch must agree, so one developer pass costs less than two review, merge and live-test cycles.
- Open point for the developer: the board cards and the poll cadence read t.agents and t.doctors (src/webui/board.ts:56,74, src/webui/page.ts:77) for the card stats lines, the spinners and the 1 s/5 s cadence. But the light-row contract excludes agent history and per-task doctor data. The clause "any field the board renderer or row click needs to open" decides. Keep the fields the cards and the cadence read, drop the rest, and make payload and renderer agree in the same pass. The new tests must cover the shape you settle on.
- Implemented (bd4b9ae): GET /api/tasks serves light rows only: file, num, name, shortName, state, priority, complexity, issuer, blockedBy, worktree, updated, summary. No body, no agent history, no log parsing. New GET /api/task-detail?num=N (route in src/hub.ts, builder taskDetail in src/webui/payload.ts) returns the light row plus body, specs, notes, openQuestions, the agent history and the doctor entries. An unknown or non-integer num answers 404 with a JSON {"error":"unknown task"} body. /api/agent-log and the log panel are untouched.
- Client (src/webui/page.ts): openTask renders the shell from the light row, shows a "Loading task details…" placeholder in the body, fetches the detail on every open with no client-side cache, and shows "Task details failed to load" on failure. A generation counter discards a superseded open's response. The 5 s poll keeps re-fetching only the light rows. While a card is open, the tick re-fetches that task's detail and paces the 1 s/5 s cadence on the fresh detail (refreshMs(openDetail)).
- Tests: tests/webui.test.ts asserts the light shape (no body, specs, notes, openQuestions, agents, agent or doctors keys), the detail endpoint's full body and sections, the 404 with a JSON error body, and repointed every agent-history, token and doctor assertion at the detail. Client pins cover the openTask fetch, the placeholder, pollDetail and the refreshMs(openDetail) cadence. The red run was confirmed first: the suite failed at import on the missing taskDetail export. pnpm test:changed passed (tests/orchestrator.test.ts plus tests/webui.test.ts, 2 suites). One orchestrator part AS failure ("the board mirror carries the developer notes file") was a timing flake in a real-daemon run: it passed on rerun and at HEAD, and it reads the git mirror branch, which this change never touches.
- Performance: listAll still reads and parses every task file per poll (the task-file format must not change, no task-file cache in scope). The board payload win is the dropped body transfer and the dropped logStats parsing. Opening one detail parses only that task's logs, so the first open after a daemon restart stays cheap.
- Review pass (bd4b9ae): all spec checks pass. Light rows carry exactly the identity+summary fields with names identical where fields survive; /api/task-detail returns the light row plus body, specs, notes, openQuestions and the agent/doctor history, and answers 404 with a JSON error on unknown, non-integer and missing num; the client shows the placeholder, fetches on every open, no cache, inline error; the poll fetches only light rows plus one detail per cycle while a modal is open; /api/agent-log untouched. Every client consumer of the moved fields degrades gracefully (t.body || "", t.agents || [], t.doctors || []). tests/webui.test.ts exit 0. Open question 2 deleted: the spec's "per-task doctor data if attached per task today" clause answers it, doctors were per-task in the old payload.

## Live test (95843be, hub-only fixture, 73 checks, 0 failed)
- Setup: one hub-only fixture root with three tasks (one doing with a live pid and a run log, one done with a run log and a doctor log, one backlog), served by startHub from this worktree. No daemon and no git, so a board change under a running daemon is not covered. Run from this worktree, /api/tasks and /api/task-detail answered on port 4351.
- /api/tasks: a JSON array of 3 light rows. Each row carries exactly these 12 keys: blockedBy, complexity, file, issuer, name, num, priority, shortName, state, summary, updated, worktree. No body, specs, notes, openQuestions, agents, agent, doctors or logStats key. The transfer carries no task body text.
- /api/task-detail?num=N: returns the light row plus agent, agents, body, doctors, notes, openQuestions, specs. The body and every section match the task file. The live task shows an alive developer entry. The done task shows its finished run (30 tokens) and its doctor entry.
- 404: an unknown num, a non-integer num, a fractional num, num 0 and a missing num all answer HTTP 404, content-type application/json, with the body {"error":"unknown task"}.
- /api/agent-log is unchanged: it still serves the run log of a task.
- Browser: the board renders 3 cards from the light rows. The modal title renders from the light row at once, while the body shows "Loading task details..." during the detail fetch (checked with a 700 ms route delay). The detail then renders. A reopen fetches the detail again (no client-side cache). A 500 answer shows "Task details failed to load". The run card and the doctor card render from the detail payload.
- Poll: with no modal open, only /api/tasks polls (1 fetch in 6.3 s) and no task-detail fetch occurs. Every polled /api/tasks body is a light array. With the live task open, the detail poll gaps measured 1029 to 1057 ms, and light rows and the detail re-fetch each cycle. With the done task open, 1 detail fetch occurred in 6.3 s.
- Observation: the board cards carry no .card-stats span, because the light rows carry no agent data. This matches the assumption in Open questions. The user must still confirm if the cards keep the token and duration line.
- No page error occurred. The intentional 500 answer produced the only console error.

# Open questions

