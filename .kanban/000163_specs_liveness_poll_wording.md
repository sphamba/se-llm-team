---
name: "docs: SPECS liveness bullet says a 15-minute poll and respawn at the same state"
priority: "low"
state: "done"
worktree: ""
issuer: "#156"
complexity: "simple"
shortName: "specs-liveness-poll-wording"
blockedBy: ""
---

# Summary
SPECS.md:48 still says the daemon polls liveness "every 15 minutes" and respawns a dead agent "at same state". The default is 1 minute (DEFAULT_POLL_MINUTES = 1, src/orchestrator.ts:25, changed by #21), and a dead agent bounces the task one state back first (WORKING_STATES, src/orchestrator.ts:1023-1028). README.md:79 was updated by #156 and describes the bounce, so the two docs disagree.

# Specs
Docs-only: SPECS.md:48, the liveness bullet of the Orchestrator list. Found by the #156 live test.

Current (SPECS.md:48): "- Poll the agents for liveness (every 15 minutes, configurable). If dead, kill the agent, and respawn at same state."

Two errors:
1. The default poll interval is 1 minute, not 15: `const DEFAULT_POLL_MINUTES = 1;` (src/orchestrator.ts:25; configurable via pollMinutes; task #21 changed the old 15-minute default).
2. A dead agent does not respawn at the same state. The daemon bounces the task one state back first - WORKING_STATES, src/orchestrator.ts:1023-1028: doing -> to-do, reviewing -> to-review, live-testing -> to-live-test, merging -> to-merge - then the respawn machinery runs from the bounced state.
README.md:79 (updated by #156) already reads correctly: "an agent dead without a state update moves the task on (a dead Developer goes back to to-do for a fresh run, reviewing to to-review, live-testing to to-live-test, merging to to-merge)".

Fix: rewrite SPECS.md:48 to match README's liveness bullet and the 1-minute default, keeping its position in the Orchestrator bullet list.

Blocked by #162 because both tasks rewrite adjacent regions of the same SPECS.md Orchestrator list (lines 43 and 48); the chain avoids a mechanical merge conflict. Line numbers are as of this task's creation - once the blocker merges, locate the "15 minutes" bullet and re-check its line.

Repro: sed -n '48p' SPECS.md; grep -n 'DEFAULT_POLL_MINUTES = ' src/orchestrator.ts

Acceptance:
- The SPECS.md liveness bullet states the 1-minute default (configurable) and the one-state-back bounce with the four transitions; no "15 minutes" and no "respawn at same state".
- No statement contradicts README.md:79.
- node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts pass (docs-only; no code change and no new test).

# Notes
- #162 had merged when I started (blockedBy empty), so SPECS.md line 48 still held the stale text. Verified against the code: DEFAULT_POLL_MINUTES = 1 (src/orchestrator.ts:25), WORKING_STATES bounce (src/orchestrator.ts:1023-1028), RESPAWN_CAP = 5 (src/orchestrator.ts:30).
- Rewrote SPECS.md:48: "- Poll the agents for liveness (every 1 minute, configurable). If dead, kill the agent, bounce the task one state back (a dead Developer goes back to \"to-do\" for a fresh run, reviewing to \"to-review\", live-testing to \"to-live-test\", merging to \"to-merge\") and respawn from the bounced state, capped at 5 respawns per task." Added the 5-respawn cap so the bullet agrees with README.md:79. No "15 minutes", no "respawn at same state" left in SPECS.md or README.md.
- Committed in the worktree (631a7a4). Acceptance tests pass: kanban.test.ts, orchestrator.test.ts, webui.test.ts.
- Review (no fixes): the rewritten bullet matches the code. DEFAULT_POLL_MINUTES = 1 (src/orchestrator.ts:25), RESPAWN_CAP = 5 (src/orchestrator.ts:30), and the four transitions in the bullet match WORKING_STATES (src/orchestrator.ts:1023-1028) exactly.
- Review: "Capped at 5 respawns per task" is README.md:79's own wording, so the two docs agree. Past the cap, a respawn waits for the idle cooldown instead of stopping; README.md:39 (autoScheduleMinutes row) already records that. No contradiction, no extra text needed in SPECS.md.
- Review: no "15 minutes" and no "respawn at same state" left in SPECS.md or README.md (grep finds nothing). The diff against the merge base changes SPECS.md only (1 line, docs-only).
- Review: main moved past the merge base while the task was in review (README.md and index.ts changed). Those commits do not touch SPECS.md, so the Merger should not see a conflict.
- Review: acceptance tests re-run in the worktree and pass: kanban.test.ts, orchestrator.test.ts, webui.test.ts.
- The developer's two assumptions are sound, and I checked both. The cap matches README.md:79, and the Specs say docs-only. They are not user questions, so the section below is empty.
- Merge step 1: base branch was main. Merged main into the branch in the worktree. The merge was clean (ort strategy). Main brought README.md and index.ts changes only. No conflict, so no test suites ran again (clean-merge rule). SPECS.md:48 kept the correct bullet. Merge commit 96fa952.
- Merge step 2: base branch was still main. Merged the branch into main at the project root. Fast-forward, clean, no conflicts. The root checkout was not detached. main now holds the SPECS.md fix (SPECS.md:48: 1-minute poll, one-state-back bounce, 5-respawn cap).
- Live test PASS (no findings), at the project root, merge commit 96fa952. The SPECS.md liveness bullet reads: every 1 minute, configurable; bounce the task one state back with the four transitions (to-do, to-review, to-live-test, to-merge); respawn from the bounced state; capped at 5 respawns per task. The bullet kept its position in the Orchestrator list (after the to-live-test bullets, before the coding-agent-executable configuration line).
- Live test: `grep -n "15 minutes" SPECS.md README.md` and `grep -n "respawn at same state" SPECS.md README.md` return nothing. README.md:79 agrees with the new bullet: the same four transitions and the same 5-respawn cap.
- Live test: the documented values are visible at runtime. Started the daemon in a throwaway root (/tmp/lt163, `--no-webui`): the startup log reads `poll=1min`. The same run with `--poll-minutes 15` reads `poll=15min`. The 1-minute default and the configurability are true.
- Live test: the code matches the bullet: DEFAULT_POLL_MINUTES = 1 (src/orchestrator.ts:25), RESPAWN_CAP = 5 (src/orchestrator.ts:30), and the four exact transitions in WORKING_STATES (src/orchestrator.ts:1023-1028). No statement in SPECS.md:48 contradicts README.md:79.
- Live test assumptions: for a docs-only change the user flow is reading the merged docs, so the test checked the text and the absence of the stale phrases, and used the daemon startup log to confirm the documented poll values. The daemon ran against /tmp/lt163, so the real board was not touched. No observed behavior contradicts the task's stated assumptions.

# Open questions

