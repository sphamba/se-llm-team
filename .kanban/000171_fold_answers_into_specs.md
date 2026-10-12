---
name: "fix: answered board questions land in # Notes, not the Specs the skill and Developer contract require"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#161"
complexity: "simple"
shortName: "fold-answers-into-specs"
blockedBy: "#170"
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

## Expected change / decision

One of:
1. Fold answered questions into the task's Specs as the skill writes: the Specs' ambiguous acceptance is replaced by the decided acceptance (kanban_update replaces the whole Specs section), and the skill's wording stays as the contract. Notes may still carry the decision as provenance.
2. Reword the skill (step 2's openQuestions bullet and the Watcher-section follow-up) and the Developer prompt (agents/developer.md "The Specs are the contract.") so a "## Decision (user, ...)" block in # Notes is an explicit, honoured decision record - and say how the PM writes it, since kanban_update cannot.

Whichever is chosen, skill, Developer prompt and observed practice must agree.

## Acceptance

- SKILL.md and agents/developer.md state one consistent place for answered questions, and that place is reachable with the documented tool path (or the tool path gains the capability).
- The task's Specs contain only acceptance criteria that a Developer can implement without consulting Notes, or the prompt explicitly instructs Developers to read and follow the Decision block in Notes.

## Blocker note

Blocked by #170 because both tasks rewrite the same SKILL.md Watcher-section bullet (the "fold the answers into the tasks' Specs" sentence lives there); whichever lands first sets the wording the other must respect.

# Notes

# Open questions
Should answered board questions be folded into the task's Specs, replacing the ambiguous acceptance, as the skill says, or is recording the choice in # Notes acceptable? If Notes is accepted, should the skill and the Developer prompt say so explicitly?
