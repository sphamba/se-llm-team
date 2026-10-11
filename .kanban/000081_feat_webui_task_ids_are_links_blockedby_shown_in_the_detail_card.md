---
name: "feat: webui task ids are links; blockedBy shown in the detail card"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
In the webui, rendered task ids become links: clicking an id opens that task's detail card, replacing the currently shown card. The detail card gains a blockedBy row whose refs are links to their tasks.

# Specs
Webui part of the blockedBy feature (the attribute, tool params, and failsafe skip are a separate task).

Facts (verified on current main):
- Column cards already show the id: card HTML (src/webui.ts:473) has .name containing a <span class="num"> with num(t) (const num = t => "#" + parseInt(t.file, 10) :414) plus the name and a priority chip; the card click handler is el.onclick = () => openTask(el.dataset.file) :480.
- Detail card: #m-attrs rows render number/file/priority/state/worktree (:501-507); openTask (:495-510) is fully re-entrant - calling openTask(otherFile) rewrites title/attrs/body in place and switches modalFile while the modal stays open, so "replacing the currently shown card" works by construction.
- Link-like markup exists only in the markdown renderer inline (:428-431): [text](url) -> <a target="_blank" rel="noopener">, styled by #m-body a { color: var(--link) }. Cards use div + onclick, no <a>; esc() (:405) escapes all interpolated text.
- /api/tasks -> taskPayload (:213-224) serves file/name/priority/state/worktree/updated/body/agents/agent - blockedBy needs explicit inclusion once the backend task lands.
- src/webui.test.ts: payload-field asserts :63-70, modal source-substring asserts :97-105.
- Collisions: src/webui.ts + src/webui.test.ts are dirty on 000068 (live-testing) and queued work 000077 (high), 000076 (medium), 000079 (medium). #47's branch is merged into main (stacked pairs + animation-preserving refresh effectively in main).

Changes:
1. Rendered task ids are links: the column card .num id and the detail card's number row render the id as a link-styled element; clicking it calls openTask for that task (a card's own id opens its own card; a referenced id opens that task's card, replacing the shown one in place via openTask re-entrancy).
2. blockedBy in the detail card: #m-attrs gains a blockedBy row listing the refs; each "#<num>" is a link that opens the referenced task's card in place. No row when the attribute is absent or empty.
3. /api/tasks includes blockedBy (from the backend task); keep the client tolerant of older payloads without the field.
4. Link styling consistent with #m-body a (var(--link)) in both themes; keep esc() on all interpolated text; give link ids a cursor/hover affordance.
5. Tests: extend src/webui.test.ts - the payload includes blockedBy; the detail card renders the blockedBy row and link markup; ids render as links. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Task ids in the webui are links; clicking a blockedBy ref opens that task's card in place of the shown one.
- blockedBy shows in the detail card; absent means no row.
- Both themes consistent; escaping intact.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000080 (blockedBy must parse and flow to /api/tasks first), and behind the webui queue 000068 (live-testing), 000077 (high), 000076 (medium), 000079 (medium) - one webui rewrite at a time.

# Notes
