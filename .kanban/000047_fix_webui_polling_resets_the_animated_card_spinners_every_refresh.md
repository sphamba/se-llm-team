---
name: "feat: webui stacked column pairs; animation-preserving refresh"
priority: "high"
state: "reviewing"
worktree: "feat/47-webui-stacked-column"
---

# Summary
Stack the middle board columns as pairs (to-do above doing, to-review above reviewing, to-live-test above live-testing, and to-merge above merging once those states exist), with backlog and done staying single full-height columns on the sides, and make the 5s refresh preserve all CSS animations: only real task changes re-render cards, so spinners keep spinning across refreshes.

# Specs
Two coupled webui changes in one task (user feedback; user decisions: backlog and done stay single full-height side columns, ALL animated elements persist across refresh, priority high; pairs extended to four, see below).

Facts (verified at HEAD 401d398; rebase on the merged hub code):
- Board container: <main id="board"> (src/webui.ts:389); CSS #board (line 328) is a flex row with horizontal scroll, gap 10px; .col (329) has min-width 200px, flex 1 0 200px.
- render() (446) is a full per-board innerHTML rebuild of all 8 columns and cards (459). 8 columns in STATES pipeline order (src/kanban.ts:4): backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, done; accent classes .c-backlog...c-done (377-384).
- refresh() (603-612) fetches /api/tasks every 5000ms and re-renders. The card spinner is inline in the card HTML (463): WORKING.includes(st) -> <span class="spin"> (WORKING = doing/reviewing/live-testing, 399).
- FLIP movement is already implemented (452-456, 473-482): card positions measured before rebuild (board-content-relative with scroll offsets), transform transition .4s ease after rebuild, cleared ontransitionend.
- Animated elements: .spin (animation: spin .9s linear infinite, 336-337, disabled under prefers-reduced-motion, 338) and the JS-injected FLIP transform transition. Hover states swap background instantly (no transition property).
- State across refreshes: theme in localStorage; fold state in a module-level expanded Set (survives refresh, not reload); the modal detail card is untouched by render() (stays open, content stale); board scroll is not restored (FLIP compensates via scroll offsets).

Changes:
1. Stacked pairs: render the middle columns as stacked pairs - to-do above doing, to-review above reviewing, to-live-test above live-testing, and to-merge above merging once the two merge states land (a queued task adds states "to-merge" and "merging"; implement the pairing generically over the middle columns in STATES order so that pair appears automatically; until then the three current pairs render). backlog stays the leftmost single full-height column and done the rightmost single full-height column; only the middle columns pair. Implementation is the developer's choice (for example a wrapper per pair with the two .col stacked vertically, or CSS grid areas on #board). Keep .col min-widths, the 10px gaps, the accent classes, the per-column header and count, and the horizontal scroll behavior of #board.
2. Animation-preserving refresh: the 5s refresh must not restart CSS animations. Preferred: reuse the existing card element keyed by task file instead of rebuilding it - update only cards whose content changed; unchanged cards keep their DOM node and thus their running animation and FLIP transform. When a task changes state, the new state's animation starts (spinner on doing/reviewing/live-testing, none on backlog/to-do/to-review/done). Do not change the 5s interval.
3. Keep the existing behaviors: FLIP (000028), cap/unfold (000030), theme (000041), opaque backgrounds (000036), prefers-reduced-motion handling.
4. Tests: extend src/webui.test.ts - the stacked pair structure renders (pair wrappers or the equivalent); unchanged cards are not rebuilt across refreshes (spinner element identity preserved); a state change starts or stops the right animation. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- to-do sits above doing, to-review above reviewing, to-live-test above live-testing (to-merge above merging once those states exist); backlog and done stay single full-height columns on the sides; gaps, accent colors, counts, and horizontal scroll are unchanged.
- A card being worked on keeps its spinner animation across at least two 5s refreshes; animations track the real state when a task changes.
- FLIP movement still animates when a card changes column.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- #000038 is done and merged (e4c0358): rebase line numbers on the merged code (walk-back in agentLogPayload, LOG_CHUNK 81920, PAGE restyle, taskPayload/agentLogPayload exports are all in).
- Note: 000058's branch carries a committed one-line deletion to src/webui.ts (backlog, dead pid); expect a minor sequential merge when it runs later.

