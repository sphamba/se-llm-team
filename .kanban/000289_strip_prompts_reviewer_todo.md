---
name: "refactor: strip orchestration info from role prompts, reviewer to-do bounce"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "strip-prompts-reviewer-todo"
---

# Summary
Cut tokens and cost by stripping orchestration-process knowledge (pipeline narrative, symlink explanations, other-agent and daemon behavior) from the static role prompts in agents/, keeping only facts-driven exceptions. The splitter and reviewer keep their state knowledge. The "doctor maintains this file" sentences become a bare never-edit-AGENTS.md prohibition, the state bans are reworded to "never change the task states", and the reviewer gains a third outcome: a task that does not fulfill the Specs goes back to to-do for the developer to redo. Notes files and doctor.md are untouched.

# Specs
## Need

Cut tokens and cost: the static role prompts in agents/ carry orchestration-process knowledge (pipeline narrative, symlinks, other agents, daemon behavior) that the roles do not need. Strip it, with facts-driven exceptions: only the splitter and reviewer set task states, so only they keep state knowledge. In the same task, the reviewer gains a third outcome: a task that does not fulfill the Specs goes back to to-do for the developer to redo.

The user will run an A/B live comparison of old vs new prompts on another repo; it is not an acceptance criterion here.

## Facts (from code inspection, 2026-10-19)

- Prompts are static files agents/<role>.md rendered per spawn by renderPrompt (src/orchestrator/spawn.ts:16-23), substitutions {{ROOT}} (reviewer only) and {{logStallMinutes}}.
- Each spawn creates cwd symlinks: SPECS.md -> .kanban/<task file>, AGENTS.md -> .kanban/AGENTS.<role>.md (spawn.ts:48-57). The pi coding agent auto-loads cwd AGENTS.md into context; spawn.ts:140-160 appends the real root AGENTS.md as system prompt because the cwd AGENTS.md is the notes symlink.
- The splitter runs at repo root and gets no notes file (spawn.ts:52-56).
- State setters: only splitter (subtasks -> to-do, parent -> backlog, no-split: touch nothing) and reviewer (fixes -> to-review, no fixes -> to-merge). developer/merger/live-tester prompts forbid state setting; the doctor never touches the board.
- The daemon already handles a to-do arrival: src/orchestrator/pipeline.ts:358-364 resets the review streak when a task lands back in to-do. The developer start path works from the task's ensured worktree.
- Tests pin rendered-prompt wording with exact strings (repo convention, see src/orchestrator.test.ts and tests/webui). pnpm test is the check command.
- skills/se-llm-team/SKILL.md states the reviewer decision as: approve sets to-merge, fixes go back to to-review.

## Decisions (interview, settled)

- Goal: cut tokens and cost, not confusion (board evidence: early confusion incidents #000004/#000188 are fixed; today's cost is measured thinking overhead, e.g. .kanban/.logs/analysis-285-reviewer-pain-points.md).
- Full strip of orchestration-process knowledge from the static prompts; exceptions are facts-driven (splitter, reviewer keep their state knowledge).
- SPECS.md access: keep one line per role, "read SPECS.md in your cwd, it is your task file". No symlink explanation.
- AGENTS.md: no loading or symlink explanation anywhere. A bare prohibition: never edit it. The doctor-maintains sentence is deleted (replaced by that prohibition).
- Stall-kill line stays in developer, reviewer, live-tester.
- The "never set task states" bans in developer/merger/live-tester stay, reworded to "never change the task states", so they also cover direct frontmatter edits through SPECS.md.
- Reviewer outcomes after this task: fixes made -> to-review; no fixes (clean) -> to-merge; does not fulfill the Specs -> to-do, findings in # Notes, for the developer to redo. The reviewer keeps fixing minor mistakes itself.
- Notes files (.kanban/AGENTS.<role>.md) are NOT touched. doctor.md is NOT touched (its prompt is its job). spawn.ts and code comments are NOT touched.
- One combined task.

## Changes

1. agents/developer.md: delete the doctor-maintains sentence; keep a bare "never edit AGENTS.md" prohibition; reword the state ban to "never change the task states"; keep the SPECS.md one-liner, worktree isolation, SPECS.md main-checkout exception, stall-kill line.
2. agents/merger.md: reword "you never set a task state" to "never change the task states"; delete any doctor/symlink narrative if present; keep the rebase mechanics (orchestrator did the rebase, never start one yourself, --ours/--theirs sides, worktree-only rule, scoped test rule).
3. agents/live-tester.md: delete the doctor-maintains sentence; bare "never edit AGENTS.md" prohibition; reword the state ban to "never change the task states"; keep the SPECS.md one-liner, merged-commit mechanics, never-unit-suites rule, findings phrasing, stall-kill line.
4. agents/splitter.md: shrink the final AGENTS.md paragraph to "leave every AGENTS.md file untouched; report durable guidance for future agents of your kind in your task's # Notes"; drop the guidance-loading explanation and the "no per-role notes file and none will ever appear" sentence; keep all state moves and the pipeline-overhead rationale.
5. agents/reviewer.md: shrink the AGENTS.md sentence the same way as the other prompts (bare never-edit prohibition, no doctor, no symlink path); add the third outcome step: if the work does not fulfill the Specs, move the task back to to-do with kanban_set_state (no file argument) with the findings in # Notes; keep the fixes -> to-review and clean -> to-merge steps, the scoped-test rules, the base-branch lookup, the re-read-before-transition guard, the stall-kill line.
6. skills/se-llm-team/SKILL.md: update the reviewer-decision sentence to include the to-do bounce (approve sets to-merge, fixes go back to to-review, a Specs violation sends the task back to to-do).
7. Tests: update every exact-string pin on the changed wording (rendered-prompt asserts in src/orchestrator.test.ts and any other suite that pins agents/*.md text). Add a daemon-path test: reviewer sets a reviewing task back to to-do, the daemon respawns the developer and reuses the existing worktree and branch (pipeline.ts to-do-arrival path).

## Constraints

- Do not touch .kanban/AGENTS.<role>.md, agents/doctor.md, src/orchestrator/spawn.ts, or any code comment.
- Do not remove: the SPECS.md one-liners, the stall-kill lines, the state bans (new wording), the splitter's and reviewer's state rules, role-local mechanics, the "report durable guidance in # Notes" lines.
- Keep every removed-sentence replacement within the existing prompt structure and step numbering consistent.

## Acceptance criteria

1. `pnpm test` passes, with updated pins proving: the doctor-maintains sentence is gone from developer/reviewer/live-tester prompts; developer/merger/live-tester prompts carry "never change the task states"; the reviewer prompt carries the to-do outcome; the splitter AGENTS.md paragraph is the shortened form.
2. The new daemon-path test (reviewing -> to-do -> developer respawn on the existing worktree) passes in the orchestrator suite.
3. A grep over agents/*.md shows no "doctor maintains", no "symlink" outside the doctor file, and no AGENTS.md loading explanation in developer/merger/live-tester/splitter/reviewer prompts.
4. skills/se-llm-team/SKILL.md names all three reviewer outcomes.

# Notes
