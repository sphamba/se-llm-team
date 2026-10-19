---
name: "refactor: strip orchestration info from role prompts, reviewer to-do bounce"
priority: "medium"
state: "done"
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

No split (splitter, 2026-10-20). Reasons: the pieces do not genuinely parallelize. All prompt edits funnel into one shared pin file (tests/orchestrator/spawn.test.ts, 556 lines) plus tests/orchestrator/split.test.ts, so parallel subtasks either conflict on merge or collapse into one sequential test pass. The prompt files are small (5-28 lines; most changes are one to three lines each), and the exact wording ("never change the task states", the bare AGENTS.md prohibition) must stay identical across files, which cross-subtask agents cannot coordinate. The SPECS Decisions section already records "One combined task". Per-subtask pipeline overhead (one review, one merge, one live test) exceeds the saved time. Durable guidance for future Splitters: before splitting, find the files that tests pin; if all pieces feed one shared test file, the task does not parallelize, split or no split. Also weigh SPECS Decisions that say "one combined task" as settled against a split.

Developer, 2026-10-20 (worktree refactor/289-strip-prompts-reviewer-todo, commit a02480d):

- All six Changes implemented. agents/developer.md and agents/live-tester.md: state ban reworded to "Never change the task states." and the AGENTS.md paragraph reduced to "Never edit AGENTS.md. Put task-specific findings in the task file's # Notes section instead." agents/merger.md and agents/reviewer.md: ban reworded (merger mid-sentence) and the AGENTS.md paragraph reduced to "Never edit, append to or rewrite AGENTS.md; report durable guidance for future agents of your kind in your task's # Notes." agents/splitter.md: final paragraph reduced to "Leave every AGENTS.md file untouched; ..." and the SPECS.md line lost its "(a symlink into the board)" parenthetical.
- The splitter symlink-parenthetical removal is not named in Change 4 but acceptance criterion 3 requires it ("no 'symlink' outside the doctor file"), and the Decisions settle SPECS.md access as one line with no symlink explanation.
- agents/reviewer.md gains step 7: work that does not fulfill the Specs moves the task back to to-do with kanban_set_state (no file argument) with the findings in # Notes, for the developer to redo; the step states it replaces the to-review and to-merge moves. Steps 5/6, the guard paragraph, the stall-kill line and all kept mechanics are unchanged. skills/se-llm-team/SKILL.md now names all three reviewer outcomes.
- Tests: the merger prompt pin in merge.test.ts part AL follows the new wording, and part AL gained pins over all five rendered prompts (ban wording, no doctor narrative, no loading explanation, no .kanban/AGENTS path, shortened splitter paragraph, reviewer to-do outcome). The ban phrase is matched case-insensitively: developer/live-tester carry it sentence-initially ("Never change the task states."), the merger mid-sentence.
- New daemon-path test: promote.test.ts part AA3. A reviewer stub bounces a simple task from reviewing to to-do; the daemon logs the to-do arrival, respawns the developer in the same worktree dir (both spawn lines carry the same cwd), and an untracked-marker snapshot written by the approving reviewer proves the worktree was reused, not re-checked out. The run then completes to done and the doneCleanup "merged <branch> for <task>" log line confirms the same branch carried the task through the merge.
- Red-green order kept: the updated pins failed against the old prompts (merge.test.ts first failure: "the merger never changes the task states"), then the prompt edits turned both files green.
- Scoped suites run, all exit 0: tests/orchestrator/merge.test.ts, promote.test.ts, split.test.ts, spawn.test.ts. The full suite was not run, per task policy.
- Untouched per Constraints: .kanban/AGENTS.<role>.md, agents/doctor.md, src/orchestrator/spawn.ts, all code comments, and the pipeline.ts to-do-arrival code (the daemon path already resets the review streak and respawns from the ensured worktree).
- Test-writing notes for future runs: fixture() creates no .kanban dir (mkdir before writing se-llm-team.json); a bounce-time marker snapshot duplicates the approve-time one (assert the approve-time snapshot only); the doneCleanup "merged" log line fires on the sweep after done, so waitFor the log line instead of asserting at the done transition.

Reviewer, 2026-10-20 (worktree refactor/289-strip-prompts-reviewer-todo, commit a02480d, base main):

