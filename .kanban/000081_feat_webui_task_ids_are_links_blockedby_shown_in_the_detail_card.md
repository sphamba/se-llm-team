---
name: "feat: webui task ids are links; blockedBy shown in the detail card"
priority: "high"
state: "to-merge"
worktree: "feat/81-webui-task-ids"
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

## 2026-10-11 (developer)

- Both holds resolved before starting: 000080 done and merged (blockedBy parses and flows), 000079/000088 done and merged; branch sat at main tip b7b9407, src/kanban.ts already carried blockedBy (Task interface, parseTask, listTasks, updateTask, createTask).
- src/webui.ts:
  - taskPayload gains blockedBy: t.blockedBy (TaskRef carries it as an empty string when absent), so /api/tasks serves it; the client reads it via String(t.blockedBy || "") so older payloads without the field draw nothing.
  - New exported numLinkHtml(file, cls) emits <span class="num-link [num]" data-task="<esc(file)>">#<parseInt(file,10)></span>; no inline onclick (file names can hold quotes) - the column card's click bubbles to the card's own openTask handler, and the detail card binds its #m-attrs .num-link elements to openTask after render via querySelectorAll.
  - The column card .num span and the detail card number row now render through numLinkHtml; the old num() helpers (webui.ts export and the page-script literal) became dead and were dropped.
  - New exported curve(from, to, same): cubic bezier running from the blocked card to the blocker card (so a decreasing stroke-dashoffset moves dashes blocked -> blocker), 40px control-point bow, endpoints at the vertical middle of the chosen side edges. same = same state OR |to.x - from.x| < 1 (stacked pair columns share one x, so they loop out of the right sides instead of drawing through the cards - deliberate judgment call).
  - New exported relationPaths(tasks, rectOf): one curve per stored blockedBy relation whose blocker is not in state done and whose card is currently rendered; refs map via parseInt after stripping a leading #; ghost refs, unparseable refs, unrendered cards and done blockers are skipped.
  - Page-script cardBox(el) (board-content relative {x,y,w,h}, page scroll cancels and board scroll adds back, so a scrolled refresh measures identically and animates nothing) is hoisted from render's local pos(); drawRelations() sizes the overlay to the rendered card extent (+40 for the loop bulge), maps relationPaths to <path> elements, and rewrites the SVG innerHTML only when the joined path strings change so the dash animation is not restarted.
  - render() creates the #relations SVG once with buildShell (createElementNS, pointer-events none, inserted as board.firstChild) and registers a window resize -> drawRelations listener; drawRelations() runs at the end of the FLIP-diff computation (settled positions), and card transitionend handlers redraw after a FLIP settles; fold toggles go through render() which redraws.
  - CSS: #board gains position:relative; #relations is position:absolute top 0 left 0 z-index 1 pointer-events none; paths stroke var(--muted), dasharray 6 4, dashflow keyframe (stroke-dashoffset -10); .num-link gets var(--link) + pointer + hover underline; #m-attrs span rule narrowed to :not(.chip):not(.num-link) so id links are exempt from the label styling; reduced-motion block kills the path animation too.
- src/webui.test.ts:
  - cardHtml num assertion updated to the new link markup; new numLinkHtml unit asserts (default class, escaped data-task for a quote in the file name).
  - curve/relationPaths unit asserts: one curve per relation, same-column right-side sprout both ends, different-state at the same x (stacked pair) loops right too, multiple blockers draw one curve each, blocker-left (blocked's left edge to blocker's right edge) and blocker-right (reversed) sprout rules, done blocker draws nothing, ghost/unparseable refs draw nothing, unrendered cards draw nothing, payload without blockedBy draws nothing.
  - PAGE source asserts: the three helpers ship in the page, #board position:relative, #relations absolute/z-index/pointer-events none + setAttribute, dasharray, dashflow keyframes, reduced-motion kills the path animation, resize listener, transitionend redraw, detail-card id-link binding, blockedBy row markup and the empty-list early return, .num-link styling and the attrs-rule exemption.
  - taskPayload asserts: absent blockedBy reads as an empty string; a task with a blockedBy attribute serves it with the payload.
