---
name: "feat: doctor cards in their analysed run's column"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "doctor-cards-in-columns"
blockedBy: ""
---

# Summary
Move each web UI doctor card out of the separate #m-doctor row and into the column of the agent run it was analysed from, matched by handle. Doctor card checkmarks use the same blue as the card text.

# Specs
# Specs
- renderAgent's per-run column markup gains a doctor slot: each doctor card renders inside the `.agent-col` of the agent run it was analysed from, below the run card. Match by handle: a doctor entry's handle is the parent run's handle plus the suffix `.doctor` (e.g. run handle `000224_x.developer.0`, doctor handle `000224_x.developer.0.doctor`), so strip the trailing `.doctor` and match against the run card's data-handle. No payload/API changes needed.
- A run's column may hold several doctor cards (ordered oldest leftmost as today). The live doctor card renders in its run's column too.
- Doctor cards with no matching run column (run log rotated away) keep the current fallback: `#m-doctor` stays as a residual row, hidden when empty, holding only unmatched cards.
- Checkmark color: the doctor cards' `.check` ✓ span uses the same blue variable as the doctor card text (the blue introduced for doctor cards). Run cards' and sub cards' checkmarks keep `var(--low-fg)`. Scope the rule to doctor cards wherever they render (e.g. a doctor-card marker class or the slot container), replacing the `#m-doctor`-scoped blue rules from the blue-doctor-cards task so both the in-column cards and the residual fallback row are covered. The blue variables themselves stay theme-aware in all three theme blocks.
- Poll keep-pass keeps working: an unchanged doctor set moves only stats lines in place within columns (syncAgentStats), a structure change rebuilds with each run's fetched sub box carried over by handle and doctor cards re-slotted, the live doctor's spinner survives polls, and only genuinely new doctor cards get the enter animation. markActiveAgent's `#m-agent .agent-card` coverage still hits in-column doctor cards.
- Behavior unchanged otherwise: click opens the doctor log via openAgentLog, labels stay from agentLabel (doctors unnumbered), run buttons and sub cards keep their colors, markup outside the modal unchanged.

# Acceptance
- Live-UI/DOM check: a task with a doctor entry shows the card inside the analysed run's `.agent-col`, not in the separate row.
- Grep check: the scoped blue rule covers doctor cards (in-column and fallback row) and applies the blue to the `.check` span; no un-scoped `.agent-card` or global `.check` rule changed.
- Visual check in both themes: blue card text and blue checkmark.
- Unmatched-doctor fallback still renders in the residual row.

