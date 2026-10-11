---
name: "fix: dead-agent give-up log fires only on exact equality - a second death streak stays silent"
priority: "low"
state: "to-merge"
worktree: "fix/109-dead-agent-give"
issuer: "#65"
---

# Summary
The dead-agent counter in the orchestrator poll loop logs its one-time "giving up" message only when the counter first crosses RESPAWN_CAP + 1. The counter is never reset, so a task that goes through a second death streak (after user intervention) gets a silent give-up: the poll keeps skipping respawn and transition without any message.

# Specs
Found during the review of task 000065 (push-warning counter). Evidence:

- src/orchestrator.ts, poll loop (~lines 828-831): `if (bumpCounter(root, `${slug}.dead`) > RESPAWN_CAP) { if (readCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1) log("... giving up ..."); continue; }` - the give-up message fires only on the first poll past the cap.
- The `${slug}.dead` counter is never reset anywhere (grep confirms no reset or unlink), so after the first give-up for a task, a later death streak (user fixes the agent, respawns the task, agent dies again) bumps the counter past RESPAWN_CAP+1 and the give-up is silent: the poll keeps skipping respawn and transition with no message.
- Same class of bug as 000065: one-shot log gated on exact equality against a counter that only grows.

Suggested fix: keep a once-per-streak marker (like the push-warned marker from 000065), or reset the dead counter when the task successfully respawns, and log the give-up on every streak that crosses the cap.

Priority low, type fix.

# Notes

Implemented in worktree fix/109-dead-agent-give (commit 6127996):

- src/orchestrator.ts, poll loop: reset the `${slug}.dead` counter to 0 when the poll sees the agent pid alive (first alive sighting ends the death streak). Same reset-on-success pattern as the push-failures counter from task 000065. The give-up log keeps its `=== RESPAWN_CAP + 1` equality gate, which now fires once per streak.
- src/orchestrator.test.ts, part B: after the first give-up, inject a live pid into the task's pidfile, wait for the counter file to read 0 (proves the reset), remove the pidfile, then wait for a second "giving up" line and assert exactly two occur.
- `node src/orchestrator.test.ts` passes fully, including the new second-streak assertions.
- Not resetting on a poll-driven respawn (setState in the poll): that would zero the counter on each of the 5 in-streak respawns and the cap would never fire.

Review (no fixes needed):
- Verified the reset writes "0" only when the counter is > 0 (no redundant write per poll), and that the reset key stays `${slug}.dead` even in the merging state where the observed pid is the merger's - consistent with the bump key.
- Verified `agentPid` returns 0 for a missing pidfile, so the test's pidfile removal cleanly starts the second streak.
- Verified the test's `/giving up/g` count is unambiguous: that phrase appears only in the dead-agent give-up log. The exact-2 assertion also proves no over-logging within a streak.
- Re-ran `node src/orchestrator.test.ts` in the worktree: all parts pass, including the new second-streak assertions.

## Live test (2026-10-11)

Result: PASS. No issues found.

What was exercised (worktree fix/109-dead-agent-give, commit 6127996):

- `node src/orchestrator.test.ts`: exit 0, all smoke parts pass, including the new second-streak assertions in part B.
- `node src/kanban.test.ts`: exit 0, all assertions pass.
- Independent end-to-end run (not the project test): a temp git project with the real daemon, a dead stub agent, and a task parked in `doing`. The harness confirmed the user flow:
  1. First death streak reaches the cap and logs exactly one "giving up".
  2. The user revives the agent (a live pid appears in the task pidfile): the poll resets `${slug}.dead` to 0 and logs nothing extra.
  3. The revived agent dies again: the second streak reaches the cap and logs its own "giving up", exactly one line, so two in total. No over-logging within a streak.
- Same harness against the pre-fix code (main checkout, no alive-sighting reset): the counter never resets, so the revive step times out. This confirms the fix is what makes the second give-up work.

# Open questions
