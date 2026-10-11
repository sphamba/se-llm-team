---
name: "fix: dead-agent give-up log fires only on exact equality - a second death streak stays silent"
priority: "low"
state: "done"
worktree: ""
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

## Merge (2026-10-11)

Both merges complete: main merged into fix/109-dead-agent-give in the worktree (merge commit 7c22de8), then the branch fast-forwarded into main at the root (main -> 7c22de8).

Merge conflict in src/orchestrator.ts, resolved in favour of the base branch: main's task 000095 rework ("unconditional dead-agent bounce; idle-cooldown respawn past the cap", commit 4934ea6) restructured the whole death-handling section after this branch was cut. The branch's alive-sighting counter reset is incompatible with that design: under the cap the respawn is immediate, so every fresh agent produces an alive sighting, and resetting the counter there would pin it near 1 forever - the respawn cap and its idle cooldown could never engage, regressing task 000095's fix for the runaway bounce (tasks #72/#74). Main's design also already fixes this task's named bug: the run-completed reset (task outside the mapped states with a stale pidfile and counter > 0 clears the counter) ends every death streak, so a second streak after user intervention starts from 0 and its crossing fires the cooldown log at exactly RESPAWN_CAP + 1. The equality gate is safe because every streak starts from a reset counter. The branch's premise ("the counter is never reset anywhere") was true at its merge-base but is stale against main.

- src/orchestrator.ts: took main's side wholesale (no net poll change on main).
- src/orchestrator.test.ts: the auto-merge had combined the branch's part B addition with main's rework; the branch's block asserted an alive-sighting counter reset and a "giving up" message that no longer exists in main (the message became "respawn waits for the idle cooldown"), so it would have failed. Replaced it with an adapted block encoding the task's scenario in main's semantics: after the first cooldown log, set the task to backlog with a stale (dead) pidfile, wait for the "run completed, cleared the dead-agent counter" reset, set the task back to to-do, then wait for a second "respawn waits for the idle cooldown" and assert exactly two occur. Net change onto main: 8 added lines in src/orchestrator.test.ts only.
- Tests in the worktree after the merge commit: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/extension.test.ts, node src/webui.test.ts all exit 0 (orchestrator includes the adapted part B and main's part AI dead-counter clear).

# Open questions
