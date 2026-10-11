---
name: "docs: mention openQuestions in the kanban_list and kanban_get tool descriptions"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
The kanban_list and kanban_get tool descriptions in index.ts do not mention the openQuestions field that both tools return since task #74. The PM flow works because the SKILL names the field, but the descriptions are stale. Mention openQuestions in both descriptions.

# Specs
## Where

`index.ts` (repo root) — the `kanban_list` and `kanban_get` tool definitions. Both tools already return the `openQuestions` field parsed from the task body's `# Open questions` section (added by task #74: `parseTask` field, `kanban_create` parameter), but neither tool description mentions it.

## Change (docs only)

- In the `kanban_list` tool description: mention that each returned task carries `openQuestions` (the task body's `# Open questions` section, empty when none).
- In the `kanban_get` tool description: same, mention that the returned task detail includes `openQuestions`.

Wording should match the existing description style; no other description text needs rewriting.

## Acceptance

- Both tool descriptions mention `openQuestions` and correctly describe it as the task's open questions (empty when none).
- No behavior changes: no code logic touched, no new fields, no changed return shapes — description strings only.
- `node src/kanban.test.ts` stays green and typecheck passes (docs-only change; no new tests required).

## Context

Found in the live test of #74 (FINDING 1, actionable, low priority): the PM flow still works because `skills/se-llm-team/SKILL.md` names the field and the returned JSON carries it, but the tool descriptions are now stale. Related but distinct: #75 (orchestrator auto-schedule skips tasks with unanswered open questions).

# Notes
