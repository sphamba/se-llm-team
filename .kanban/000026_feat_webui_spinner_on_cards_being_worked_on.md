---
name: "feat: webui spinner on cards being worked on"
priority: "low"
state: "done"
worktree: ""
---

# Summary
In the webui, show a spinner on task cards while an agent works on the task: states doing (Developer), reviewing (Reviewer), and live-testing (Live-tester).

# Specs
Add a spinner to task cards in the active-work states.

Changes (src/webui.ts):
- In render(), add a spinner element to cards whose state is an active-work state: doing (Developer), reviewing (Reviewer), live-testing (Live-tester). Other states show no spinner.
- CSS-only spinner: a small rotating circle with @keyframes, no assets, no dependencies. Place it inline before the name. Use the theme CSS variables so it works in light and dark mode (000025 adds dark mode).

Acceptance:
- Cards in doing, reviewing, and live-testing show a spinner; backlog, to-do, to-review, to-live-test, and done do not.
- Existing tests pass.

Constraints:
- Only src/webui.ts changes.
- HOLD until 000025 merges: it rewrites render() and the styles in the same file. Apply this on top of its merge.

# Notes

- HOLD lifted: 000025 (webui dark mode, renamed to 000025_feat_webui_task_numbers_dark_mode_new_title_updated_first_sort) is done and merged; this worktree HEAD 6444b19 is past the merge d896e11, so render() and the dark styles were already in place.
- src/webui.ts, 3 small changes: (1) `.spin` CSS rule after `.num` — 9px inline-block circle, `border: 2px solid var(--border)` track with `border-top-color: var(--fg)` arc, `@keyframes spin` rotation at .9s, both vars defined in the light :root and both dark palettes so it works in light and dark mode; added a `prefers-reduced-motion` guard that stops the animation (static circle remains as the active indicator). (2) `const WORKING = ["doing", "reviewing", "live-testing"]` next to STATES. (3) render() prepends `<span class="spin"></span>` inside the `.name` div, before the number and name, exactly when `WORKING.includes(st)`; all other states render no spinner.
- Verification: `node src/webui.test.ts`, `node src/kanban.test.ts`, `node src/orchestrator.test.ts` all pass; an inline check confirmed the served page contains the `.spin` rule, keyframes, reduced-motion guard, the WORKING list, and the conditional span.
- Skipped test-file changes: the task constraint says only src/webui.ts changes, so webui.test.ts is untouched; existing tests cover the page.
- Review (no fixes): diff main...HEAD touches only src/webui.ts, one commit (1213fb4; the note above names 6444b19, the 000025 done commit, as HEAD at write time). HOLD satisfied: 000025 merge d896e11 is an ancestor of HEAD. Spinner markup is conditional on `WORKING.includes(st)` in render(), so backlog, to-do, to-review, to-live-test, and done render no spinner. `--border` and `--fg` are defined in the light `:root` and both dark palettes (explicit dark and prefers-color-scheme dark), so the spinner themes correctly in light and dark mode. Re-ran webui, kanban, and orchestrator tests: all pass; a live fetch of the served page confirmed the `.spin` rule, keyframes, reduced-motion guard, WORKING list, and conditional span. Approved for live test.
- Live test (no issues): ran the worktree's webui code on ports 4343/4344, one instance against the real board and one against a temp board with one card in each of the 8 states (the real board had no doing card). Headless Chromium checks: temp board — spinner on doing, reviewing, and live-testing cards, none on backlog, to-do, to-review, to-live-test, done (8/8 columns match). Real board — spinner on #27 (reviewing) and #26 (live-testing), none on backlog (3 cards) or done (26 cards). Computed style: 9px inline-block circle, animation spin 0.9s, arc uses var(--fg) (rgb(15,23,42) light / rgb(226,232,240) dark) and track var(--border) (rgb(51,65,85) dark), so it themes in both modes; screenshots in light and dark look right, spinner sits inline before the number and name. Reduced motion (prefers-reduced-motion: reduce): animation off, static circle still shown as the active indicator. Re-ran webui, kanban, and orchestrator tests from the worktree: all pass. Test servers and temp board cleaned up; screenshots kept at /tmp/spinner-lt-light.png, /tmp/spinner-lt-dark.png, /tmp/spinner-lt-real.png.
