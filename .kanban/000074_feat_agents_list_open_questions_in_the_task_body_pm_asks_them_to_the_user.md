---
name: "feat: agents list open questions in the task body; PM asks them to the user"
priority: "medium"
state: "reviewing"
worktree: "feat/74-agents-list-open"
---

# Summary
All four agent prompts instruct the agent to list user/client clarification questions in a new "# Open questions" section after # Notes. The kanban tools carry the section (parseTask field, kanban_create parameter). The PM asks backlog open questions to the user, folds answers into the Specs, and creates live-testing follow-up tasks with the questions in their body.

# Specs
Agents list open (user/client clarification) questions in a new section of the kanban task body; the PM asks them to the user and folds the answers into the Specs. Facts verified at HEAD 401d398.

Facts:
- All four agent prompts (agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md) share the same skeleton: intro + Task vars, a "Task file edits are the exception: Notes appends and state changes must always edit the file at {{TASK_FILE}}" paragraph, numbered steps, a "re-read the task with kanban_get first" transition rule, and a dead-agent line. No role mentions asking the user/client questions.
- live-tester.md step 5 (follow-up-task path): "When you found issues, report them to a Project manager subagent so it creates new tasks... create one kanban task per finding with the kanban_create tool. Never create a task that duplicates an existing not-done task."
- parseTask (src/kanban.ts:82-102) splits the body on /^# (.+)$/, keys sections by lowercased header, returns only summary/specs/notes - an extra "# Open questions" section parses but is dropped from the Task object. replaceSections (190-221) rewrites only the given sections, byte-for-byte elsewhere - a section after # Notes survives. appendNote (246-252) inserts right after the # Notes heading. updateTask (226-237) patches only summary/specs. setState goes through replaceSections.
- createTask (src/kanban.ts:261-264) writes a fixed body: "# Summary\n${summary}\n\n# Specs\n${specs}\n\n# Notes\n" - extra sections cannot be created at create time.
- The kanban_create tool lives in src/index.ts.
- Active lane: #38 is live-testing (orchestrator.ts/hub.ts only). No lane touches agents/*.md, skills/se-llm-team/SKILL.md, src/kanban.ts, or src/index.ts.

Changes:
1. All four prompts: instruct the agent to list its open questions in a new "# Open questions" section of the task body, placed after the # Notes section. Only clarification questions for the user/client belong there - never technical questions whose answer is available in the codebase, the docs, or online. When a question is answered (the answer reaches the Specs), remove it from the section; an empty or missing section is the normal state. Appending to and removing from this section is part of the "Task file edits are the exception" rule (edit the file at {{TASK_FILE}}).
2. src/kanban.ts parseTask: carry the open-questions section into the Task object as a new field (for example openQuestions: string, "" when absent) so the kanban tools and the auto-scheduler can read it.
3. src/kanban.ts createTask: optional openQuestions parameter appended to the fixed body as "# Open questions\n${openQuestions}\n" after the # Notes heading; absent = current body exactly.
4. src/index.ts kanban_create: expose the optional openQuestions parameter (same shape as the specs parameter, default absent).
5. skills/se-llm-team/SKILL.md session flow: (a) when the PM sees backlog tasks with open questions, it asks them to the user in structured question dialogs (step-2 interview style), folds the answers into the task's Specs, and removes the answered questions from the section; (b) the live-testing follow-up flow (from live-tester reports) creates the new task(s) with the open questions in their body.
6. Tests: src/kanban.test.ts - parseTask carries openQuestions (absent, empty, and with content); createTask writes the section when given and not otherwise; the section survives updateTask/appendNote/replaceSections round-trips. Extend other tests as needed. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- An agent appending "# Open questions" after # Notes survives state changes, note appends, and reconcile; the kanban tools carry the field.
- kanban_create with openQuestions produces the section; without it, the body is byte-identical to today.
- All four prompts carry the user/client-only rule.
- The SKILL.md instructs the PM to ask backlog open questions and to carry them into live-testing follow-up tasks.
- Typecheck and the full test suite pass.

Constraints:
- Files: agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, skills/se-llm-team/SKILL.md, src/kanban.ts, src/index.ts, src/kanban.test.ts.
- No webui changes (displaying open questions in the webui was not requested; add later on request).

# Notes

- [2026-10-11 11:00] All four agent prompts (developer, reviewer, live-tester, merger) now instruct the agent to list user/client clarification questions in a # Open questions section after # Notes, with the user/client-only rule and answer-removal behavior; open-questions edits joined the task-file-edit exception in the three worktree prompts.
- [2026-10-11 11:00] live-tester step 5: the follow-up flow now tells the PM subagent to pass open questions as the kanban_create openQuestions parameter, so they land in the follow-up task body.
- [2026-10-11 11:00] src/kanban.ts: parseTask carries the section as Task.openQuestions ("" when absent); createTask takes optional openQuestions appended as "# Open questions\n..." after # Notes (absent keeps the body byte-identical); updateTask accepts an openQuestions patch that replaces the section (appends it at the end when missing, empty string clears it).
- [2026-10-11 11:00] src/index.ts: kanban_create and kanban_update expose the optional openQuestions parameter; kanban_get description mentions open questions.
- [2026-10-11 11:00] skills/se-llm-team/SKILL.md: board section documents the optional # Open questions section and the openQuestions field; step 3 creates follow-up tasks with openQuestions; step 6 asks backlog open questions to the user (step-2 interview style), folds answers into the Specs with kanban_update and rewrites the section before promoting.
- [2026-10-11 11:00] src/kanban.test.ts: parseTask carries openQuestions (absent, empty, with content); createTask writes the section when given and keeps the body byte-identical when not; the section survives setState/appendNote/updateTask summary-specs patches; updateTask replaces, appends and clears the section.
- [2026-10-11 11:00] Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts. Typecheck: no new type errors vs the pre-change baseline (the two strict-mode complaints in replaceSections/createTask priority are pre-existing at HEAD 401d398; the repo ships no tsconfig or node_modules, node type-stripping runs the suites). No webui changes (the /api/tasks payload already carries the raw body).