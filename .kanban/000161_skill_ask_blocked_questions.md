---
name: "docs: SKILL.md asks blocked tasks' open questions in chat"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "trivial"
shortName: "skill-ask-blocked-questions"
---

# Summary
Fix the repo's SKILL.md and its Watcher section so open questions that block backlog tasks reach the user in the chat: the Watcher reports which backlog tasks are held by unanswered openQuestions, and the PM asks them to the user in the chat right away instead of discovering them later.

# Specs
Current state: SKILL.md step 2 (line 30) already tells the PM to put non-empty openQuestions sets to the user in structured dialogs, but only as a general board check; the Watcher section (lines 42-46) makes the Watcher report done tasks and created tasks only, so questions that block a backlog task surface late (only when the PM notices a task is not being promoted).

Changes (skills/se-llm-team/SKILL.md only):
- The Watcher section's report item (line 45) gains: the Watcher's report also lists backlog tasks held by unanswered open questions, read from the task files on disk (state backlog with a non-empty openQuestions section), quoting each task's questions.
- The same item gains the follow-up: when a report carries such tasks, the PM puts their questions to the user in the chat immediately (step 2's structured dialogs), folds the answers into the tasks' Specs with kanban_update, and clears the sections (openQuestions: "") so the orchestrator promotes them.
- Step 2 (line 30) gains one sentence: ask blocked tasks' questions at the earliest opportunity - when the Watcher reports them, or when a board check finds a backlog task that is not being promoted with a non-empty openQuestions section.
- Keep all existing rules intact (watcher spawn discipline, single watcher, step numbering, promotion gates wording).

Tests: no code tests; a docs-only change.

# Notes
Did the docs-only change in worktree docs/161-skill-ask-blocked-questions, commit 3149f65. skills/se-llm-team/SKILL.md only:
- Step 2 openQuestions bullet (line 30) gained one sentence: ask blocked tasks' questions at the earliest opportunity, when the Watcher reports them or when a board check finds a backlog task that is not being promoted with a non-empty openQuestions section.
- Watcher report item (line 45) gained the report content (backlog tasks held by unanswered open questions, read from task files on disk, each task's questions quoted) and the PM follow-up (ask in chat, fold answers into the Specs with kanban_update, clear the sections).
Kept all rules intact: watcher spawn discipline, single watcher, step numbering, promotion gates wording. Left .pi/agents/watcher.md unchanged (SKILL.md-only scope). No code tests: docs-only change.
Merge: step 1 merged main into docs/161-skill-ask-blocked-questions in the worktree (already up to date, no conflicts, no test run needed). Step 2 merged docs/161-skill-ask-blocked-questions into main in the project root (fast-forward fa7f502..3149f65, no conflicts). Merged commit 3149f65 is on main.

## Live test (2026-10-12, merged commit 3149f65, project root)

Docs-only change; no unit suite run. Tested as a user through the real interfaces.

What passed:
- Real skill load: `pi -p -nt --no-session "/skill:se-llm-team ..."` printed the new step 2 sentence and the new Watcher bullet verbatim, so a session that invokes the skill receives the merged text.
- The target scenario ran for real on the live board while this task was in live testing: #167 and #168 were backlog with non-empty openQuestions when the live test started (kanban_list, 22:21); at 22:21:32 user decisions were recorded and the sections cleared, and the orchestrator promoted both to doing within about a minute. Blocked questions do reach resolution and promotion once the sections are cleared.
- PM-side board check: kanban_list (the PM's step 1 tool) for backlog returned #167/#168 with their questions, so the data needed to ask them in chat is available to the PM without the Watcher. A read-only PM dry run following the skill correctly reported "no questions" once the board held none, i.e. it did not invent blocked tasks.

Findings (filed as tasks #172, #171):
1. #172 (docs): the Watcher report path is not backed by the Watcher agent definition. `.pi/agents/watcher.md` is unchanged (report done/created tasks only); the daemon appends `.kanban/AGENTS.<role>.md` only to the roles it spawns itself (src/orchestrator.ts spawnAgent), not to the in-session watcher the PM spawns with the Agent tool, and no `.kanban/AGENTS.watcher.md` exists. Evidence: a real Watcher (subagent_type "watcher", spawned as the skill says) woke on the `kanban: create 000170...` commit, called orchestrator_wait then kanban_get of that new task, and its report listed only that created task (with its question, because the task body is the question) and never scanned the backlog. The clause "lists backlog tasks held by unanswered open questions, read from the task files on disk" is therefore not implemented; a previously created held task (for example #167/#168 before they were resolved) would not appear in a Watcher report.
2. #171 (fix): the observed fold target contradicts the skill. The #167/#168 answers were recorded in a `## Decision (user, 2026-10-12)` block inside # Notes, while the # Specs kept the original unresolved either/or acceptance. kanban_update rejects a `notes` field (additionalProperties: false in index.ts), so that text came from a direct file edit, not the documented kanban_update path, and agents/developer.md says "The Specs are the contract", so a decision living only in Notes may not bind the Developer. Caveat: the PM session that made the edit started before 3149f65, so it may have had the older skill text; the observation is about the real board's end state, not proof that the new sentence caused it.

Assumptions made while designing the tests:
- "The Watcher reports them" is testable only with a real `kanban: create`/`kanban: done` commit as the trigger; a scratch board would need its own daemon and would not exercise the in-session watcher.
- A read-only subagent that reads the skill file is an acceptable stand-in for the PM session's board-check path; the real skill-loading interface was verified separately with the pi CLI.
- I did not create a scratch blocked task on the real board; the two findings were filed as real tasks (#172, #171, both held in backlog by their openQuestions), which also served as the watcher fixture.
- Out-of-scope flows: none tested.

# Open questions
