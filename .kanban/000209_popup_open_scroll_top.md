---
name: "fix: task details popup opens showing the top"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "popup-open-scroll-top"
---

# Summary
Reset the task details popup's scroll to the top on every open: in openTask (src/webui/page.ts:472-484), set #m-box.scrollTop = 0 in the open path. Runs on every open including same-task reopens, where setBody's html-gate skips the rewrite. The log popup and log scroll logic stay untouched.

# Specs
## Need

When a task details card opens, the popup must show the top: the scroll position resets to the top on every open. Today, tall content or a previous open can leave the popup scrolled mid-way.

Facts (verified):
- The open path is `openTask(file)` at src/webui/page.ts:472-484: it resolves the task, calls `closeLog()`, sets `modalFile`, `writeHead(t)`, `renderAgent(t)`, `setBody(t)`, then un-hides #modal (`classList.remove("closing")`, `classList.remove("hidden")`). No scroll reset exists anywhere in the page.
- `setBody` (:465-470) is html-gated: `if (el.__html === html) return;` — it skips the rewrite when the html is unchanged (deliberate, preserves reader scroll). So reopening the SAME task never rewrites the body; a scroll reset must therefore live in `openTask`, not in `setBody`, to run on every open.
- `#m-box` is the scroll container: src/webui/page.ts:240 `#m-box { ... max-height: 82vh; overflow: auto; }`; #m-body (:252) has no overflow/max-height. Mobile (:272) lifts the cap (`height: 100dvh`). The reset target is #m-box's scrollTop, not #m-body's.
- Test coupling: no test asserts openTask's body or scroll behavior. The nearby pinned script lines (tests/webui.test.ts:872-879, :1019) are untouched by this change; the setBody html-gate pin must keep passing.

## Changes

- In `openTask` (src/webui/page.ts:472-484), add a scroll reset so the popup shows the top on every open: fetch #m-box (the scroll container) and set its `scrollTop = 0` in the open path, after the content calls and alongside showing the modal. One line, no helper.
- It must run on every open, including reopening the same task (where setBody's html-gate skips the rewrite) — do not move the reset into setBody or make it conditional on content changes.
- Do not touch the log popup's open path (openLog :670-695), the log pane's scroll logic (:565-764), setBody's html-gate, or the #194 close/reopen handling comment.

## Acceptance criteria

- `rg -n "scrollTop = 0" src/webui/page.ts` shows the reset inside openTask (between lines 472-484).
- `rg -n "function openTask" -A 14 src/webui/page.ts` shows content set, then the reset, then the un-hide.
- `npm test` passes (five suites), including the setBody html-gate pin.

# Notes

2026-10-14 developer:

- Implemented and verified live. Commit `dd57dd7` first put the reset exactly where the spec's order asked (before the un-hide). A live Playwright check proved that order does not work: a same-task reopen kept `scrollTop` at 840. Root cause: `#modal.hidden` is `display: none`; a `scrollTop` write on it is discarded, and the browser restores the stored offset when the modal is shown again. A different-task open only appeared to pass because `el.innerHTML = html` zeroes the scroll as a side effect.
- Final fix (commit `ca932ea`): the reset now runs after `modal.classList.remove("hidden")`, still one line inside `openTask`, plus a short ordering comment. This deliberately deviates from the acceptance order "content set, then the reset, then the un-hide" to satisfy the Need (top on every open, same-task reopen included). The `setBody` html-gate, the log popup and all log scroll logic are untouched.
- Regression pin added to `tests/webui.test.ts`: inside `openTask`'s source the un-hide must precede `scrollTop = 0`, so a future spec-literal refactor cannot move it back.
- Evidence: `npm test` exit 0, all five suites pass (kanban, orchestrator, webui, extension, index) with the new pin. Live check against an isolated daemon (temp root `/tmp/t209lt/root`, webui 127.0.0.1:4321, isolated HOME; production webui on port 4242 untouched): 1280x800, 30-paragraph body, all PASS: opens at top; scrolls to 840; same-task reopen 0; different-task reopen 0; second and third opens 0; the 5 s refresh keeps the reader scroll at 840; no page errors.
- Minimal browser repro of the ordering rule: on a `display: none` element a `scrollTop = 0` write is discarded (reads 0), and after the show it reads the old 1856 again; the same write after the un-hide reads 0.
- Files touched: `src/webui/page.ts` (`openTask`), `tests/webui.test.ts` (one pin). Nothing else.

2026-10-14 live-tester:

Result: PASS. No issues found, so no new tasks.

Setup: a hub-only fixture (no daemon), two task files with long bodies in `.kanban/` (70 paragraphs, more than 840 px of scroll room), one isolated HOME per hub, ports 4331 and 4332, real Chromium through Playwright. The merged page came from this worktree. The baseline page came from `git archive 618d16a` (the parent of the task commits). Viewports: 1280x800 and 390x844.

Checks on the merged page, all pass, no page errors:
- First open: `#m-box.scrollTop` is 0.
- Close, then reopen the same task: 0 (the baseline keeps 840, the reported bug).
- Scroll, close, then open a different task: 0 (the baseline keeps 840).
- Second and third reopen of the same task: 0 (the baseline keeps 840).
- A reopen 60 ms after Close (the #194 closing path) stays open and shows 0 (the baseline keeps 840).
- The 5 s board poll keeps the reader scroll at 840. The `#updated` stamp changed during the 6.5 s wait, so the poll ran. The reset runs on open only, not on refresh.
- The mobile full-bleed popup (390x844) passes the same first-open and reopen checks.
- Differential control: the baseline page fails exactly the five reopen checks. The test detects the bug, and the fix causes the pass.

Static checks:
- `rg -n "scrollTop = 0" src/webui/page.ts` gives line 485. The line is inside `openTask` (472-486).
- The implemented order is: content set, un-hide, reset. The literal acceptance order (content set, reset, un-hide) is not in the merged code. The Notes explain this deviation, and my baseline run confirms the deviation is necessary (a reset before the un-hide keeps 840 on a same-task reopen).
- The change set is `src/webui/page.ts` (openTask) and `tests/webui.test.ts` (one pin). The log popup path and the log scroll logic are untouched. I did not run the unit suites (developer/reviewer gate).

One correction to the Notes evidence: the Notes state that a different-task open only appeared to pass because `el.innerHTML = html` zeroes the scroll. In my baseline fixture a different-task open kept 840, because the rewrite happens while the modal is `display: none` and the browser restores the stored offset on the show. The fix resets both reopen cases.

Assumptions of the test design:
- "Top" means `#m-box.scrollTop === 0`.
- `#m-box` exists whenever `openTask` runs (static markup). No page error occurred, so this holds.
- The baseline for the differential is commit 618d16a, the parent of the task's first commit.

# Open questions
No open questions for the user.

Assumptions:
- The reset applies to the task details popup only. The log popup keeps its own scroll position.
- The jump is instant (a `scrollTop` assignment), no smooth-scroll animation.
- `#m-box` is always present when `openTask` runs (static markup in the served page), so no null guard is added.
