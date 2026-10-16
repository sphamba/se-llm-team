---
name: "fix: spinner and animated height while task details load"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "task-detail-spinner"
---

# Summary
Task detail modal polish: show a spinner while the detail fetch runs (instead of only the text placeholder) and animate the modal height growing when the content arrives. CSS-only, no libraries.

# Specs
## Goal
The task detail modal shipped by #242 (commit 95843be) shows a "Loading task details…" text placeholder while the detail fetch runs, then jumps to full height when content arrives. Decided UX: a spinner while loading, and the modal height grows with animation when the content arrives.

## Facts (current state)
- src/webui/page.ts openTask: renders the modal shell from the light row, shows a "Loading task details…" placeholder in the body, fetches GET /api/task-detail?num=N on every open with no client-side cache, discards a superseded open's response with a generation counter, and shows "Task details failed to load" on failure.
- The modal markup and CSS live in the PAGE template string (src/webui/page.ts); no frameworks, no animation libraries.

## Required changes
1. Loading state: show a spinner while the detail fetch runs, alongside the existing "Loading task details…" label. CSS-only spinner, no libraries, no images.
2. Height animation: when the detail arrives, animate the modal height from the loading height to the content height (CSS transition on height or max-height; no libraries). The modal must not jump.
3. Failure state: the spinner stops, the inline error shows; no growth animation on failure.
4. Do not change the fetch behaviour (every open fetches, no cache, supersede guard stays).

## Constraints
- Keep the template-string client; no new dependencies.
- Do not touch the /api endpoints, the agent log pane (#243), the board cards (#245), or the poll/notify logic (#244).

## Acceptance criteria
- `pnpm test` passes with no regressions.
- Manual check (live test): open a task with the webui open; a spinner shows while the details load, and the modal height grows with a smooth animation when the content arrives; on a failed fetch the spinner stops and the inline error shows.

# Notes
- Review of 985e194 (base main; scope is that commit, 95843be in the range is #242's and out of scope): all spec points pass.
  1. Spinner: `<span class="spin"></span>` pairs with the label; the existing `.spin` CSS (keyframes, reduced-motion off) already covers it, CSS-only, no libraries.
  2. Height animation: `#m-box.grow { transition: height var(--enter) ease-out }`, openTask pins the loading height after the un-hide (hidden box measures zero), the arrival transitions to the measured scrollHeight, and a 400ms fallback restores auto height (mirrors closeAnimated's timer). No jump.
  3. Failure: the box unpins before the error replaces the loading div, so the spinner leaves the DOM and no growth runs; pinned by a test regex.
  4. Fetch behaviour untouched: gen/modalFile supersede guards and the every-open fetch stay.
- Constraints hold: template-string client kept, no new dependencies, endpoints/log pane/cards/poll untouched.
- Tests: tests/webui.test.ts (the touched suite) exit 0, all assertions passed; new asserts pin the markup, transition, pinned height, and the failure unpin.
- Assumption called out (was not in the task, visible in the diff): mobile (≤600px) skips the grow entirely via a matchMedia guard and keeps its instant full-screen sheet. Reasonable, stated in the code and commit body.
- The manual live check from the acceptance criteria still belongs to live-testing.

## Live test (985e194, hub-only fixture)
- Interface: real Chromium against `startHub` from this worktree, serving `/tmp/246t/repo/.kanban` (3 fixture tasks, a 45-paragraph alpha, a short beta, a near-cap gamma) on 127.0.0.1:4351 with an isolated HOME. No daemon and no unit suite.
- 29 scripted checks, 0 failed. One test-script bug was fixed between the two runs (an immediate route abort left no spinner window, and the first "animated growth" bar ignored `max-height` compression). The acceptance points:
  - Spinner: `#m-body .spin` shows and runs (`animationName: spin`, playState running) beside "Loading task details..." while a 700 ms detail delay is in flight, and leaves when the content lands.
  - Grow: the box pins to the loading height (279px inline == rect) with `#m-box.grow` and computed `transition: height 0.2s`, grows when the detail arrives, and releases to auto after the 400 ms fallback. The final height equals min(scrollHeight, 82vh).
  - Failure: the spinner shows while a delayed failing fetch is pending, then stops, the inline error shows, the box unpins, and no height transition fires (0 events, stable height).
  - Fetch behaviour: two opens of one task make two `/api/task-detail` requests (no cache), and a superseded open's response never overwrites the newer one.
  - Mobile 390x844: the spinner shows, the grow is skipped (no class, no inline height, 0 transitions), and the sheet stays full-screen (844px, top 0).
  - Reduced motion: the grow class pins the height but computed `transitionDuration` is `0s` and no transition fires, and the pin is still released.
- Finding: for a long body the rendered grow is effectively instant. A 45-paragraph body (scrollHeight 3101px, cap 738px) renders 279 -> 660 -> 738 in about 30 ms (rAF frames), although the height transition runs 193 ms, because the transition target is the full `scrollHeight` and `max-height: 82vh` clamps the used height. A near-cap body (scrollHeight 821px) animates smoothly, 8 intermediate frames over 152 ms. So "grows with a smooth animation" holds for shorter bodies and reads as a near-instant expansion for the long bodies that real task files have. Possible upgrade: transition to `min(scrollHeight, max-height)`, so the cap is reached exactly at the transition end.
- Test assumptions: `max-height: 82vh` (738px at a 900px viewport) is the natural final height, the 700 ms route delay stands in for a slow network, and headless rAF samples rendered frames.
- No open user/client questions.
