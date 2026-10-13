---
name: "fix: animated closes and letter-only shine on the latest block"
priority: "medium"
state: "done"
worktree: ""
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
- Implemented in commit 06a59e2 (src/webui/page.ts, tests/webui.test.ts); the full suite passes.
- Closes run through one shared closeAnimated(el) helper: it adds .closing, hides on animationend (guarding e.target === el, since descendant chunkIn animations bubble up) with a 400 ms fixed-timeout fallback, and hides instantly with no .closing when matchMedia('(prefers-reduced-motion: reduce)') matches, so reduce skips the exit entirely instead of playing it statically.
- closeModal now early-returns when the modal is hidden, calls closeLog first, then closeAnimated; closeLog clears the poll timer and logState and drops the active-agent highlight and shine immediately, only the visual hide waits for the exit.
- openTask and openLog remove .closing before reopening, so a reopen inside the fallback window cannot snap shut; the late animationend is ignored once .closing is gone.
- Esc was not wired before: a new window keydown handler joins the X button and the overlay click on closeModal.
- markLiveLine walks the pane's direct children and shines the last one that is an open thinking block (data-open) or an lg-tool block with no pre.lg-out result yet; pi always renders text for empty tool output ('(no output)'), so a finished tool block always shows its result and stops shining.
- The shine CSS is a multi-selector rule ('#m-log-text > .pulse' plus the details.lg-think/.lg-tool.pulse variants) because the plain class selector loses to the existing muted color rule on think/tool blocks; --shine-base is var(--fg) by default and var(--muted) for think/tool blocks, mixed with #fff by the --shine knob (45%).
- Knobs retuned: --pulse 1.8s to 2s (matches the sweep), --exit 180ms and --shine 45% added; the reduced-motion restore lives in a second media block (the #191 reduced-motion assertion requires the first block to end right after its animation rule).
- Review fix in c3f62c7: the Notes' animationend guard claim was not implemented. The { once: true } listener fired hide on the FIRST animationend bubbling up, so a log chunk's 150 ms chunkIn (bubbles to #m-log) or #m-box's 200 ms boxIn (bubbles to #modal) snapped the element hidden mid-exit whenever the close started while a descendant entrance was still playing. closeAnimated now checks e.target === el (skip on a bubbled descendant end), keeps the listener armed until the element's own exit ends, and drops it there; the 400 ms fallback and the reopen guard are unchanged. Tests added: a bubbled descendant end does not hide early, the element's own end hides and drops the listener; the CloseEl stub gained removeEventListener.
- Review fix in 80c880e, two findings. (1) The details.lg-think/.lg-tool.pulse base rules (specificity 1,2,1) outranked the first reduced-motion media rule's #m-log-text > .pulse (1,1,0) and #m-log-text > * (1,0,0), so under reduce a pulsing think/tool block kept the chunkIn/shimmer animation running (the fade replayed on every pulse hand-off, the shimmer loop ran on nothing) and kept the gradient, because the restore rule's details variant only restored color. The details variants now join the first media rule's animation: none list and the restore's details variant also drops background-image: none. (2) The 400 ms fallback timer survived a reopen-cancelled close: a second close started inside the fallback window had its exit truncated when the stale timer fired mid-exit (hide's !closing guard passes because the new close legitimately re-added .closing). closeAnimated now clears el.__closeTimer (the box.__html expando pattern) before arming. Tests: the first media rule must cover the details variants, the restore regex asserts background-image: none, and the setTimeout/clearTimeout stubs (shared closeTimers registry) assert the second close clears the stale timer while its own fallback still hides.
- main merged into the branch in adda9f5 (main had moved past the 077c67c merge-base, no webui overlap); all five suites pass after both fixes.

## Live test (hub-only fixture, real Chromium, 41/41 checks, merged adda9f5)

Setup: `startHub` from the merged worktree on an isolated root and HOME. No daemon and no unit suites. Four `doing` probe tasks with live sleep pids and real pi JSONL run logs. Plus one differential control that serves the pre-change page (archive of 7414f4b).

Verified shine retarget:
- The pulse sits on the latest direct child of #m-log-text only when that child is an open thinking block or a tool block without its result pre. The closed first block does not pulse.
- Dynamic appends: `thinking_end` clears the pulse, plain prose keeps it clear, a new open thinking block moves the pulse to the newest of three blocks.
- Tool blocks: `tool_execution_start` pulses, the joined result clears, a second executing tool pulses.
- Death composition (#193): SIGKILL clears the pulse after the board refresh and it stays off.

Verified letter-only shimmer:
- Computed style: `background-clip: text` (prefixed and unprefixed), `color: rgba(0,0,0,0)`, a linear gradient at `300% 100%`, `shimmer` running at 2s, `--shine-base` = `--muted` for think/tool blocks, and a transparent color on the nested pre.
- The gradient swept from 100% to 75% in 500ms. An element screenshot shows painted glyphs (180 non-background pixels) and the element's right edge stays the pane background, so no highlight bar exists.

Verified closes:
- X, overlay click and Esc all add `.closing` with `fadeOut`/`boxOut` at 0.18s and hide the modal about 200ms after the click.
- X with the log open closes both elements with animation.
- The log close adds `logOut`, keeps the DOM text during the exit, and clears the poll at once (no agent-log request after the hide).
- A reopen 60ms into the exit drops `.closing` and the pane stays open past the 400ms fallback, with the pulse restored.
- Reduce: the pulse class stays, the animation is `none`, the gradient is `none`, the block and its pre get a solid muted color, and both closes are instant without `.closing`.
- Differential control: the pre-change page pulses the topmost child, the merged page pulses the latest open block.
- No console or page errors in either context.

Test assumptions:
- "Latest block" means the last direct child of #m-log-text. The fixture never builds an open block followed by another section without its end record, because the real pi stream does not produce that order.
- The change is confined to the served page, so the hub-only recipe is enough and no daemon is needed.
- The timing asserts allow 120 to 450ms for the 180ms exit plus browser scheduling.

No findings. No new tasks.

# Open questions
- Assumption: the executing-tool signal is the client-side DOM heuristic (lg-tool block without its result pre), not a new server-side marker, because the task is limited to src/webui/page.ts and tests/webui.test.ts and real pi logs always carry result text.
- Assumption: under prefers-reduced-motion the close animations are skipped entirely (instant hide) rather than played as a static 400 ms wait.
- Assumption: the fallback hide timeout is a fixed 400 ms, which covers the 180 ms exit and the bubbled entrance animations; retuning --exit past 400 ms would need the timeout raised too.
- Assumption: Esc closing is wanted even when the modal is mid-close (a second Esc is a harmless no-op).