# Notes
- Restored from erased task 000044_fix_webui_polling_resets_the_animated_card_spinners_every_refresh.md (refs/heads/meta/kanban history commit 6aa8dd3); renumbered because the old number is taken by an active task.

## Developer notes (2026-10-11)
- Commit 6c90c11 on feat/47-webui-stacked-column (base e4c0358); files src/webui.ts and src/webui.test.ts only.
- Layout: pairLayout(states) derives the board layout from STATES in pipeline order (backlog and done single, the states between them paired two by two) and LAYOUT is interpolated into PAGE as JSON, so the queued to-merge/merging states become a fourth pair with no change needed here. New CSS rule .pair (flex column, gap 10px, min-width 200px, flex 1 0 200px); .col, the accent classes, the counts and the #board horizontal scroll are untouched. backlog and done keep the existing content-height single-column model (#board align-items stays flex-start): "single full-height" is read as "not split vertically".
- Refresh: the shell is built once (buildShell uses document.createElement) and the cards are reconciled by task file (syncBoard) in one shared element map. A card is rewritten only when its markup string changed, compared against a cached el.__html and not against read-back innerHTML (browsers normalize that on read, so it would rewrite every card on every refresh); otherwise the card keeps its node, its spinner element and its running animation. Order is fixed by moving nodes (insertBefore only when the node is out of place), so a card entering or leaving a column never rebuilds the cards already in it. The stale-card pass runs once after all columns against one global live set, so a card that moved between columns is not dropped. The moved card keeps its node, so FLIP still measures and animates it. The 5 s interval, the 000030 cap/unfold and the fold keyed by state are unchanged.
- Client code moved out of the PAGE string into webui.ts as exported annotation-free functions (num, esc, spinnerHtml, cardHtml, buildShell, syncBoard) interpolated with ${fn}, so the browser runs exactly the source the tests exercise; PAGE no longer defines STATES/WORKING/esc/num and the visible strings are unchanged.
- Tests added to src/webui.test.ts: the pair structure (5 board slots: c-backlog, three .pair wrappers holding c-to-do over c-doing, c-to-review over c-reviewing, c-to-live-test over c-live-testing, c-done), pairLayout deriving those pairs plus a fourth for to-merge/merging, the state-to-spinner mapping, and a stub element tree (class El) proving that a refresh writes no markup for an unchanged card (spinner element identity plus a write counter), that a state change rewrites only that card and starts or stops the spinner, that a moved card is not dropped, and that the cap/unfold and the empty marker still work.
- Verified: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all green (the orchestrator test sets SE_LLM_TEAM_NO_WEBUI=1 for its own smoke daemons and the webui test uses a temp HOME with port 0, so the production webui on 4242 was never touched, same pid before and after). Headless Chromium against startWebUi on a temp root: the row is backlog | pair(to-do over doing) | pair(to-review over reviewing) | pair(to-live-test over live-testing) | done, with 10px gaps and overflow-x auto; a .spin node tagged before two 5 s refreshes is the same node afterwards and still plays, its animation currentTime advanced about 12 s (not restarted); setting a task to to-do moves the card (same node, spinner gone) and setting it back to doing restores the spinner; the unfold (5 -> 7 -> 5), an open modal and the fold choice all survive a refresh.
- Typecheck: the repo has no tsconfig and no typecheck command (no package.json scripts, and the tsc on PATH is the decoy npm package), so a strict run was done ad hoc with typescript 6.0.3 plus @types/node from other checkouts. src/webui.ts already reported 5 strict errors before this change (implicit-any on flipDiff's params, index-by-string on the accent map); the new num/cardHtml are typed with Task, esc with unknown, spinnerHtml and pairLayout with strings, while buildShell and syncBoard keep the untyped flipDiff style because their DOM-facing params cannot be typed without a DOM lib and annotations in interpolated helpers must stay erasable (String(fn) strips them, verified against the emitted page).
- 000058 merge note: its branch (44f559a) deletes the name row inside openTask's #m-attrs. That function body is untouched here, so the sequential merge is clean.
