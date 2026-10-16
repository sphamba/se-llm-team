---
name: "feat: browser notifications on task state changes"
priority: "medium"
state: "live-testing"
worktree: "feat/244-browser-state-notifications"
issuer: "user"
complexity: "simple"
shortName: "browser-state-notifications"
blockedBy: ""
---

# Summary
Client-side notifications: the webui diffs task states on its existing poll and fires a browser notification per state change with project name, task number, task name, and new state. Opt-in via a header control, persisted as webUi.notifications; fires only while the tab is hidden.

# Specs
## Goal
The webui shows a browser notification each time a task changes state, with project name, task number, task name, and the new state, so pipeline activity is visible without watching the board tab.

## Facts (measured)
- The webui client has no Notification API usage today (no matches in src/webui/): greenfield.
- The hub has no push infrastructure: every response is one-shot JSON with connection: close (src/hub.ts:210-216, server at :294). No SSE/WebSocket anywhere.
- The poll loop is refresh() (src/webui/page.ts:937, self-rescheduling setTimeout ~:973, wake-on-visibility ~:976). No diff today: mergeBoards (:954, defined :69-71) just overwrites boards[key].tasks = tasks. The natural hook is before render() at :955: compare old vs new per-project tasks keyed by task file -> state.
- Project name: GET /api/projects returns HubEntry objects {name, root, branch, ...} (src/hub.ts:214); the client maps root->tab and name(+branch)->label (tabNames, page.ts:37-53); boards are keyed by root, so the notification's project name = the tab's label.
- Config: WebUiConfig {enabled, host, port} (page.ts:22-26), loadWebUiConfig (:28-44) merges XDG-neutral/legacy then per-project .kanban/ override. webUi.notifications?: boolean slots beside enabled.

## Decided direction (user)
- Mechanism: client-side diff on the existing poll; no server changes, no SSE/WebSocket.
- Permission: opt-in control in the webui; clicking it requests permission; denied/off is silent and never prompts again.
- Persistence (decided): the live choice persists per browser in localStorage (like the theme). No config-write endpoint; requirement 7 stays. The webUi.notifications config key stays in WebUiConfig/loadWebUiConfig as the server-side default/off switch, default off when missing.
- Scope: state transitions of known tasks only. No notification for newly created tasks. Notifications fire only while the webui tab is hidden (document.hidden); when the tab is focused the board itself is the feedback.
- All project tabs notify, not only the active one.

## Required changes
1. Diff on poll: in refresh(), after the per-project /api/tasks fetch, compare previous vs new task state per project, keyed by task file. For every task whose state changed, fire a notification.
2. Notification content: project name, task number, task name, and the new state, e.g. title "<project>: #242 <task name>" body "New state: to-review". Use the standard Notification API (title + body); no libraries.
3. Opt-in control: a control in the webui header showing the notification state (off / on / denied). Clicking it calls Notification.requestPermission(); on grant, enable and persist in localStorage; a second click disables. Denied stays silent and never re-prompts.
4. Persistence: the live opt-in persists per browser in localStorage; webUi.notifications loads into WebUiConfig as the server-side default/off switch, default off when missing; no config-write endpoint (requirement 7 stays).
5. Suppression: skip notifications while document.hidden is false, when disabled, or when permission is not granted. Never throw on a denied or unsupported browser.
6. Handle browsers without Notification support: hide the control, no errors.
7. Client-only change: no hub endpoint changes, no config file format changes beyond the new webUi.notifications key.

## Constraints
- No new dependencies, no framework; keep the template-string client.
- Do not touch the /api endpoints or the log endpoints.

## Acceptance criteria
- `pnpm test` passes, including a new test in tests/webui.test.ts that webUi.notifications loads from config and defaults to off when missing.
- Manual check (live test): enable notifications via the control, switch to another tab, let a daemon change a task state, and confirm a notification appears with project name, task number, task name, and new state; no notification while the webui tab is focused; the control shows denied and stays silent after a denied permission; the choice survives a page reload via localStorage.

# Notes
- The client diffs task states on its poll, before `mergeBoards` overwrites them, and fires one Notification per known task whose state moved. New tasks report nothing and a failed project fetch keeps its tab quiet. The diff is the exported `stateChanges(before, after)` helper, keyed by task file and run per project, so all tabs notify, not only the active one.
- Header control `#notify` reads `Notifications: off|on|denied`. The first click calls `Notification.requestPermission()`, a second click disables, a denied permission stays silent and never re-prompts, and a browser without the Notification API hides the control. The live choice persists in localStorage under `notifications`, like the theme.
- Notification title `"<project>: #<num> <task name>"`, body `"New state: <state>"`, only while `document.hidden`; the constructor sits in a try/catch. The single-project board now carries the registered project's name as its label, so the title has the project name in a one-project setup too.
- `webUi.notifications` loads into `WebUiConfig` (default off when missing); tests/webui.test.ts pins the absent-config default, the project-config value, the page control, the hidden gate and the diff.
- Verified: `node tests/webui.test.ts` all assertions passed. Live check against a fixture daemon (port 4399, task `done` -> `doing` while focused, `doing` -> `reviewing` while hidden) with Playwright: control off then on, exactly one notification with the expected title and body while hidden, none while focused, denied control never re-prompts and never fires, unsupported control hidden, no page errors. Two harness notes: the installed Chrome channel is required (the headless shell reports `Notification.permission` denied even after `grantPermissions`), and headless Chrome keeps background tabs visible, so the hidden gate was pinned with a `document.hidden` override.
- Deviation: only the scoped suite ran; the full `pnpm test` was skipped per the developer role.
- Review at fa57065: all seven requirements hold. (1) refresh() diffs via the exported `stateChanges` helper before `mergeBoards` overwrites, per project keyed by task file; a null payload (failed fetch) reports nothing. (2) Title `<label>: #<num> <name>`, body `New state: <state>`, no libraries. (3) `#notify` control: first click `Notification.requestPermission()`, second click disables, denied returns silently and never re-prompts. (4) `webUi.notifications` loads into `WebUiConfig`, default off when missing; tests pin the absent-config default, the project-config true value, and the no-webUi fallback. (5) `notifyChange` gates on enabled + permission granted + `document.hidden`, constructor in try/catch. (6) No Notification API hides the control. (7) Diff touches only src/webui/index.ts, src/webui/page.ts, tests/webui.test.ts. `projects` is declared at page.ts:333, before `notifyChange` reads it. Verified: node tests/webui.test.ts exit=0, all assertions passed. The open question (localStorage vs config persistence) stays: a client-side click cannot write the config file without an endpoint, which requirement 7 forbids.

# Open questions

