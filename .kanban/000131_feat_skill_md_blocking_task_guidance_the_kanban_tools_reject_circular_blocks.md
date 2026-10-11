---
name: "feat: SKILL.md blocking-task guidance; the kanban tools reject circular blocks"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
When creating a task, the PM must indicate which other tasks block it - including tasks still in the backlog - and re-chain the backlog queue. The tools that set blockedBy must reject a direct cycle (A blocks B together with B blocks A).

# Specs
# 1. SKILL.md: blocking-task guidance (skills/se-llm-team/SKILL.md)

Step 4 (task creation) gains: for every kanban_create, indicate which other tasks block the new one via blockedBy (comma-joined task refs like "#42, #43"). A blocker can be in any state, INCLUDING still in the backlog - a backlog task blocks the same as an in-flight one; blockedBy only gates promotion until every blocker reaches done.

Also: when the new task lands in a non-empty backlog, update the other backlog tasks that become blocked by it. The backlog queue chains in promotion order (priority rank, then file number): the new task inserts at its priority position, lists the task before it (plus any in-flight lanes it shares files with), and the backlog task that now follows it in the queue gains the new task as a blocker ref with kanban_update. Keep the existing step 6 wording (never promote a task whose blockers are not done; remove a done blocker's ref with kanban_update).

# 2. Cycle rejection (src/kanban.ts, src/kanban.test.ts, index.ts if needed)

kanban_create and kanban_update set blockedBy (index.ts ~:72, ~:99). Setting "B blocks A" when A already blocks B (or creating a task blocked by a task it blocks) must be rejected with a clear error, e.g. "cannot set blockedBy: #B is already blocked by #A - A blocks B and B blocks A is not allowed".

- Implement the check in the shared write path (src/kanban.ts, the updateTask/attrs path both tools use): parse the new blockedBy refs; when one of the referenced tasks' blockedBy lists the modified task (a direct 2-cycle), reject before the write.
- A one-directional pair stays allowed (A blocks B alone); clearing the list (empty string) stays allowed; self-reference (a task blocking itself) rejects too.
- Longer chains (A -> B -> C) stay allowed - only the direct 2-cycle rejects (the user's case).
- src/kanban.test.ts: the 2-cycle rejects with the message, the one-directional pair passes, clearing passes, self-reference rejects.

# Complexity

moderate. Files: skills/se-llm-team/SKILL.md, src/kanban.ts, src/kanban.test.ts, index.ts (error wording only if needed).

# Notes
