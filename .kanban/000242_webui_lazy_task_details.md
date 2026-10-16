---
name: "perf: defer webui task details to a per-task detail endpoint"
priority: "medium"
state: "reviewing"
worktree: "perf/242-webui-lazy-task-details"
issuer: "user"
complexity: "complex"
shortName: "webui-lazy-task-details"
---

# Summary
Split the webui initial load: /api/tasks returns light identity+summary rows, and a new per-task detail endpoint serves body, sections, agent history and log stats on open. Fixes the slow board open with many tasks (everything currently loads at once).

# Specs
## Goal
Opening the webui must be fast on a large board. Today the initial load fetches everything at once:
- GET /api/tasks (src/webui/payload.ts:449-472, route in src/hub.ts:215) returns EVERY task with its full markdown body (one readFileSync per task), per-run agent history, and doctor data.
- The client (src/webui/page.ts:957) fetches /api/tasks per project on open and re-fetches it every 5 s (1 s while a live agent is open).
- No per-task detail endpoint exists; openTask (src/webui/page.ts:504) renders data already in the initial payload.
- Log stats (payload.ts, statsCache at :219) parse whole log files; on the first open after a daemon restart this synchronously parses the whole .kanban/.logs tree. Measured on this machine: 243 task files (2.5 MB markdown) + 1116 log files (429 MB).
- The DOM is not the bottleneck (syncBoard renders 5 cards per column, src/webui/board.ts:321); the payload build and transfer are.

## Decided direction (user)
Lazy loading for ALL tasks: /api/tasks returns only light rows; full details load per task when it is opened. Confirmed decision: not pagination, not done-only deferral.

## Required changes
1. Light list payload: GET /api/tasks returns, per task, only identity + summary fields (num, name, shortName, state, priority, complexity, issuer, blockedBy, worktree, summary, and any field the board renderer or row click needs to open). It must NOT include body, the specs/notes/openQuestions sections, agentHistory, logStats, or per-task doctor data. Keep response field names identical to today wherever the fields survive.
2. New per-task detail endpoint: GET /api/task-detail?num=N on the same hub (src/hub.ts). Returns the heavy per-task data: body (full markdown), specs, notes, openQuestions, agentHistory, logStats, and per-task doctor data if doctor data is attached per task today (otherwise it stays board-level). Unknown num -> HTTP 404 with a JSON error body.
3. Client: the board renders from light rows only. openTask fetches /api/task-detail for the clicked task, shows a loading placeholder in the modal while the fetch runs, renders the detail on arrival, and shows an inline error on failure. Fetch on every open; do NOT add a client-side detail cache (upgrade path if opens feel slow later: a per-num memo invalidated by the 5 s poll).
4. The 5 s poll (1 s with a live agent open) keeps re-fetching only the light rows, so steady-state polling becomes cheap.
5. Do not touch /api/agent-log or the log panel in this task (a separate fix task covers that).

## Constraints
- No new dependencies, no framework; keep the current template-string client.
- Keep syncBoard rendering (src/webui/board.ts:321) unchanged except where data moved.
- Do not change the .kanban task file format or the log file formats.

## Acceptance criteria
- `pnpm test` passes, including new tests in tests/webui.test.ts (the existing real-hub test file) that assert: /api/tasks rows carry no body/agentHistory/logStats keys; /api/task-detail?num=<existing> returns the full body and sections; /api/task-detail with an unknown num returns 404.
- `pnpm test:changed` passes for the touched files.

# Notes
- Splitter pass, no split (#242): the work is one contract slice across src/webui/payload.ts, src/hub.ts, src/webui/page.ts and tests/webui.test.ts. The light rows, the detail endpoint and the client fetch must agree, so one developer pass costs less than two review, merge and live-test cycles.
- Open point for the developer: the board cards and the poll cadence read t.agents and t.doctors (src/webui/board.ts:56,74, src/webui/page.ts:77) for the card stats lines, the spinners and the 1 s/5 s cadence. But the light-row contract excludes agent history and per-task doctor data. The clause "any field the board renderer or row click needs to open" decides. Keep the fields the cards and the cadence read, drop the rest, and make payload and renderer agree in the same pass. The new tests must cover the shape you settle on.
- Implemented (bd4b9ae): GET /api/tasks serves light rows only: file, num, name, shortName, state, priority, complexity, issuer, blockedBy, worktree, updated, summary. No body, no agent history, no log parsing. New GET /api/task-detail?num=N (route in src/hub.ts, builder taskDetail in src/webui/payload.ts) returns the light row plus body, specs, notes, openQuestions, the agent history and the doctor entries. An unknown or non-integer num answers 404 with a JSON {"error":"unknown task"} body. /api/agent-log and the log panel are untouched.
- Client (src/webui/page.ts): openTask renders the shell from the light row, shows a "Loading task details…" placeholder in the body, fetches the detail on every open with no client-side cache, and shows "Task details failed to load" on failure. A generation counter discards a superseded open's response. The 5 s poll keeps re-fetching only the light rows. While a card is open, the tick re-fetches that task's detail and paces the 1 s/5 s cadence on the fresh detail (refreshMs(openDetail)).
- Tests: tests/webui.test.ts asserts the light shape (no body, specs, notes, openQuestions, agents, agent or doctors keys), the detail endpoint's full body and sections, the 404 with a JSON error body, and repointed every agent-history, token and doctor assertion at the detail. Client pins cover the openTask fetch, the placeholder, pollDetail and the refreshMs(openDetail) cadence. The red run was confirmed first: the suite failed at import on the missing taskDetail export. pnpm test:changed passed (tests/orchestrator.test.ts plus tests/webui.test.ts, 2 suites). One orchestrator part AS failure ("the board mirror carries the developer notes file") was a timing flake in a real-daemon run: it passed on rerun and at HEAD, and it reads the git mirror branch, which this change never touches.
- Performance: listAll still reads and parses every task file per poll (the task-file format must not change, no task-file cache in scope). The board payload win is the dropped body transfer and the dropped logStats parsing. Opening one detail parses only that task's logs, so the first open after a daemon restart stays cheap.

# Open questions
- Assumption: the light rows carry no agent or doctor data at all, so the board cards' token stat line renders empty and the 1 s/5 s cadence keys on the open card's detail. The poll re-fetches the open task's detail each cycle, one detail fetch per cycle only while a modal is open. This keeps the measured log parsing (429 MB) out of the board payload. Confirm or correct if the cards should keep their stats line.
- Assumption: the per-task doctor entries moved to /api/task-detail together with the agent history. Nothing doctor-level stays on /api/tasks.
