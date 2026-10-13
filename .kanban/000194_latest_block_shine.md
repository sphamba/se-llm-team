---
name: "fix: animated closes and letter-only shine on the latest block"
priority: "medium"
state: "doing"
worktree: "fix/194-latest-block-shine"
issuer: "user"
complexity: "moderate"
shortName: "latest-block-shine"
blockedBy: ""
---

# Summary

Follow-up to #191: the task-details modal and the agent log pane get close animations, and the log's live shimmer moves from the topmost thinking/bash block to the latest one, shining only while the run is currently inside a block and brightening only the letters via background-clip: text, with no visible background.

# Specs

## Modal and log close animations
- The task-details modal currently hides instantly (display: none on close). Add an exit: a .closing class on the overlay and panel runs the reverse of the #191 entrance (fade plus slight scale/slide, ~150-200 ms ease-in); the modal is hidden after animationend, with a fixed-timeout fallback. The X button, the overlay click, and Esc all go through the same close path.
- The log pane open is already animated (#m-log:not(.hidden) animation: logIn); add the matching close: fade/slide out ~150-200 ms, then hide. closeLog keeps clearing the poll and the state immediately; only the visual hide is delayed.

## Live shine retarget (page.ts markLiveLine)
- Today markLiveLine pulses the topmost #m-log-text > * element while the viewed run is alive. It must pulse the LATEST (most recently appended) thinking or bash/tool block, and only while the run is currently inside one: an open/streaming thinking block, or a tool call currently executing (tool_execution_start without its end).
- When the run streams plain text, idles between blocks, or the latest block has ended, no block shines.
- This composes with #193: when the run dies or the view changes, the shine clears.

## Letter-only text shimmer (page.ts CSS trick)
- The pulse is today a visible background gradient sweep on the element. It must brighten only the glyphs: the background-clip: text trick -
  background: linear-gradient(90deg, <text color> 0%, whiter 50%, <text color> 100%); background-size: ~200-300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: a background-position sweep (e.g. 200-300% down to 0) over ~2 s linear infinite.
- The gradient band sits close to the block's current color (slightly whiter), so the effect is letters brightening as the band passes, never a highlight bar or box.
- The lg-think/lg-tool blocks are color: var(--muted), so the band goes muted -> whiter -> muted; regular text blocks keep their own color.
- The prefers-reduced-motion rule must restore a solid color (color: transparent with the animation stopped would make the text vanish): under reduce, drop the background-clip animation and set color back.
- Nested pres and summaries inside the details block inherit the clip through the details element; keep the #147 Inter/monospace and #175 wrap rules untouched.

## Tests
- CSS regex asserts: the background-clip: text rule exists, the reduced-motion rule restores the color, .closing animations exist for the modal and the log pane.
- Rendering asserts: the pulse class lands on the latest open thinking/tool block, not the topmost; no block shines when the run is between blocks or streaming plain text; the shine clears on run death (#193 behavior stays).
- Existing assertions (LAYOUT, chip spacing, #175 wrap, #191 motion rules) stay green.
- Live check: opening and closing the modal and the log animate subtly; the latest running thinking/bash block's letters shimmer; reduced motion shows solid text and no motion.

## Files
- src/webui/page.ts (markLiveLine retarget, modal/log close paths, CSS: clip trick, .closing keyframes, reduced-motion), tests/webui.test.ts.

# Notes
- The ~2 s sweep and the whiter band strength are deliberate defaults; adjust in one place (the CSS custom properties).
