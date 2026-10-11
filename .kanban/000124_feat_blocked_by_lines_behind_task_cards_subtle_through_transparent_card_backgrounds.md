---
name: "feat: blocked-by lines behind task cards, subtle through transparent card backgrounds"
priority: "medium"
state: "reviewing"
worktree: "feat/124-blocked-by-lines"
---

# Summary
Reorder the blockedBy relation-line layers: lines paint above the column containers but below the task cards, and stay subtly visible through a semi-transparent card background in both themes; the modal bumps above the new card z-index.

# Specs
Rework the blockedBy relation-line paint order in the webui per user decisions: (1) Lines go BEHIND the task cards but IN FRONT of the column containers: keep #relations at z-index 1 (absolute, top 0 left 0, pointer-events none, src/webui.ts PAGE CSS) and give board task cards position: relative; z-index: 2 in the .card rule, so the positioned SVG paints above the static .col/.pair containers and below the positioned cards. (2) Lines stay visible (subtle) BY TRANSPARENCY behind the cards: make the .card background semi-transparent in both themes (e.g. color-mix(in srgb, var(--card) 85%, transparent), or an equivalent alpha variant), so a line passing under a card shows through faintly while the column gutters show it fully. (3) Keep the modal above everything: #119 set #modal z-index 2 — bump #modal to z-index 3 so it still paints above the new z-index-2 cards, keeping the 000119 comment coherent. Keep #relations pointer-events none, the dash animation, and the prefers-reduced-motion kill untouched. Extend src/webui.test.ts: source asserts .card carries position:relative z-index 2 with a semi-transparent background, #relations stays z-index 1, and #modal z-index is greater than .card's. Full suite green: node src/webui.test.ts. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes. Coordination: the webui lane has #120 doing (renderAgent region, disjoint) and #118 (log dispatch, disjoint); this task rewrites the CSS block only — expect additive merge conflicts at most.

# Notes
- Implementation committed in worktree feat/124-blocked-by-lines (356ddf2). .card now carries position: relative; z-index: 2, so #relations (z-index 1, untouched) paints above the static .col/.pair containers and below the cards. Card background is color-mix(in srgb, var(--panel) 85%, transparent) in both themes; the spec's example used var(--card) but no such variable exists, so --panel (the card's effective base color in both themes) is used instead. .card:hover mixes --hover the same way so a line under a hovered dark-theme card stays visible too. #modal bumped z-index 2 to 3; the 000119/000091 comments updated to stay coherent. Dash animation, pointer-events none and the prefers-reduced-motion kill untouched.
- src/webui.test.ts: added a source assert for the .card position/z-index/semi-transparent background, reworded the #relations z-index-1 message, and added cardZ extraction with an assert that #modal outranks .card. node src/webui.test.ts green; kanban/orchestrator/extension/index suites also pass.
