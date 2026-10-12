---
name: "docs: Watcher report path is not backed by the watcher agent definition"
priority: "medium"
state: "live-testing"
worktree: "docs/172-watcher-report-open-questions"
issuer: "#161"
complexity: "simple"
shortName: "watcher-report-open-questions"
---

# Summary
Found in the live test of #161 (merged 3149f65; skills/se-llm-team/SKILL.md only): the new Watcher-section text promises the Watcher's report lists backlog tasks held by unanswered open questions, but the watcher agent definition was not updated and the daemon never gives an in-session watcher its .kanban/AGENTS.watcher.md, so a real watcher report carries only done/created tasks. Either update the Watcher agent so the report really lists those backlog tasks, or reword SKILL.md so the PM runs that board check on every report.

# Specs
Found in the live test of #161 (merged commit 3149f65; the change touched skills/se-llm-team/SKILL.md only).

## Problem

SKILL.md's Watcher section, second bullet, now says: "The report also lists backlog tasks held by unanswered open questions, read from the task files on disk (state backlog with a non-empty openQuestions section), quoting each task's questions." Nothing backs that promise. The Watcher agent definition .pi/agents/watcher.md was not changed and still says: "When it returns board commits, stop and report: which task is done, and which tasks were created. ... keep it under 100 words." The daemon appends .kanban/AGENTS.<role>.md only to the roles it spawns itself (src/orchestrator.ts spawnAgent -> ensureRoleNotes + --append-system-prompt), not to the in-session watcher subagent the PM spawns with the Agent tool, and there is no .kanban/AGENTS.watcher.md (only developer, live-tester, merger, reviewer exist).

## Evidence

- Real watcher subagent spawned exactly as the skill says (subagent_type "watcher") woke on the "kanban: create 000169_live_duration_ticks_every_second.md" commit. Its report listed only the created task and "done: none" - no backlog-held open questions.
- At that moment the live board held #167 (000167_stale_daemon_steals_hub_port.md) and #168 (000168_hub_candidacy_path_based.md) in state backlog with non-empty openQuestions sections, so a working report path would have carried them. The user's decisions on those questions had to come from elsewhere.
- So only the PM's own kanban_list board check (step 1/2) actually surfaces blocked questions; the Watcher half of the #161 change is inert.

## Decision (user, 2026-10-12)
Keep the change SKILL.md-only: reword the Watcher bullet so the PM runs the board check itself on every Watcher report. The Watcher report keeps carrying done/created tasks only; the PM reads the board (kanban_list/kanban_get), quotes each backlog task held by unanswered open questions, asks the user, folds the answers into the Specs and clears the questions. The Watcher agent definition stays as is; no .kanban/AGENTS.watcher.md is added.

## Expected change
skills/se-llm-team/SKILL.md Watcher-section second bullet is reworded from "The report also lists backlog tasks held by unanswered open questions, read from the task files on disk..." to the PM-side board check on every report. Trivial docs change, SKILL.md only.


One of:
1. Update .pi/agents/watcher.md so its report really lists backlog tasks held by unanswered open questions (state backlog with a non-empty openQuestions section), reading the task files on disk and quoting each task's questions; add a .kanban/AGENTS.watcher.md if that is the wanted mechanism, noting that the daemon does not append role notes to in-session watchers, so the watcher definition itself must carry the instruction. Keep the report bounded (the 100-word cap needs revisiting if questions are quoted).
2. Keep the change SKILL.md-only and reword the Watcher bullet so the PM performs that board check itself when a report arrives (the report no longer claims to carry the questions).

Whichever is chosen, SKILL.md and .pi/agents/watcher.md must agree.

## Acceptance

- The watcher definition (or the reworded SKILL.md bullet) states the report/board-check behavior that the #161 live test showed missing.
- A live test spawns a watcher subagent with the Agent tool (subagent_type "watcher") while a backlog task with non-empty openQuestions exists, and shows either that the report quotes that task's questions, or that the PM asks them from its own board check after the report.

# Notes

- Implemented the user decision (option 2, SKILL.md-only). Worktree commit 7b39251, skills/se-llm-team/SKILL.md only, 2 lines changed.
  - Watcher-section second bullet reworded: the report carries board events (done/created) only, and the PM runs the blocked-questions board check itself on every report (kanban_list the backlog, ask each non-empty openQuestions set, fold answers into Specs, clear the section).
  - Step 2's tail pointer updated to match: "on the board check after every Watcher report (see Watcher subagent), or when a board check finds a backlog task that is not being promoted".
  - .pi/agents/watcher.md untouched (report keeps done/created only); no .kanban/AGENTS.watcher.md added, per the decision. SKILL.md and the watcher definition now agree.
- Live-test check hint for acceptance: spawn a watcher subagent (subagent_type "watcher") while a backlog task with a non-empty openQuestions section exists, and confirm the PM (per the reworded SKILL.md) asks those questions from its own kanban_list board check after the report, not from the report.
- Review of 7b39251: the change matches the decision. skills/se-llm-team/SKILL.md only, 2 lines. The Watcher-section second bullet says the report carries board events only, and puts the blocked-questions board check on the PM on every report (kanban_list the backlog, ask each non-empty openQuestions set, fold into Specs, clear the section). The step-2 tail pointer matches.
- Consistency check: .pi/agents/watcher.md is untouched and still reports done/created only, so it agrees with SKILL.md. No .kanban/AGENTS.watcher.md added (only developer, live-tester, merger, reviewer exist). A grep across skills/, docs/, README.md, AGENTS.md and .pi/agents/watcher.md finds no text left that says the Watcher report carries open questions.
- Reviewer confirms the step-2 tail edit is in scope: the old tail ("when the Watcher reports them") pointed at the removed Watcher behavior; keeping it would leave SKILL.md self-contradictory.
- Open questions cleared: all three entries were answered by the user decision in the Specs (Watcher definition stays as is with its 100-word cap; board check on every report through kanban_list; consistency edits inside SKILL.md are the decided scope).
- No fixes. State set to to-merge. Acceptance criterion 1 holds in the worktree; criterion 2 is the live-tester check (hint above).
- Merge: step 1 merged main into the docs branch in the worktree (already up to date, no conflicts, so no test suites were run). Step 2 merged docs/172-watcher-report-open-questions into main in the project root as a fast-forward to 7b39251 (skills/se-llm-team/SKILL.md, 2 lines changed). Merged content verified on main: the Watcher bullet says the report carries board events only and the PM runs the blocked-questions board check itself on every report. State set to to-live-test.
