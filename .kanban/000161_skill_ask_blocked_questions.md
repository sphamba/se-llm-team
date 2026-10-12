---
name: "docs: SKILL.md asks blocked tasks' open questions in chat"
priority: "medium"
state: "backlog"
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
