---
name: "feat: subtle animations and transitions across the webui"
priority: "medium"
state: "reviewing"
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
- Done (commit 0e5b620 in .worktrees/feat/191-webui-motion, suite green). The spec's root-cause premise was outdated for this checkout: syncBoard was already an in-place pass keeping one DOM node per card (the el.__html gate long predates this task), so the work became the remaining gaps. logpane.ts needed no change (the fade is page.ts CSS; the spec's logpane items are covered there).
- One-shot entrance: syncBoard appends " enter" to a genuinely new card's className; the page's makeCard drops the class on animationend, so a later poll or insertBefore reorder never replays it. Under reduced motion the animation is disabled and the class lingers harmlessly. The entrance lives off .card CSS because a running CSS animation outranks the FLIP pass's inline transform and insertBefore replays it on every reorder.
- In-place stats (supersedes the accepted #178 spinner restart): cardBaseHtml(t, st) is the structural identity syncBoard compares, taskStats(t) returns the bare totals text, taskStatsText(t) wraps it in the span (cardHtml output unchanged), and syncCardStats(el, t, doc) updates the .card-stats span's textContent in place (joins/removes it as stats arrive/vanish), so a stats-only poll never rewrites the card markup and the .spin animation survives. syncBoard took a 7th doc parameter; the page call site passes document.
- Effects: #modal fades (fadeIn), #m-box rises slightly with scale (boxIn), #m-log fades and rises (logIn), all entrance-only on open (the .hidden toggle restarts them); #m-log-text > * fades each newly inserted chunk (chunkIn, 150 ms); a live run's log first line carries the pulse shimmer (paint-only background-position sweep, 1.8 s) via markLiveLine, driven from pullLog and closeLog; .agent-card.enter reuses cardIn. Durations sit in :root as --enter: 200ms; --fade: 150ms; --pulse: 1.8s.
- Sub cards: the fetchSubs rebuild is gated behind box.__html !== html so the 1 s keep-poll never replays entrances; only a genuinely new sub/run card gains .enter.
- Reduced motion: the original exact rule (spinner + relation paths) is untouched; a second rule disables the new animations (entrances, chunk fade, pulse loop). The existing exact-string regex assert on the first rule stays green.
- Known limits: bare text lines ([prompt] ... and legacy text-only logs) cannot animate, so they get neither the chunk fade nor the pulse (text nodes carry no class; wrapping chunks would break logFixups' cross-chunk join); #m-log-meta is not animated (it toggles visibility on polls).
- Verification run (re-spawn): prior work re-checked against the specs (diff reviewed, full suite green), then the spec's live check ran for real: a throwaway hub from the worktree on a spare port (47119) with an isolated HOME (temp registry, production registry untouched), a seeded temp root (a doing task, a live slug.pid pid file, a log streaming one line per second) and Playwright against it; the production webui on 4242 stayed untouched.
- Live check result: board entrance cardIn, modal fadeIn/boxIn and log pane logIn all fire at open and settle to the static frame; no replay-on-poll flicker over a full refresh cycle (0 post-load cardIn events); the pulse and chunkIn machinery verified via a synthetic DOM probe (chunkIn 150 ms iter 1, shimmer 1.8 s infinite, 90deg gradient, bg-size 300%). The seeded plain-text log renders text nodes, so the chunk fade and pulse had no live target, the documented known limit above (real --mode json logs render element children).
- Live check caught a real bug, fixed (commit e8e97d0): the second reduced-motion rule sat before the base animation rules it must disable; equal specificity, later rule wins, so #modal/#m-box/#m-log/#m-log-text entrances stayed animated under reduced-motion emulation. The rule now sits after @keyframes boxIn (the last base animation declaration), and a test assert pins the cascade order (page.indexOf boxIn < the media rule). Re-verified in the browser: with reducedMotion emulation every animation-name reads none (card, modal, box, log, spin), without it fadeIn/boxIn still fire.
- Cleanup: throwaway hub, streaming loop and sleeper torn down, port 47119 free, temp dirs removed; production hub still healthy.
- Review pass (fix commit e472661): two replay paths the live check missed. (1) fetchSubs gave sub cards .enter with no animationend drop, but renderAgent's row rebuild re-attaches the carried-over sub boxes (replaceWith). Re-attaching a node restarts its CSS animations, so any run-set change after a sub appeared (a new run, or live -> dead) replayed every carried-over sub card's entrance. Fixed with the makeCard one-shot drop (class removed on animationend). (2) markLiveLine toggled the pulse on the current first child only. A history back-fill (scroll to top on a live log) inserts older lines above it, so the demoted line kept .pulse and shimmered on. markLiveLine now walks #m-log-text > .pulse and keeps the pulse only on the first line. Both page-source asserts updated. Suite green.
- Review observation, no change: a run card and the initial sub list get no entrance on first modal open, only poll-driven new runs and subs animate. The modal's own fadeIn/boxIn covers the open, and this matches the calm goal. Run cards need no drop handler: a row rebuild discards their old nodes, they are never re-attached.

# Open questions
- Assumption: "the first line" of a running log means the pane's topmost element line (a stable alive beacon, not the streaming tail); when the log starts with a collapsed details block, the pulsed line is that summary. If the streaming tail was meant, the CSS target changes to the last child.
- Assumption: the pulse gradient uses color-mix over --link (14%) so it reads in both themes; retune in one place if too faint.
