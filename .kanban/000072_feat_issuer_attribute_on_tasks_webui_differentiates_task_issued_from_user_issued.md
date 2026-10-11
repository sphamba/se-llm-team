---
name: "feat: issuer attribute on tasks; webui differentiates task-issued from user-issued"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Tasks gain an issuer attribute: "user" when the user requested the task, or "#<num>" when it was created after live-testing of task #<num>. The webui displays the issuer and makes task-issued tasks visually quieter while user-issued tasks stay visually more prominent.

# Specs
Track who issued each kanban task and reflect it in the webui (user feedback). User-issued tasks are somewhat more important visually; tasks issued by another task (created after its live-testing) are displayed visually quieter.

Facts:
- Task files are .kanban/*.md with YAML frontmatter (name, priority, state, worktree) plus # Summary, # Specs, # Notes sections. Frontmatter parse/serialize and createTask live in src/kanban.ts; the kanban_create/kanban_update/kanban_list/kanban_get tools live in src/index.ts.
- Live-test issues flow through the live-tester agent's task notes; follow-up tasks are then created by the project manager with kanban_create (see task 000034 notes: "Issues found (passed to the PM for new tasks)"). So the issuer is known at kanban_create time.
- Webui: task cards are rendered from GET /api/tasks; the detail card has an #m-attrs block for attributes. Active lane 000070 (reviewing) rewrites src/webui.ts and src/webui.test.ts (agent log pane only).
- Existing task files have no issuer attribute.

Changes:
1. Frontmatter: new optional "issuer" attribute. Value "user" when the user requested the task, or "#<num>" when the task was created after live-testing of task #<num>, for example issuer: "#42" (store as a quoted YAML string; the serializer must quote it, # starts a YAML comment otherwise).
2. kanban_create gains an optional issuer parameter accepting "user" or "#<num>", default "user". createTask writes it into the frontmatter. The issuer is set at creation only and never changed afterwards.
3. kanban_list and kanban_get include issuer in their output.
4. Webui: task cards and the detail card show the issuer. Tasks issued by another task (issuer "#<num>") are visually quieter (for example dimmed text or a small #<num> badge); user-issued tasks are visually more prominent (for example an accent left border or full-contrast styling). The differentiation must be subtle but noticeable and consistent in both light and dark themes; exact styling is the developer's choice within these constraints.
5. Absent issuer (all existing task files) is treated as "user". Existing files are never rewritten to add the attribute.
6. Tests: src/kanban.test.ts (createTask writes issuer "user" by default and "#42" when passed; frontmatter round-trips the quoted value), src/webui.test.ts (issuer renders on cards and the detail card; the differentiation classes exist), extend other tests as needed. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- kanban_create with issuer "#42" produces a task whose frontmatter, kanban_get, kanban_list and /api/tasks all carry issuer "#42"; without it, "user".
- The webui shows the issuer and visually differentiates task-issued from user-issued tasks in both themes.
- Existing task files are untouched.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/kanban.ts, src/index.ts, src/webui.ts, src/kanban.test.ts, src/webui.test.ts.
- HOLD behind 000070 (reviewing): both rewrite src/webui.ts. Promote only after 000070 is done and merged, and rebase line numbers on the merged code.
- Note: 000047 and 000058 (backlog) also touch src/webui.ts, and 000064 touches src/index.ts/src/kanban.ts - promote them after this task merges, in priority order.

# Notes
