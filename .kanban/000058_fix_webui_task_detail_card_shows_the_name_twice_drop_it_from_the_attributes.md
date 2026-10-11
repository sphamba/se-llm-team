---
name: "fix: webui task detail card shows the name twice - drop it from the attributes"
priority: "low"
state: "reviewing"
worktree: "fix/58-webui-task-detail"
---

# Summary
The task detail card renders the name in the attributes block (#m-attrs) and again as the card title. Remove the name row from #m-attrs; the title already shows it.

# Specs
Changes (src/webui.ts only):
- In the openTask modal, drop the name attribute from the #m-attrs rendering - the modal title (card title) already shows the task name.
- Keep the remaining attributes (state, priority, worktree) as they are.

Acceptance:
- The detail card shows the name once, as the title.
- Remaining attributes unchanged.
- Existing tests pass.

Constraints:
- Conflicts are minor and merger-resolvable: this removes a row inside #m-attrs while #56 adds past-agent buttons below #m-attrs - different statements of the same modal, sequential two-way merge.

# Notes
- Removed the name row from the #m-attrs rendering in src/webui.ts (openTask). The title still shows the name. Number, file, priority, state and worktree rows are unchanged.
- Added one regression assertion in src/webui.test.ts: the served page does not contain the name attribute row.
- Checks pass: node src/webui.test.ts, node src/kanban.test.ts, node src/orchestrator.test.ts.
- Commit 44f559a in worktree fix/58-webui-task-detail. Two files changed, one line removed and one line added.
