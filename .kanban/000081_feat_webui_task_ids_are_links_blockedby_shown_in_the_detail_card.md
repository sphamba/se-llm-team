---
name: "feat: webui task ids are links; blockedBy shown in the detail card"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
In the webui, rendered task ids become links: clicking an id opens that task's detail card, replacing the currently shown card. The detail card gains a blockedBy row whose refs are links to their tasks. The board draws blockedBy relations as animated dashed curved lines between the small task cards, dashes moving from the blocked task towards the blocking task.

# Specs
Webui part of the blockedBy feature (the attribute, tool params, and failsafe skip are a separate task). Folded in (2026-10-11): the board draws blockedBy relations as animated dashed curved lines.

Facts (verified on current main + board, 2026-10-11):
- Column cards already show the id: card HTML has .name with <span class="num"> (num(t) = "#" + parseInt(t.file, 10)), card click handler el.onclick = () => openTask(el.dataset.file). Detail card #m-attrs rows render number/file/priority/state/worktree; openTask is fully re-entrant, so a referenced id opens that task's card in place by construction.
- Link styling reference: #m-body a { color: var(--link) }; esc() escapes all interpolated text.
- /api/tasks -> taskPayload serves file/name/priority/state/worktree/issuer/updated/body/agents/agent - blockedBy needs explicit inclusion once the backend task lands.
- #board scrolls on itself (overflow-x: auto, overflow-y computes to auto) and has NO position:relative - an absolute SVG child would resolve to the viewport; #board must gain position:relative so the overlay scrolls with the content.
- syncBoard keys cards by file in a cardEls Map, reuses nodes, rewrites innerHTML only on real change; render measures board-relative positions (pos() adds scrollLeft/Top), then syncs, then FLIPs moved cards with translate + transition transform .4s ease cleared on transitionend; refresh() runs every 5s; prefers-reduced-motion skips FLIP and kills .spin.
- No SVG/canvas exists yet; no z-index declared.

Changes:
1. Rendered task ids are links: the column card .num id and the detail card's number row render the id as a link-styled element; clicking it calls openTask for that task (a card's own id opens its own card; a referenced id opens that task's card, replacing the shown one in place).
2. blockedBy in the detail card: #m-attrs gains a blockedBy row listing the refs; each "#<num>" is a link that opens the referenced task's card in place. No row when the attribute is absent or empty.
3. /api/tasks includes blockedBy (from the backend task); keep the client tolerant of older payloads without the field.
4. Link styling consistent with var(--link) in both themes; keep esc() on all interpolated text; give link ids a cursor/hover affordance.
5. SVG relation lines on the board: an absolutely-positioned SVG overlay inside #board (#board gains position:relative; overlay z-index above cards but pointer-events: none so clicks pass through). One curved (bezier) dashed path per stored relation, from the blocked task's card to each blocking task's card. Only between cards currently rendered on the board: a "#<num>" ref maps to a card via parseInt(dataset.file); refs with no rendered card are skipped.
6. Only not-done blockers draw (user decision): a line is drawn only while the blocking task's state is not done; when the blocker reaches done the line is skipped.
7. Sprout rules (user decision): two linked tasks in the SAME column -> both ends sprout from the RIGHT side of the small task cards (a loop out to the right). Different columns -> each end sprouts from the left or right side of its card, whichever minimizes the line length (blocker left of blocked: blocker's right edge to blocked's left edge; reversed when the blocker is to the right).
8. Dash animation: dashes move FROM the blocked task TOWARDS the blocking task along the path; continuous CSS or SMIL animation; under prefers-reduced-motion the paths render static without dash movement.
9. Recompute: line endpoints recomputed on every render/refresh (5s cycle), after FLIP transitions settle (transitionend), on window resize, and on fold toggle changes; endpoints follow the reused card nodes (cardEls keyed by file). Multiple blockers -> one line each.
10. Tests: extend src/webui.test.ts - payload includes blockedBy; detail card renders the blockedBy row and link markup; ids render as links; overlay markup present with pointer-events: none and #board position:relative; same-column sprout side is right; done-blocker lines skipped; reduced-motion honored (source asserts per the existing test style). Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Task ids in the webui are links; clicking a blockedBy ref opens that task's card in place of the shown one.
- blockedBy shows in the detail card; absent means no row.
- The board draws a curved dashed line per not-done blocker relation, dashes flowing from blocked to blocker, right-side sprouts within a column, minimal-length sprouts across columns; nothing intercepts card clicks.
- Both themes consistent; escaping intact; the three node suites pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000080 (blockedBy must parse and flow to /api/tasks first), and behind the webui lane - one webui rewrite at a time: 000079 (reviewing) and 000088 (reviewing) land first, then this task, then 000099 (complexity badge).

# Notes