- All six Changes hold in a02480d as the Notes describe: developer.md:24,26 and live-tester.md:14,16 carry "Never change the task states." plus the bare "Never edit AGENTS.md." paragraph; merger.md:5,19 rewords mid-sentence and drops the doctor narrative; splitter.md:3,15 loses the symlink parenthetical and ends on the shortened "Leave every AGENTS.md file untouched" paragraph; reviewer.md:20 gains step 7, the to-do bounce with findings in # Notes, beside the kept to-review/to-merge steps, guard paragraph and stall-kill line. Kept mechanics (SPECS.md one-liners, rebase sides, merged-commit rules) are outside the changed hunks, so untouched.
- skills/se-llm-team/SKILL.md:18 names all three reviewer outcomes (acceptance criterion 4).
- Acceptance criterion 3: grep over agents/*.md for "doctor maintains", "symlink", "loads into your context" returns zero matches, stricter than required (doctor.md matches none either).
- Tests: merge.test.ts:433 follows the reworded merger ban and merge.test.ts:448-463 (part AL) pins the stripped wording for developer/merger/live-tester rendered prompts plus reviewer to-do outcome and shortened splitter paragraph; promote.test.ts:151-200 (part AA3) proves the daemon bounce path: reviewing -> to-do -> developer respawn with the same cwd on both spawn lines, approve-time marker snapshot "dev\ndev\n" proving worktree reuse, and the merged-branch log line. Old-pin grep: "never set a task state" has zero matches in tests/ and src/ (no lagging split copy).
- Scoped suites, all exit 0: tests/plugin.test.ts (the coverage-map suite for agents/*.md and skills/), tests/orchestrator/merge.test.ts, tests/orchestrator/promote.test.ts; the AA3 smoke literal greps once in the promote log. Acceptance criterion 2 met. Acceptance criterion 1 names the repo-wide `pnpm test`: not run, per the no-repo-wide-suite policy; the scoped set above is the substitute.
- Constraints hold: the diff touches exactly the 8 listed files, no spawn.ts, no agents/doctor.md, no code comments.
- Verdict: pass, no fixes.

## Live test (2026-10-20)

Live-tester, worktree refactor/289-strip-prompts-reviewer-todo, merged commit a02480d. Run scripts and log: /tmp/289-live (setup.sh, fake-pi.mjs, drive.mjs, check.mjs, run.sh, run.log). The checker prints its own tally.

Lanes run. The change is prompt content plus spawn delivery, so the run used greps on the shipped files and a direct spawn fixture with a fake pi agent.

- Content lane: the five changed prompts and skills/se-llm-team/SKILL.md. The five prompts carry no "doctor" or "symlink" wording and no AGENTS.md loading explanation. developer and live-tester carry "Never change the task states." and "Never edit AGENTS.md.". The merger reads "never change the task states" and keeps the rebase mechanics (--continue, --ours, --theirs, never start a rebase). The splitter carries the shortened "Leave every AGENTS.md file untouched" paragraph and keeps both state moves. The reviewer carries step 7, the to-do bounce with findings in # Notes, beside steps 5 and 6, the re-read guard and the stall-kill line. SKILL.md names all three reviewer outcomes.
- Delivery lane: one fixture root, one task worktree, five real spawnAgent calls (developer, reviewer, live-tester, merger in the worktree, splitter at the root) with a fake pi agent that captures argv, cwd, the -p payload and the cwd symlink targets at startup. Each payload equals renderPrompt(root, role, 30) byte for byte, and no placeholder survives. AGENTS.md links .kanban/AGENTS.<role>.md for the four non-splitter roles and SPECS.md links the task file. The splitter runs at the root with no AGENTS.md link and no AGENTS.splitter.md file. The pi argv keeps the --approve --mode json -p shape.

Final tally: check tally: PASS 79 FAIL 0

Assumptions made while I designed the tests:

- A fixture cannot prove that a live model obeys the new reviewer step 7. The run tested the step as shipped content and as delivered payload. The daemon code that consumes a to-do arrival (pipeline.ts) is outside this diff, so the run did not repeat that daemon path: the task's promote.test.ts part AA3 covers it and the policy excludes unit suites.
- One capture per role, in sequence, because the daemon repoints the cwd AGENTS.md one role at a time. Five parallel spawns race that symlink (fixture learning, not a finding).

No findings. No observed behavior contradicts the task's stated assumptions. No open user or client questions.
