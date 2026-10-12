---
name: "docs: SPECS liveness bullet says a 15-minute poll and respawn at the same state"
priority: "low"
state: "reviewing"
worktree: "docs/163-specs-liveness-poll-wording"
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

# Open questions

Assumptions:
- The respawn cap (5, RESPAWN_CAP in src/orchestrator.ts) belongs in the SPECS liveness bullet, because README.md:79 already mentions it and the task asks the two docs to agree.
- Docs-only scope: no code change and no new test needed, per the Specs.

