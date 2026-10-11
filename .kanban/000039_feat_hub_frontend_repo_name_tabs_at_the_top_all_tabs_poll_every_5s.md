---
name: "feat: hub frontend; repo-name tabs at the top, all tabs poll every 5s"
priority: "medium"
state: "reviewing"
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
