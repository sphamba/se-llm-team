---
name: "fix: webui task detail card shows the name twice - drop it from the attributes"
priority: "low"
state: "live-testing"
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

## Review (reviewer)
- Verified commit 44f559a against the Specs. The name row is gone from the #m-attrs innerHTML in openTask (src/webui.ts:489-494). The title (#m-title) still gets t.name. Number, file, priority, state and worktree rows are unchanged.
- The test assertion is exact: the removed literal <div><span>name</span> is absent from the served page, so a re-introduction fails the check. The added test file change is in scope (the Specs scope src/webui.ts for the product change, and project convention extends coverage with the fix).
- Ran in the worktree: node src/webui.test.ts, node src/kanban.test.ts, node src/orchestrator.test.ts. All pass.
- Worktree clean, one commit ahead of main, no uncommitted files. Conflict constraint holds: the change removes one statement inside #m-attrs, so the #56 additions below #m-attrs merge cleanly.
- No fixes needed.
