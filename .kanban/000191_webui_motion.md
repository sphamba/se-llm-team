---
name: "feat: subtle animations and transitions across the webui"
priority: "medium"
state: "doing"
worktree: "feat/191-webui-motion"
issuer: "user"
complexity: "moderate"
shortName: "webui-motion"
blockedBy: ""
---

# Summary

Every state change in the webui gets a subtle animation or transition: new task and agent cards appearing, opening task details, opening the agent log pane, new text streaming into the log, and a left-to-right pulse on the first line of a currently running agent's shell or task log. Motion must be GPU-cheap, run only on genuinely new content, and honor reduced-motion.

# Specs

## Root cause first: cards must stop rebuilding every poll
- syncBoard (src/webui/board.ts) rebuilds task card HTML on every 5 s poll, so any CSS entry animation on .card would replay each poll (flicker). Before adding animations, make syncBoard an in-place update pass: unchanged cards keep their DOM nodes (keyed by data-file, compare the rendered HTML like the modal's __html gate), only genuinely new cards are inserted. This supersedes the accepted #178 limitation (the .card-stats spinner restart) as its planned upgrade path.
- Existing board-refresh node-identity assertions in tests/webui.test.ts stay and gain: unchanged cards keep their nodes across a poll; only new cards are inserted once.

## Effects (page.ts style block, one keyframes/transition set per effect)
- New task or agent cards: fade + small translateY (2-4 px) entrance, ~200 ms ease-out, running once on insertion.
- Task details modal: fade + slight scale/slide entrance on the overlay and panel (~200 ms). Entrance only.
- Agent log pane: fade/slide entrance on open.
- Streaming log text: newly appended chunks/lines fade in subtly (~150 ms opacity/translate), only on newly appended nodes so no replay.
- Running shell or task log: the first line (or the collapsed live line) pulses left to right while the agent is alive — a soft gradient shimmer sweep via background-position keyframes (~1.5-2 s loop), applied with a .pulse class only when the run is alive (same aliveness signal as .spin).
- The existing .spin keyframes stay.

## Constraints
- Transform/opacity only where possible; no layout-thrashing properties.
- @media (prefers-reduced-motion: reduce) disables the new animations, transitions, shimmer, and .spin.
- Durations stay subtle (150-250 ms entrances, one slow shimmer loop); nothing bounces or blocks interaction.
- Animations never replay on unchanged content after a poll or re-render.

## Files
- src/webui/board.ts (in-place card update pass, new-card entrance class), src/webui/logpane.ts (chunk fade-in on append, live first-line pulse), src/webui/page.ts (CSS: keyframes, transitions, reduced-motion rule), src/webui/index.ts (re-export any new named export), tests/webui.test.ts.

## Tests
- CSS regex asserts: the new keyframes exist, the prefers-reduced-motion rule exists, the entrance classes are wired where specified.
- Node-identity asserts: unchanged cards keep their nodes across a poll; new cards animate once.
- Existing assertions (LAYOUT, chip spacing, #175 wrap, integer seconds, #178 stats) stay green.
- Live check: the board, a task modal, an agent log with streaming text, and a running log's pulsing first line look subtle and calm; reduced-motion emulation shows no motion.

# Notes
- The 200 ms entrance and 1.5-2 s shimmer loop are deliberate defaults; adjust in one place (the CSS custom properties) if needed.
