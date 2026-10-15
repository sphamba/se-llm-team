---
name: "feat: doctor cards in their analysed run's column"
priority: "medium"
state: "reviewing"
worktree: "feat/230-doctor-cards-in-columns"
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

# Open questions
No open questions for the user or client. Assumptions made:
- Doctor cards append at the column end (after the run's sub boxes), below the run card as the
spec asks; the live doctor keeps moving rightmost in the doctor order and slots into its own
run's column like the past cards.
- Doctor cards rebuild on any run-row structure change (spinner restart, as run cards today);
only genuinely new handles animate in, and polls keep the cards alive via the stats-line pass.
- No payload/API change: the doctors payload, its handle scheme and the doctor-log serving are
untouched; the residual #m-doctor row keeps its markup position and hides when empty.
