---
name: "docs: SPECS.md and the PM skill still list only 8 states; add to-merge/merging and the merger flow"
priority: "medium"
state: "backlog"
worktree: ""
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
