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

## Agent-run analysis (73 blocks)

The run passed: 29 checks, 0 failed, one product finding. The run lost most time before the first fixture file, not in testing.

| Pain point | Blocks | Cost | Fix in AGENTS.live-tester.md |
| --- | --- | --- | --- |
| Over-long planning: the fixture plan, the instrumentation list and the port were re-derived across thinking blocks, with wait/carefully hedges, before the first fixture file landed | 4, 20, 24, 33, 35, 37 | largest single loss | Run order step 0: plan in one pass, long plans go to /tmp, instrumentation is recipe material to copy |
| Test-script crash and fix loop: a destructure callback written without its arrow body (`.map(([, h]))`) parsed as an array literal, passed `node --check`, and crashed with a ReferenceError after six phases had passed | 39-44 | ~6 blocks | Step 4: after a mid-run crash, read the exact source line and suspect a dropped callback body |
| Circular re-derivation: the max-height clamp math and the finding-vs-not-finding decision were re-litigated across blocks; an assertion authored from the 0.2 s transition faked a FAIL | 45, 49, 59 | ~3 blocks | Step 4: decide finding-vs-not-finding once, never revisit; new "Animation and growth" rule: measure rendered rAF heights, never the transition span |
| Control fixture added mid-run: the near-cap gamma body arrived in blocks 50-51 instead of in the initial fixture | 50-51 | 2 blocks | "Animation and growth" rule: put the near-cap control body in the INITIAL fixture |
| Failed edit: an abort line matched two locations, so a 4-edit batch was re-issued | 54-57 | ~4 blocks | Report discipline: anchor the edit on a unique neighbouring line in the same batch |
| Route abort placed before the sample point (S16): an immediate abort left a ~0 ms spinner window and faked a fail | 16 | ~1 block | Step 4: place the abort AFTER the sample point |
| Wrong-file and empty greps re-run (startHub, taskBody) | 14, 21 | 2 blocks | Codebase map: one broad grep settles a call site, never re-grep |
| Wrap-up re-deliberation: the pgrep self-match and `$$` semantics were re-derived one run after #243 | 68-72 | ~5 blocks | Shell traps: a lone pgrep hit whose cmdline is the cleanup bash itself is your own shell, ignore it |

Biggest loss: planning. Six of 73 blocks re-derived the fixture plan, the rAF instrumentation and the port. Second: the crash-fix loop (39-44), which also invalidated six passing phases until the fix landed. Third: the wrap-up re-deliberation (68-72), a documented trap re-derived one run after #243.

The guidance file now carries a rule for each row above, plus the new per-task recipe "Detail spinner and grow (#246)" (three bodies with the near-cap control in the initial fixture, per-num route delays, rAF height sampling, mobile and reducedMotion phases). The product finding (grow near-instant for long bodies: 3101px target under the 738px 82vh cap, ~30 ms of a 193 ms transition) is recorded in the Live test section above.
