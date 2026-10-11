---
name: "fix: modal overlay covers the hub repo tab bar; a tab click only closes the modal"
priority: "low"
state: "done"
worktree: ""
---

# Summary
In the hub frontend, the pre-existing full-screen #modal overlay covers the repo-name tab bar: with a task modal open, a pointer click on another repo's tab lands on the overlay, so it only closes the modal and the user needs two clicks before the tab actually switches (the tab bar is also visibly dimmed and unreachable). Give the tab bar a stacking context above the overlay, or hide/disable it while the modal is open; found in the live test of #39 (which otherwise passed every spec point).

# Specs
The hub frontend's repo-name tab bar (#39) is not clickable while a task detail modal is open: the existing full-screen `#modal` overlay sits above it. The Spec says "The open modal closes on tab switch", but a pointer user needs two clicks (first closes the modal, second switches), and the tab bar is visibly dimmed and unreachable while the modal is open.

Repro:
- Open the hub UI, open any task card so the task detail modal is shown.
- Click another repo-name tab at the top of the page.
- The click lands on the overlay: the modal closes but the tab does not switch; a second click is needed.
- Evidence from the live test of #39: screenshot /tmp/lt39/modal-over-tabs.png, plus a hit test — document.elementFromPoint at the tab's center returns `#modal` (not the tab).

Fix direction (either is acceptable):
- Give the tab bar a stacking context above the overlay (e.g. `position: relative` plus a `z-index` above `#modal`), making the tabs clickable and switching directly on the first click (the modal should then close as part of the tab switch), or
- Hide (or disable) the tab bar while the modal is open, so the dimmed bar is not presented as interactive.

Acceptance:
- With a task modal open, a single real pointer click on another repo's tab switches to that repo and closes the modal; OR the tab bar is visibly hidden/disabled while the modal is open so no unreachable-looking tab bar is shown.
- Without an open modal, tabs behave exactly as before.
- Typecheck and the existing suites stay green; extend src/webui.test.ts if the changed behavior is assertable there.

Provenance: surfaced by the live test of task #39, which PASSED every spec point; this is the only issue found and the feature is otherwise complete.

# Notes
- Fixed in worktree fix/91-modal-overlay-covers (commit 7b52dc0). Chose the stacking-context direction: `#modal` is the only positioned element (position: fixed, z-index auto), so `#tabs` now has `position: relative; z-index: 1`, keeping the tab bar above the overlay, undimmed and clickable while a modal is open. `switchTab` already calls `closeModal()`, so a single click on a tab switches and closes the modal. Without a modal, tab behavior is unchanged (same click path, only paint order above the hidden overlay differs).
- Added one assertion to src/webui.test.ts that the shipped PAGE carries the `#tabs { position: relative; z-index: 1;` rule. All suites green: webui.test.ts, kanban.test.ts, orchestrator.test.ts. No separate typecheck exists in the repo (checks run via node directly, see README Checks).
- Did not change the header/theme button stacking (spec only covers the tab bar); those stay under the overlay as before.
- Review of commit 7b52dc0 against the Specs: no issues found, no fixes made. Verified in code: #modal is the only other positioned element (position: fixed, z-index auto), so #tabs at position: relative; z-index: 1 paints and hit-tests above the overlay; switchTab already calls closeModal(), so one tab click switches and closes; #modal.hidden { display: none } keeps no-modal behavior unchanged (relative without offsets moves nothing). Re-ran all suites in the worktree: webui.test.ts, kanban.test.ts, orchestrator.test.ts all green. Worktree clean at 7b52dc0.
- Non-blocking observation: a very tall #m-box (max-height: 82vh) could visually reach the tab-bar zone on short viewports and the bar would paint above it, but the modal box stays scrollable and the overlay still covers everything else; acceptable for this fix.

- Live test report. The live test ran the change like a user. It used the hub served from worktree fix/91-modal-overlay-covers at commit 7b52dc0. Two projects were registered (worktree-91 and main-checkout), so the repo-name tab bar was visible. The browser was Chromium through Playwright at a viewport of 1280x800. The test used real pointer clicks (page.mouse.click at the tab center), plus hit tests with document.elementFromPoint.

Results (all PASS):
- Two repo tabs render.
- Without a modal, one click switches the active tab, and switching back works. The behavior is unchanged.
- A card click opens the task modal.
- With the modal open, the tab center hit-tests to the tab button, not to #modal.
- With the modal open, ONE real pointer click on the other repo tab switches the tab AND closes the modal.
- The tab bar carries its own stacking context: #tabs is position: relative and z-index: 1, while #modal is position: fixed and z-index: auto.
- With the modal open, the inactive tab stays visible and keeps opacity 1. The bar is not dimmed and not unreachable.

Control run (pre-fix, parent commit d93e444): the same hit test returned #modal at the tab center. A single real pointer click closed the modal but did NOT switch the tab. This confirms that the test detects the original bug, and that commit 7b52dc0 removes it.

Suites in the worktree: webui.test.ts, kanban.test.ts and orchestrator.test.ts all pass. Worktree is clean at 7b52dc0.

No issues found. No open questions for the user or client.
