---
name: "docs: mention openQuestions in the kanban_list and kanban_get tool descriptions"
priority: "low"
state: "done"
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

- Added `openQuestions` to both tool descriptions in `index.ts`:
  - `kanban_list`: now ends "Returns file, num (#NN), name, priority, state, issuer, summary and openQuestions (the task body's # Open questions section, empty when none) per task."
  - `kanban_get`: detail list now includes `openQuestions`, followed by the same "task body's # Open questions section, empty when none" description.
- Wording matches the existing description style; diff is 2 changed string lines, no logic touched (`git diff --stat`: 1 file changed, 2 insertions(+), 2 deletions(-)).
- Verified the claim against `src/kanban.ts`: `Task` and `TaskRef` both carry `openQuestions`, and `parseTask` sets it to `trim(sections["open questions"])`, so it is an empty string when the section is absent.
- Checks: `node src/kanban.test.ts` passes ("all assertions passed"). No typecheck command exists in this repo (no tsconfig.json, no package.json script, no node_modules in the worktree), so it could not be run; the change is a description-string edit only.
- Commit in the worktree: 5b3022a "docs: 000092 mention openQuestions in kanban_list and kanban_get descriptions".

## Live test (commit 5b3022a)

- Result: PASS. No issues found.
- Inspected the worktree `index.ts`. The `kanban_list` description now ends with "... summary and openQuestions (the task body's # Open questions section, empty when none) per task." The `kanban_get` description now lists openQuestions in the detail fields and adds "openQuestions is the task body's # Open questions section, empty when none." Both strings are correct and match the returned data.
- Exercised the tools as a user. `kanban_list` (scope=in-progress) returned every task with an `openQuestions` field. `kanban_get` on `000087_...md` returned the populated open question. `kanban_get` on `000092_...md` (no open questions) returned `openQuestions: ""`, which confirms the "empty when none" wording.
- No behavior change: the diff is two description strings only. `git diff main...HEAD` touches no logic.
- Checks: `node src/kanban.test.ts` passes ("all assertions passed"). `node --check index.ts` passes. No typecheck command exists in this repo, so it was not run (see task #94).
- Note: the running session loads the main checkout, so the live tool descriptions are the old ones until this branch merges. The source check and the data-flow check above cover the change.

# Review notes

- Reviewed commit 5b3022a (`git diff main...HEAD`): index.ts only, 2 changed description strings, no logic touched. Working tree clean.
- Both descriptions name `openQuestions` and describe it as the task body's `# Open questions` section, empty when none. This matches the Specs and the existing wording style.
- Verified against `src/kanban.ts`: `parseTask` sets `openQuestions: trim(sections["open questions"])` (empty string when the section is absent), `listTasks` maps it into every returned task, and `kanban_get` returns `getTask`'s full `Task`. The descriptions match the returned data.
- Checks: `node src/kanban.test.ts` passes ("all assertions passed"). `node --check index.ts` passes. No typecheck command exists in this repo (the global `tsc` is an npx stub without TypeScript installed, no tsconfig.json, no devDependencies), so typecheck is not applicable to this docs-only change.
- No fixes needed. Reviewer set state to `to-live-test`.
