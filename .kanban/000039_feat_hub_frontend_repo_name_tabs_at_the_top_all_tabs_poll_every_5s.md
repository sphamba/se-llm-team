---
name: "feat: hub frontend; repo-name tabs at the top, all tabs poll every 5s"
priority: "medium"
state: "backlog"
worktree: ""
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
