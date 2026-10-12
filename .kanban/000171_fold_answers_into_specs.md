---
name: "fix: answered board questions land in # Notes, not the Specs the skill and Developer contract require"
priority: "medium"
state: "to-live-test"
worktree: "fix/171-fold-answers-into-specs"
issuer: "#161"
complexity: "simple"
shortName: "fold-answers-into-specs"
blockedBy: ""
---

# Summary
Found in the live test of #161 (merged 3149f65): while #161 was live-testing, the live board answered tasks #167 and #168 by writing a "## Decision (user, 2026-10-12)" block inside # Notes and clearing openQuestions, leaving the Specs' ambiguous either/or acceptance untouched, and the orchestrator promoted both within a minute. SKILL.md says the PM folds answers into the Specs, kanban_update cannot write Notes at all (no notes field, additionalProperties false), and agents/developer.md says "The Specs are the contract", so the recorded decisions may not bind the Developer. Either fold answered questions into the Specs as written, or reword the skill and the Developer prompt to record and honour decisions in Notes.

# Specs
Found in the live test of #161 (merged commit 3149f65), observed on the live board.

## Problem

The changed SKILL.md text (and step 2 before it) says the PM folds the answers to a blocked task's open questions into that task's Specs with kanban_update, replacing the ambiguity the questions expressed. What the live board actually did contradicts that: the answers landed in # Notes, and the Specs kept their original unresolved either/or acceptance. Since agents/developer.md:12 says "The Specs are the contract.", a decision that lives only in Notes may not bind the Developer; kanban_update cannot even produce that Notes text (index.ts's kanban_update has no notes parameter and sets additionalProperties: false, so a notes field is rejected), so the observed fold cannot come from the documented tool path.

## Evidence

