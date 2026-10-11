---
name: "feat: webui complexity badge on cards and the detail card"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Show the task complexity attribute (simple/moderate/complex) as a small badge next to priority on board cards and in the detail card; /api/tasks includes complexity.

# Specs
Companion to task #98 (backend: complexity attribute + per-complexity LLM config). The user asked for the badge in the webui.

Facts: taskPayload serving /api/tasks (src/webui.ts) whitelists file/name/priority/state/worktree/updated/body/agents/agent and must explicitly include complexity once #98 adds it to the Task; openTask modal #m-attrs rows render esc()'d values; board cards render priority badges already; webui.test.ts STATE_NAMES/column-heading loop and payload asserts at :63-70.

Changes:
1. /api/tasks payload includes complexity (from #98's Task field).
2. Board cards and the detail card show the complexity as a small badge next to the priority badge, styled quiet in both themes, esc()'d; absent complexity renders as "moderate" (the default).
3. Extend src/webui.test.ts (payload field assert).

Acceptance: cards and detail card show the badge in both themes; suite green: node src/webui.test.ts.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind #98 (the Task field must land first) and behind #96 (doing on fix/96-content-driven-column, src/webui.ts) and #72 (reviewing, src/webui.ts + webui.test.ts pending merge).

# Notes
