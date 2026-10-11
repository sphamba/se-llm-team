---
name: "feat: webui complexity badge on cards and the detail card"
priority: "medium"
state: "live-testing"
worktree: "feat/99-webui-complexity-badge"
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
- HOLD lifted: #98 (complexity Task field), #96 and #72 all done and merged before starting; worktree had #98's complexity in src/kanban.ts.
- src/webui.ts: taskPayload whitelists `complexity: t.complexity` (hub.ts reuses taskPayload and PAGE, so the hub serves both unchanged); cardHtml emits `<span class="chip cx">` after the priority chip with `esc(t.complexity || "moderate")`; the detail card's priority attrs row gains the same chip; one CSS rule `.chip.cx { background: var(--code-bg); color: var(--muted); }`, quiet in both themes (theme-driven vars).
- src/webui.test.ts: payload asserts for complexity on the default and the #42-issued task; card asserts for badge placement next to priority, escaping, and the absent-complexity moderate default; page asserts for the CSS class and the detail-card source line.
- `node src/webui.test.ts` green; committed ae3a9ed in the worktree.
- Review (no fixes): verified #98's `complexity` field is on the Task type in src/kanban.ts and validated against COMPLEXITIES at read time, so the payload and chips always carry a legal value; hub.ts reuses taskPayload and PAGE, so the hub serves complexity unchanged. Diff checked against the Specs: payload whitelist entry, `<span class="chip cx">` directly after the priority chip, the detail modal's priority row chip, `.chip.cx` quiet in both themes via `var(--code-bg)`/`var(--muted)`, esc() on every complexity render, and the `|| "moderate"` fallback. `node src/webui.test.ts` green in the worktree. No open questions.
