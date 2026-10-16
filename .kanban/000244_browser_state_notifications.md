---
name: "feat: browser notifications on task state changes"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "browser-state-notifications"
blockedBy: "#242"
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
- Permission: opt-in control in the webui; clicking it requests permission; denied/off is silent and never prompts again; the choice persists via the webUi.notifications config key.
- Scope: state transitions of known tasks only. No notification for newly created tasks. Notifications fire only while the webui tab is hidden (document.hidden); when the tab is focused the board itself is the feedback.
- All project tabs notify, not only the active one.

## Required changes
1. Diff on poll: in refresh(), after the per-project /api/tasks fetch, compare previous vs new task state per project, keyed by task file. For every task whose state changed, fire a notification.
2. Notification content: project name, task number, task name, and the new state, e.g. title "<project>: #242 <task name>" body "New state: to-review". Use the standard Notification API (title + body); no libraries.
3. Opt-in control: a control in the webui header showing the notification state (off / on / denied). Clicking it calls Notification.requestPermission(); on grant, enable and persist; a second click disables. Denied stays silent and never re-prompts.
4. Persistence: add webUi.notifications?: boolean to WebUiConfig, load it in loadWebUiConfig, default off when missing.
5. Suppression: skip notifications while document.hidden is false, when disabled, or when permission is not granted. Never throw on a denied or unsupported browser.
6. Handle browsers without Notification support: hide the control, no errors.
7. Client-only change: no hub endpoint changes, no config file format changes beyond the new webUi.notifications key.

## Constraints
- No new dependencies, no framework; keep the template-string client.
- Do not touch the /api endpoints or the log endpoints.

## Acceptance criteria
- `pnpm test` passes, including a new test in tests/webui.test.ts that webUi.notifications loads from config and defaults to off when missing.
- Manual check (live test): enable notifications via the control, switch to another tab, let a daemon change a task state, and confirm a notification appears with project name, task number, task name, and new state; no notification while the webui tab is focused; the control shows denied and stays silent after a denied permission.

# Notes