# Notes
- Implemented (commit 2316f6b): renderDoctor slots each doctor card into its analysed run's
.agent-col below the run card, matched by handle via the new board helper doctorCol (strips the
trailing .doctor, compares the run card's data-handle); unmatched cards keep the residual
#m-doctor row, still hidden when empty. The blue styling moved from the #m-doctor-scoped rules
to .agent-doctor marker-class rules (same three theme blocks, values unchanged), plus a new
.agent-doctor .check rule for the blue checkmark; the base .check and .agent-card rules are
untouched. The keep pass is a new board helper syncDoctorCards (sig + card identities + slot
check, stats lines move in place so the live doctor's spinner survives polls) sharing the
extracted syncStatsLine with syncAgentStats; syncAgentStats now assumes .agent-col wrappers
since renderDoctor no longer calls it, and renderAgent's sub-box carry-over selector skips
doctor cards.
- Tests: webui.test.ts gained unit tests for doctorCol, syncDoctorCards (in-place stats move,
spinner identity, rebuild on doctor added/gone, on a run-row rebuild detaching the slotted
cards, and on the live->dead sig flip) and syncStatsLine; the old bare-card doctorRow block was
replaced, the #m-doctor CSS greps became .agent-doctor greps, and renderDoctor source greps
cover the keep pass and the slotting. tests/webui.test.ts passes in full.
- Live check (temp root + daemon on 127.0.0.1:4321, Playwright, isolated HOME): the matched
doctor card renders inside its run's .agent-col and not in #m-doctor, the unmatched card renders
in #m-doctor (the only card there), the doctor log click opens in the shared log pane, and in
both color schemes the card text and the check read the theme doctor blue (dark rgb(89, 167,
255), light rgb(47, 111, 221)) while the run card's check keeps low-fg. Daemon stopped, port
closed, fixture under /tmp/t230 left for reference.

- Review (2316f6b): pass, no fixes. Verified in source: the base .agent-card and .agent-card:hover
rules (page.ts 183-184) precede the .agent-doctor rules (200-203), so the blue rules win at equal
specificity; syncAgentStats's only production caller is page.ts:626 and every test helper builds
.agent-col wrappers matching its new wrapper assumption; the poll calls renderAgent then
renderDoctor (updateOpenTask), so a run-row rebuild detaches the slotted cards and the doctor
keep pass re-slots them; the run card is col.children[0], so doctorCol matching and
syncAgentStats both hit; the sub-box carry-over selector's :not(.agent-doctor) skips slotted
doctor cards. Open questions emptied: the disclosed assumptions are spec-answered (no payload
change, only new cards animate) or consistent with the spec (cards slot after the run's sub
boxes, still below the run card). Suite: tests/webui.test.ts exit=0, all assertions passed
(ran myself).

## Live test (live-tester, 2026-10-15 23:22)
- Fixture: /tmp/lt230/repo, one done probe task. Logs: developer.0 run + developer.0.doctor (matched), reviewer.0 run + reviewer.0.doctor (matched, live through a bare sleep pid in `.pids/000230_probe.reviewer.0.analysis.pid`), merger.0.doctor with no merger.0 run (unmatched). Merged hub on 127.0.0.1:4351 and a pre-change hub (602dbb8) on 127.0.0.1:4352, both over the same fixture, each with its own HOME.
- Result: 37 Playwright checks, 4 hover/active checks, 6 served-page CSS checks and 1 API differential all pass. No product finding.
- Placement: both matched doctor cards render inside their analysed run's `.agent-col`, below the run card and its `.agent-subs` box, with the run's handle plus `.doctor` and the "Doctor" label. `#m-doctor` holds only the unmatched card, and each matched handle is absent from it. When the unmatched doctor's run log appeared mid-run, the next poll re-slotted the card into the new column and `#m-doctor` became empty with `display: none`. The API payload is identical old vs merged, so no payload change.
- Colors in both themes: the in-column and residual doctor cards read the doctor blue (light rgb(47,111,221), dark rgb(89,167,255)) with the same background tint, and the `.check` span is blue. Hover and active read the strong blue. The run card check keeps low-fg and the run card text stays gold. The pre-change page keeps every doctor card in `#m-doctor` and its doctor check is low-fg green, so both fixes are real.
- Poll keep pass: with the live doctor present the modal polls at 1 s. An unchanged doctor set kept every card node and the live doctor's `.spin` node identical across polls, while its stats text advanced. Adding the unmatched doctor's run log triggered a rebuild, carried the run's sub box over by handle, re-slotted the card with no enter animation and hid the empty row. A brand-new run plus doctor gave a `cardIn` animationstart only to the new doctor. Steady-state identity held again after the rebuilds. Clicks on a slotted doctor and on the residual doctor opened the correct log text and set `.agent-card-active` through the `#m-agent` selector.
- CSS: the served merged page has the four `.agent-doctor` rules including `.agent-doctor .check`, no `#m-doctor`-scoped blue rules, and the unscoped `.agent-card`, `.check` and `.cross` rules byte-identical to the pre-change page. `--doctor-fg` stays in 3 theme blocks on both pages.
- Assumptions: a bare sleep pid stands in for a live doctor analysis, and the live doctor stays rightmost as specified. Unit suites were not run (developer/reviewer gate).
