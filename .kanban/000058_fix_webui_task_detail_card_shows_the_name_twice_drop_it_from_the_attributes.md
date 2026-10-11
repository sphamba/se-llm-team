---
name: "fix: webui task detail card shows the name twice - drop it from the attributes"
priority: "low"
state: "done"
worktree: ""
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

## Live test (live-tester)
- Ran the worktree UI from /home/phamba/repos/se-llm-team/.worktrees/fix/58-webui-task-detail as a user. Started src/webui.ts from the worktree on 127.0.0.1:4399 against the shared .kanban board, then drove it with headless Chrome (Playwright).
- Opened 6 task cards across the columns, task #58 included. In every card the title shows the task name once, and #m-attrs shows only number, file, priority, state and worktree. The name row is absent. The attribute text does not repeat the title. The task body renders.
- Before and after check: the main daemon on port 4242 still shows the name row in #m-attrs for task #58. The worktree page does not. The fix works.
- The agent buttons below #m-attrs still work. Task #58 shows the past Developer and Reviewer buttons, the live Live-tester button, and the log pane streams the current log.
- Tests in the worktree: node src/webui.test.ts and node src/kanban.test.ts pass. node src/orchestrator.test.ts passed on two runs. A first run timed out in the push-warning part while another live-test session ran the same suite concurrently in worktree fix/68. That is environmental and unrelated to this diff.
- Evidence: /tmp/live-58-modal.png, /tmp/live-58-board.png, /tmp/live-worktree-new.png, /tmp/live-main-old.png.
- No issues found. Accepted.
