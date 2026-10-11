---
name: "feat: blocked-by lines behind task cards, subtle through transparent card backgrounds"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Reorder the blockedBy relation-line layers: lines paint above the column containers but below the task cards, and stay subtly visible through a semi-transparent card background in both themes; the modal bumps above the new card z-index.

# Specs
Rework the blockedBy relation-line paint order in the webui per user decisions: (1) Lines go BEHIND the task cards but IN FRONT of the column containers: keep #relations at z-index 1 (absolute, top 0 left 0, pointer-events none, src/webui.ts PAGE CSS) and give board task cards position: relative; z-index: 2 in the .card rule, so the positioned SVG paints above the static .col/.pair containers and below the positioned cards. (2) Lines stay visible (subtle) BY TRANSPARENCY behind the cards: make the .card background semi-transparent in both themes (e.g. color-mix(in srgb, var(--card) 85%, transparent), or an equivalent alpha variant), so a line passing under a card shows through faintly while the column gutters show it fully. (3) Keep the modal above everything: #119 set #modal z-index 2 — bump #modal to z-index 3 so it still paints above the new z-index-2 cards, keeping the 000119 comment coherent. Keep #relations pointer-events none, the dash animation, and the prefers-reduced-motion kill untouched. Extend src/webui.test.ts: source asserts .card carries position:relative z-index 2 with a semi-transparent background, #relations stays z-index 1, and #modal z-index is greater than .card's. Full suite green: node src/webui.test.ts. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes. Coordination: the webui lane has #120 doing (renderAgent region, disjoint) and #118 (log dispatch, disjoint); this task rewrites the CSS block only — expect additive merge conflicts at most.

# Notes
