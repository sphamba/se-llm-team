---
name: "feat: hub frontend; repo-name tabs at the top, all tabs poll every 5s"
priority: "medium"
state: "done"
worktree: "feat/39-hub-frontend-repo"
---

# Summary
Tabbed UI in the hub: one tab per registered project (repo name), each tab shows that project's board only, all tabs poll every 5s, single-project setups look exactly as today.

# Specs
Hub frontend (design settled by the grill interview; builds on the hub backend task 000038).

Facts:
- Today the UI renders one board (render(), /api/tasks without a project param), refreshes every 5s, and has dark mode (000025/000032), animation (000028), chip fix (000029).
- The hub backend (000038) serves /api/projects (registered projects) and /api/tasks?project=NAME.

Changes (src/webui.ts, src/webui.test.ts):
1. Tabs at the top: one tab per registered project, labeled with the repo name (from /api/projects). The active tab shows that project's board.
2. All tabs poll every 5s: fetch every registered project's payload each cycle, render the active tab, and keep per-project state (like the existing expanded/dark state) so a tab switch shows fresh data without a flash. The open modal closes on tab switch.
3. Single project: behave exactly as today (one tab, or no tabs when only one project is registered).
4. Board-only content per tab: no extra status UI. Dark mode, FLIP animation, chip fixes apply to every tab.
5. The per-tab data includes the fields the modal needs (attributes, chip, priority) as today, resolved from that project's board and pid files.
6. Tests: extend webui.test.ts; projects list renders one tab per project, per-project payloads map to tabs, tab switch keeps per-project state, single-project mode is unchanged. All tests pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- Depends on the hub backend (000038) for /api/projects and /api/tasks?project.
- HOLD behind the webui queue: 000030 (cap/unfold) → 000033 (agent view) → 000036 (sibling FLIP), then this.

# Notes

Developer run (commit db15b73, worktree feat/39-hub-frontend-repo).

- src/webui.ts: four client helpers live in webui.ts and ship into PAGE, so tests call them directly: tabNames (one tab per registered project, none for a single project), tabsHtml (one escaped button per project, active marked), boardOf and mergeBoards (tasks and fold state keyed by project name). PAGE got a `<nav id="tabs">` bar. Each 5 s cycle reads /api/projects and then every /api/tasks?project=NAME, and renders only the active tab.
- A tab switch renders the cached project state, sets no FLIP baseline from the board just left, and closes the open modal. Agent-log polls carry `&project=<active>`. A single project, and the plain server whose /api/projects is a 404, keeps the bare /api/tasks poll and no tab bar. A failed /api/projects keeps the last known tabs. A vanished active project falls back to the first tab and closes the modal. Per-project state uses Object.create(null), so a project named `__proto__` or `constructor` cannot break it. The updated stamp advances only when the active project's payload arrived.
- src/webui.test.ts: tests for tabNames and tabsHtml (one tab per project, active marked, escaped labels, single and empty registry render none), mergeBoards (each payload lands under its own project, a null payload keeps the previous data), boardOf (fold choices survive a poll and a switch, prototype-named project gets a real board), plus page assertions (tab bar, switch closes the modal, every tab polled each cycle, 5 s cadence, project param on agent-log, single-project fallback).
- Checks: `node src/webui.test.ts`, `node src/kanban.test.ts` and `node src/orchestrator.test.ts` (hub smoke, election race, failover) all pass. A throwaway DOM-shim smoke against a real hub with two temp projects confirmed the tabs, the switch, the modal close, inactive-tab polling and the single-project fallback. An independent adversarial review found no spec violation on commit db15b73, and its robustness findings were applied.

## Review (2026-10-11)

- Reviewed commit db15b73 against the Specs. `git diff main...HEAD` touches only src/webui.ts and src/webui.test.ts, as the Constraints require.
- Checks re-run in the worktree: `node src/webui.test.ts`, `node src/kanban.test.ts` and `node src/orchestrator.test.ts` (hub server, election race, failover smoke) all pass.
- Merge safety: `git merge-tree --write-tree main HEAD` is clean. The merged tree keeps main's renderLogChunk blank-line fix (000068) and the 300px .col width (000082). This branch does not touch those regions.
- Independent browser check (system Google Chrome through Playwright) against a real hub with two temporary projects and 7 tasks each: the bar shows one tab per registered project with the repo names, and the first tab is active. The active board renders that project's tasks with the 5-card cap and the priority chips. Fold state is per project, survives a switch and never bleeds into the other tab. Dark mode survives a tab switch. The modal opens on the active tab, and a tab switch closes it. Both projects polled two times in 6.5 s, so the 5 s cadence holds. No JavaScript error.
- Single-project check in the browser against a hub with one registered project: no tab renders, `#tabs` is `display: none`, every poll is a bare `/api/tasks`, and the board renders as before.
- Observation (not a Spec violation, no fix): the pre-existing full-screen `#modal` overlay covers the tab bar, so a pointer click on a tab lands on the overlay while a modal is open. The `closeModal()` call in `switchTab` is still correct for a programmatic switch and for the vanished-project path. A user-facing tab click with an open modal needs a stacking change on the tab bar, and that is a UX change outside this Spec.
- No fixes made, state set to to-live-test.

## Live test (2026-10-11)

PASS. Verified like a user in system Google Chrome through Playwright (worktree feat/39-hub-frontend-repo) against a real hub (src/hub.ts) with two registered fixture projects, 13 tasks each (7 backlog plus one per other state). No code was edited.

- Tabs: two tabs labeled alpha-web and beta-api (the repo names), the first active. The active board renders only that project's tasks with the 5-card cap and the priority chips. Switching to beta renders its cached board within the same tick (no empty frame), and switching back works.
- Per-project state: on beta the backlog column was collapsed at 5, expanded to 7, alpha stayed at 5, and beta kept 7 after a switch away and back. Dark mode survived a tab switch.
- Polling: in an 11.5 s window both `/api/tasks?project=alpha-web` and `/api/tasks?project=beta-api` were fetched twice, 5.002 s apart, plus one `/api/projects` per cycle. The updated stamp advanced.
- Modal: the attributes (number, file, priority chip, state, worktree) render from the active project's payload. Opening a past Developer log issued `/api/agent-log?file=...&project=beta-api`.
- FLIP: a fixture task moved from backlog to done on disk; on the next poll the moving cards got the inversion and `transition: transform 0.4s`, so the animation still applies to a tabbed board.
- Single project: a hub with one registered project renders no tab bar (`#tabs` is `display: none`), polls bare `/api/tasks`, and the board is unchanged.
- Escaping: a project registered with name `x<img src=x onerror=...><b>&"q` renders as inert tab text, no injected element, no page error.
- No JavaScript page errors in any run. `node src/webui.test.ts` passes (all assertions passed).

Finding (reported to the PM, not fixed here):

- With a task modal open, the full-screen `#modal` overlay covers the tab bar, so a real pointer click on another repo's tab closes the modal and does not switch. `document.elementFromPoint` at the tab center returns `#modal` (screenshot /tmp/lt39/modal-over-tabs.png). The Spec line "The open modal closes on tab switch" is therefore only reachable programmatically for a pointer user, who needs a second click. A stacking change (tab bar above the overlay) or hiding the bar while the modal is open would fix it. The reviewer flagged the same as an out-of-spec UX observation.
- No other issue found.

State set to done.