- While #161 was in live testing, tasks #167 (000167_stale_daemon_steals_hub_port.md) and #168 (000168_hub_candidacy_path_based.md) were in state backlog with a non-empty openQuestions section.
- At 22:21:32 the user's decisions were recorded there as a new "## Decision (user, 2026-10-12)" block inside each task's # Notes section, and the openQuestions were cleared; the orchestrator promoted both tasks to doing within about a minute (worktrees fix/167-stale-daemon-steals-hub-port and fix/168-hub-candidacy-path-based).
- The # Specs sections were left unchanged and still end with the original unresolved either/or acceptance: #167 - "Either the production daemon can reclaim/preempt the port from a worktree-rooted old-code hub ..., or the residue is accepted and a documented one-time hygiene step ... is added."; #168 - "Either the .worktrees path-segment rule is accepted and documented ..., or detection switches to git worktree topology ... with a test covering a worktree outside .worktrees."
- The decisions themselves are unambiguous in Notes (#167: one-time manual hygiene; #168: switch to git worktree topology with a test), and the work so far matches them, but a Developer that reads only the Specs still sees an open either/or.
- kanban_update's parameters (index.ts, kanban_update tool) are file, name, priority, complexity, summary, specs, openQuestions, blockedBy with additionalProperties: false - no notes, so Notes cannot be written with the documented tool.

## Decision (user, 2026-10-12)
Answered open questions refine the Specs directly: the PM folds each answer into the task's Specs, replacing the ambiguous either/or acceptance with the decided acceptance, so a Developer can implement from the Specs alone ("The Specs are the contract" stays as written). Notes may still carry the decision as provenance. The PM uses kanban_update(specs), which replaces the whole Specs section; answers never live in Notes alone.

## Expected change
Keep the skill's fold-into-Specs wording as the contract. The practice must match it: the PM replaces the ambiguous acceptance in the Specs with the decided acceptance (kanban_update(specs)), and the Developer prompt keeps "The Specs are the contract." No code change: kanban_update already replaces the whole Specs section.


One of:
1. Fold answered questions into the task's Specs as the skill writes: the Specs' ambiguous acceptance is replaced by the decided acceptance (kanban_update replaces the whole Specs section), and the skill's wording stays as the contract. Notes may still carry the decision as provenance.
2. Reword the skill (step 2's openQuestions bullet and the Watcher-section follow-up) and the Developer prompt (agents/developer.md "The Specs are the contract.") so a "## Decision (user, ...)" block in # Notes is an explicit, honoured decision record - and say how the PM writes it, since kanban_update cannot.

Whichever is chosen, skill, Developer prompt and observed practice must agree.

## Acceptance

- SKILL.md and agents/developer.md state one consistent place for answered questions, and that place is reachable with the documented tool path (or the tool path gains the capability).
- The task's Specs contain only acceptance criteria that a Developer can implement without consulting Notes, or the prompt explicitly instructs Developers to read and follow the Decision block in Notes.

## Blocker note

Blocked by #172 because both tasks rewrite the same SKILL.md Watcher-section bullet (the "fold the answers into the tasks' Specs" sentence lives there); whichever lands first sets the wording the other must respect.

# Notes

- Implemented the user decision (option 1, fold into Specs). Worktree commit ca621b3, skills/se-llm-team/SKILL.md only, 1 line changed.
  - Step 2's openQuestions bullet now states the fold semantics: kanban_update(specs) replaces the whole Specs section, so the PM restates the ambiguous acceptance as the decided acceptance and the Developer implements from the Specs alone.
  - The same bullet now says # Notes may repeat a decision as provenance, but an answer never lives in Notes alone: kanban_update cannot write Notes, and Notes does not bind the Developer.
  - agents/developer.md untouched: "The Specs are the contract." stays as written, and it already points answers at the Specs ("When an answer reaches the Specs, remove the question from the section"). The live-tester, merger and reviewer prompts and the kanban_update tool description ("Replaces the whole Specs section", index.ts) are consistent too, so no change there.
  - Step 6 and the Watcher bullet keep their short "fold ... into the Specs" wording; step 2 carries the full semantics. The #172 wording (Watcher report carries board events only, PM runs the board check) is respected, not rewritten.
  - No code change, per the decision: kanban_update(specs) already replaces the whole Specs section.
  - #167 and #168 not retrofitted: both are done and merged, their decisions are recorded in their Notes and their work matches them.
- Acceptance: criterion 1 holds in the worktree (SKILL.md and agents/developer.md both point answered questions at the Specs, reachable with the documented kanban_update(specs) path). Criterion 2 holds via the skill's explicit fold instruction: the Specs carry the decided acceptance, so a Developer implements without consulting Notes.
- Live-test hint for criterion 2: with the updated skill, have the PM answer a backlog task's openQuestions and confirm the decided acceptance lands in the Specs via kanban_update(specs), openQuestions is cleared, and the task promotes.
- No fixes. State set to to-review.
- Review pass 2 done, no fixes. Verified: the diff is exactly 1 line (SKILL.md step 2's openQuestions bullet) and carries the decided fold semantics; kanban_update (index.ts:91-100) has no notes field, additionalProperties false, specs = "Replaces the whole Specs section", so the bullet's "kanban_update cannot write Notes" and "specs replaces the whole section" are accurate; agents/developer.md untouched and consistent ("The Specs are the contract." line 12, "When an answer reaches the Specs" line 10). Both acceptance criteria hold; no tests reference SKILL.md, so no checkable command applies. Branch sits on post-#172 main (7b39251) and preserves the #172 Watcher wording. The four developer assumptions are stated in # Open questions and match the Decision block; none silent. State set to to-merge.
- Merge done: step 1 merged main (7b39251) into the branch in the worktree, already up to date, no conflicts, no test suites run (clean merge). Step 2 merged fix/171-fold-answers-into-specs into main in the project root, fast-forward to ca621b3, 1 file changed (SKILL.md, 1 line). Root checkout clean after merge.

# Open questions

- Assumption: option 1 (fold into Specs) is the chosen fix, as the Decision block states; the skill's fold-into-Specs wording stays as the contract.
- Assumption: the fix is docs-only in skills/se-llm-team/SKILL.md; no code change and no role-prompt change, because all four role prompts already point answers at the Specs.
- Assumption: #167 and #168 stay as merged; their either/or Specs are not retrofitted because both tasks are done.
- Assumption: step 6 and the Watcher bullet keep their short fold wording; only step 2's bullet gains the full fold semantics.
