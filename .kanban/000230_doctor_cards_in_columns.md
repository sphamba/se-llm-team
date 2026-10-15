---
name: "feat: doctor cards in their analysed run's column"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "doctor-cards-in-columns"
blockedBy: "#226, #227"
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
