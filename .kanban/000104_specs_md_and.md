---
name: "docs: SPECS.md and the PM skill still list only 8 states; add to-merge/merging and the merger flow"
priority: "medium"
state: "to-merge"
worktree: "docs/104-specs-md-and"
issuer: "#78"
---

# Summary
SPECS.md and skills/se-llm-team/SKILL.md still document the old 8-state board and the live-testing -> done fallback, with no Merger agent or to-merge/merging flow. Bring both docs in line with the 10-state list and the live-testing -> to-merge -> merging -> done flow, as README.md already does.

# Specs
Found in the live test of #78 (to-merge/merging states; the finding is outside #78's constrained file list).

Current state (verified in /home/phamba/repos/se-llm-team):
- SPECS.md line 19: the "state" attribute lists only "backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, done" - missing to-merge and merging.
- SPECS.md line 42: the to-live-test bullet still says the Tester moves the task to "done" when it terminates without a state update (the new flow moves live-testing -> to-merge). SPECS.md has no Merger agent and no to-merge/merging flow at all.
- skills/se-llm-team/SKILL.md line 17: "States: backlog, ... live-testing, done." - the same stale 8-state list. The PM reads this skill while kanban_list now returns to-merge and merging tasks, so the skill misleads it.

Fix: update both docs to the 10-state list (backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, to-merge, merging, done) and document the live-testing -> to-merge -> merging -> done flow, including that the orchestrator spawns one Merger at a time from to-merge and that the live-tester's no-state-update fallback is now to-merge (not done). Mirror the states list and merge-flow wording already updated in README.md, adapting it to each doc's scope: SPECS.md describes the full methodology/agent roles, SKILL.md only needs the state list aligned (and any merge-flow sentence that contradicts the board).

Dedup: #79 is webui columns for the new states, #95 is the poll rewrite, #102 is the merger's hardcoded main - none covers SPECS.md/SKILL.md state documentation.

Evidence: docs review only; no code change expected.

# Notes
Verified the flow against src/orchestrator.ts, agents/merger.md and agents/live-tester.md before writing.

Changes (commit a77b013 in docs/104-specs-md-and):
- SPECS.md: state attribute list now carries the 10 states (added to-merge, merging). Orchestrator section: to-live-test no-state-update fallback is now to-merge (was done), plus a new to-merge bullet (at most one Merger at a time project-wide, move to merging, two-step merge, failed merge requeues to to-merge and aborts dirty merges). Live-tester section: sets to-merge whatever the test result (was done). New ## Merger agent section mirroring agents/merger.md.
- skills/se-llm-team/SKILL.md: States line now lists all 10 states, with a sentence that the Merger owns the to-merge/merging transitions and the Project manager never moves tasks into or out of them.

Dedup held: #79 (webui columns), #95 (poll rewrite), #102 (merger hardcoded main) untouched.

Review (no fixes): all spec items verified against the worktree code and agent prompts. 10-state list matches README.md line 55; live-testing -> to-merge fallback matches DEAD_TRANSITIONS ("live-testing": "to-merge", merging: "to-merge") in src/orchestrator.ts; the to-merge bullet matches sweepToMerge (global merger pid check, spawn then setState merging); the Merger section matches agents/merger.md (two-step merge, main wins unless Specs say otherwise, failed merge requeues with git merge --abort); the Live-tester section matches agents/live-tester.md; SKILL.md states line plus the Merger-ownership sentence are accurate (merger.md has the merger set to-merge -> merging and merging -> done itself). No other stale state/flow wording in SKILL.md.

Observation for a follow-up, outside this task's spec: the SPECS.md liveness bullet ("If dead, kill the agent, and respawn at same state") still describes the old respawn-in-place behavior; poll() now bounces dead-agent tasks via DEAD_TRANSITIONS (doing -> to-do, reviewing -> to-review, live-testing -> to-merge, merging -> to-merge) and the sweep respawns for the new state, so the bullet contradicts the live-testing fallback documented two bullets above. Not fixed here: #95 (doing, critical) rewrites exactly that poll machinery and rebases first.