- Smoke (headless Chromium via Playwright against a temp root, --no-sandbox): overlay non-interactive and inside #board, 2 paths drawn for blocked->blocker (doing) and ghost->blocked (backlog), first path d confirms the right-side loop sprouting at the vertical middle of the card edges, dashes flow (animation dashflow), the detail card's number row and blockedBy row render as links, clicking the blockedBy ref opens the blocker's card in place with the modal staying open, card clicks still work with the overlay present, no page errors after resize. Pre-existing /api/projects 404 console noise on the single-project server exists on main too, not from this change.
- All three suites green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.
- Committed in the worktree as 8303099.

## 2026-10-11 (reviewer)

- Reviewed the worktree diff (main...HEAD, commit 8303099, only src/webui.ts and src/webui.test.ts per the constraints) against all 10 spec changes and the acceptance list. No fixes needed.
- Verified per spec: taskPayload serves blockedBy and the client reads it tolerantly (String(t.blockedBy || ""), asserted with a payload lacking the field); numLinkHtml escapes the data-task file (including single quotes - esc covers &<>"') and never builds an inline onclick, the column card id click bubbles to the card's own openTask, the detail card binds its .num-link elements to openTask after render; blockedRow drops the row when absent/empty and renders refs with no matching task as escaped plain text; #board gained position:relative, #relations is absolute top 0 left 0 z-index 1 pointer-events none (CSS rule plus a setAttribute on the createElementNS node); relationPaths draws one curve per not-done blocker with a rendered card, maps refs via parseInt after stripping a leading #, and skips done blockers, ghost/unparseable refs and unrendered cards; same-column (and same-x stacked pair) relations loop out of the right sides, cross-column relations take the minimal-length side pair (verified both directions in the unit asserts); dashflow keyframe decreases stroke-dashoffset to -10, which moves dashes along the path direction, blocked -> blocker; reduced-motion disables the path animation alongside .spin; recompute hooks all present (render/5s refresh, transitionend, window resize, fold toggle via render()).
- Cross-checks beyond the asserts: the .num-link color rule wins over .num by source order (equal specificity); the #m-attrs label rule exemption :not(.num-link) keeps the number row link styled as a link; curve's leftward bow (blocker left of blocked) cannot clip at the SVG's left edge for the real board (first column sits at x=18, minimum curve x stays positive); the w+40 overlay width covers the right-side loop bulge; cardBox is the hoisted former pos() plus w/h, so the FLIP identity behavior is unchanged.
- Re-ran all three suites in the worktree: kanban, orchestrator, webui - all green. A live browser smoke could not be repeated in this environment (Playwright not installed); the developer's documented smoke covers the runtime behavior and matches the reviewed code.
- State set to to-live-test.

## 2026-10-11 (live-tester)

- Ran the webui as a user would: started the real `startWebUi` server from the worktree against a temp root (8 tasks plus one hostile-name task), drove it in a headless Chromium via Playwright (`--no-sandbox`) on the real page, real `/api/tasks` payload.
- All 23 live checks passed, no findings:
  - Column card ids render as `.num-link[data-task]`; clicking a card's own id opens its own card in place.
  - Detail card number row is a `.num-link`; blockedBy row present when the attribute is set, absent (no row at all) when it is empty; a ref with no matching task renders as escaped plain text, no link.
  - Clicking a blockedBy ref replaces the shown card in place with the blocker's card; the modal stays open.
  - `/api/tasks` serves `blockedBy` (`"#2"` observed).
  - Board overlay: `#relations` exists inside `#board`, `position: absolute`, `pointer-events: none`; one path per not-done blocker with a rendered card (done blocker and ghost ref each drew nothing); paths dashed `6px, 4px` with `animation: dashflow`; same-column pair sprouts both ends at the card right edge (x=307 both ends), cross-column pair takes the minimal left/right side pair.
  - Card body click still opens the card with the overlay present (nothing intercepts clicks).
  - Theme toggle flips `--link` from `rgb(242,151,24)` to `rgb(230,180,80)`; id links keep `cursor: pointer`.
  - Reduced-motion page: path `animation-name` is `none`.
  - Escaping: a task name of `<img src=x onerror=alert(1)> "quote"` renders as literal text in the card and the detail card, injects no img element, fires no alert/XSS dialog, and its blockedBy link to `#8` still works. No page errors across the run.
- No issues found; no follow-up tasks created.

# Open questions