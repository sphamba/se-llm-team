---
name: "fix: webui task detail card shows the name twice - drop it from the attributes"
priority: "low"
state: "backlog"
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
