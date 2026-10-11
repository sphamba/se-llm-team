---
name: "feat: SKILL.md blocking-task guidance; the kanban tools reject circular blocks"
priority: "medium"
state: "reviewing"
worktree: "feat/131-skill-md-blocking"
complexity: "moderate"
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
- Implemented in the worktree, commit e6045ed on feat/131-skill-md-blocking.
- src/kanban.ts: added blockedNums ("#42, #43" -> [42, 43], deduped, malformed parts ignored) and assertNoBlockCycle (direct 2-cycle and self-block reject; one-directional pairs, longer chains, stale refs to missing tasks and clearing stay allowed). Wired into updateTask (when patch.blockedBy is set, checked before updateAttrs) and into createTask inside the number-allocation loop, since a new task's number is only known there: a stale ref to the next number (a deleted task's number) or the create's own next number cannot form a cycle either. index.ts needed no change: both tools call these paths and the thrown error propagates to the caller as the tool error.
- src/kanban.test.ts: new cycle-guard section on its own tmp root covers the 2-cycle reject with the exact message, the rejected write leaving the file unchanged, self-reference reject, clearing, the a->b->c chain, and both create-path rejections (stale-ref 2-cycle, self-number).
- skills/se-llm-team/SKILL.md step 4: appended the blockedBy guidance - every kanban_create sets blockedBy with blockers in any state (backlog included), blockedBy only gates promotion (step 6); a new task in a non-empty backlog re-chains the queue in promotion order (priority rank, then file number): it lists the task before it plus shared in-flight lanes, and the backlog task that now follows it gains the new task as a blocker ref via kanban_update. Step 6 wording untouched.
- Verified: node src/kanban.test.ts, node src/orchestrator.test.ts and node index.test.ts all pass.
- Review pass 1 (commit 7ca3a66): found and fixed one gap - the guard's blockedNums required the leading "#" (regex ^#(\d+)$) while the promotion failsafe (src/orchestrator.ts blockedByUndone) also honors refs without it ("42"). A wedge written as blockedBy: "42" slipped past the guard yet still held tasks in promotion. blockedNums now parses with or without the leading # and ignores num <= 0, matching the failsafe's parse exactly; test added for the no-# 2-cycle reject. All three test suites pass after the fix.
- Review verification of the spec checklist: SKILL.md step 4 carries the full blockedBy guidance (any-state blockers, backlog included, promotion gating, queue re-chain in priority-then-file order with the follower gaining the new ref) and step 6 wording is untouched; the guard lives in the shared write path (updateTask before updateAttrs, createTask inside the number-allocation loop before the write), one-directional pairs, clearing, longer chains and stale refs stay allowed, both create-path rejections are covered; index.ts needs no change since the thrown error propagates as the tool error.
- Correction to the implementer note above: the sentence "a stale ref to the next number (a deleted task's number) or the create's own next number cannot form a cycle either" reads backwards. Both cases DO reject - that is exactly what the two create-path tests assert, and the in-code comment states it correctly. A stale ref to any other number cannot form a cycle and stays allowed.
