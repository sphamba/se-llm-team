---
name: "docs: README and SPECS describe the old review -> live-test -> merge order"
priority: "medium"
state: "done"
worktree: ""
issuer: "#155"
complexity: "trivial"
shortName: "docs-readme-specs-pipeline-order"
---

# Summary
README.md and SPECS.md still document the old pipeline order (review -> live-test -> merge). Update both files to the new review -> merge -> live-test flow, including the corrected blocker, dead-agent and done transitions.

# Specs
Found in the live test of #155. README.md and SPECS.md still document the old pipeline order (review -> live-test -> merge). Correct both files to the new order review -> merge -> live-test. Only these two files change; no code, no tests.

# README.md

1. Line 66 (states list): still reads "... to-review, reviewing, to-live-test, live-testing, to-merge, merging, done". New pipeline order: "... to-review, reviewing, to-merge, merging, to-live-test, live-testing, done".
2. Backlog bullet: "every backlog task whose blockedBy refs all point at done tasks" and "When a blocker reaches done, the daemon drops its ref ... so blockedBy always lists undone blockers only". A blocker now stops blocking at done OR at entering the live test (to-live-test/live-testing). Update both sentences.
3. to-review bullet: "the task force-advances to to-live-test". It now advances to to-merge.
4. to-live-test bullet: "spawns a Live-tester, moves to live-testing". to-live-test is now reached after the merger merged; the daemon first routes unmerged/no-worktree tasks to to-merge. Update the bullet accordingly.
5. merging bullet: "merges the branch into the project root's current branch ... and sets done". It now sets to-live-test, and the live tester sets done. Update.
6. Liveness bullet: "live-testing to to-merge". A dead live-testing agent now bounces to to-live-test. Update.

# SPECS.md

7. Lines 37-46 (Orchestrator section): "For every new task in to-live-test: spawn a Tester agent ... If terminated without updated state, move to to-merge", and "For every new task in to-merge: ... merges the branch into main and sets done". The order and the done transition are reversed now.
8. Lines 58-75 (Agents section): Reviewer "Moves the task to to-live-test if no fixes were made" (now to-merge), Live-tester "Moves the task to to-merge, whatever the test result" (now done; already merged), Merger "then moves the task to done" (now to-live-test).

# Notes
Implemented in worktree commit 3c551da (README.md and SPECS.md only, no code, no tests, per the specs).

README.md changes: states list reordered (to-merge/merging now before to-live-test/live-testing). Backlog bullet now states the blocker rule: refs point at satisfied blockers (done tasks, or tasks in the live test: to-live-test or live-testing), and a ref drops when the blocker reaches done or enters the live test. to-merge and merging keep blocking. The to-review force-advance and the reviewerCap table row now say to-merge. The to-live-test bullet documents the new arrival path: reached after the Merger merged, unmerged or no-worktree tasks route back to to-merge first, and the Live-tester spawns on the merged commit at the project root's checkout. The merging bullet sets to-live-test, and the Live-tester sets done. The liveness bounce is live-testing -> to-live-test. The done-with-a-worktree wording now says the merger merged before the live test set done.

SPECS.md changes: the state-attribute states list reordered. The Orchestrator blocks reordered (to-merge before to-live-test). The merger sets to-live-test after a successful merge, and a dead live-testing agent bounces to to-live-test. The to-live-test block documents the unmerged/no-worktree route to to-merge and the Live-tester spawn on the merged commit. The Agents section: Reviewer moves to to-merge when no fixes were made, Live-tester moves to done whatever the result (the change is already merged, problems travel as new tasks), Merger moves to to-live-test after the merge.

Before writing, I verified the new flow against the #155 branch (feat/155-review-merge-live-test, in merging at write time): the reviewer-cap advance goes to to-merge with the counter reset, WORKING_STATES bounces live-testing -> to-live-test and merging -> to-merge, the blocker satisfaction set is (done, to-live-test, live-testing), and the merger sets to-live-test. All 8 spec items are covered.

Three instances of the same stale claims beyond the enumerated 8 were also corrected, because the goal is to remove the old order from both files: the README reviewerCap table row ("force-advances to to-live-test"), the README done-with-a-worktree bullet ("the Merger merged the branch before setting done"), and the SPECS.md state-attribute states list.

Left untouched as staleness not caused by the order change (not in the specs): SPECS.md's generic liveness line still says "respawn at same state" (the code bounces one state back), and SPECS.md says the merger "merges main" (the merger prompt resolves the base branch of the root checkout).

Merged: step 1 merged main into docs/156-docs-readme-specs-pipeline-order in the worktree (commit 3ba3a8e via the ort strategy, clean, no conflicts; main brought in the #155 code reorder in agents/, skills/, src/orchestrator.ts and src/orchestrator.test.ts). Clean merge, so no test suites ran per the merger procedure. Verified README.md line 66 keeps the new state order in the merged result. Step 2 merged the branch into main at the project root (base branch resolved as main both times), fast-forward to 3ba3a8e, clean, README.md and SPECS.md only. Awaiting live test.

## Live test report

Result: PASS. README.md and SPECS.md describe the new review -> merge -> live-test order and match the merged code and a running daemon. No documented claim failed. Four follow-up findings (stale text in other files or pre-existing wording in the two docs) were reported to the Project manager. None blocks this change.

What I ran (no unit test suite, no *.test.ts):
- Read both files end to end and the diff of 3c551da: README.md and SPECS.md only, 17 insertions and 16 deletions.
- Ran the real daemon on a scratch git repo: `node src/orchestrator.ts --root /tmp/lt156 --rescan-seconds 1 --poll-minutes 0.05 --no-webui`, with a 6-task fixture board and a stub agent that exits at once. The daemon log showed:
  - to-live-test with a merged branch -> live-tester spawned with cwd = project root, not the worktree, then state live-testing. The poll bounced live-testing -> to-live-test and stopped respawning after 5 deaths.
  - to-live-test with an unmerged branch -> "branch not merged yet, moving to to-merge for the merger".
  - to-live-test with no worktree -> "no worktree, moving to to-merge"; the to-merge sweep then found nothing to merge and set done.
  - to-review, trivial (cap 0) -> "reviewer succeeded 0+ times, moving to to-merge", with no reviewer spawn.
  - backlog with blockedBy "#1" and #1 in to-live-test -> "dropped satisfied blocker ref(s) #1" and "promoting ... to to-do" in the same sweep.
  - dead-agent bounces: doing -> to-do, live-testing -> to-live-test, merging -> to-merge. A merger requeued by a failed merge retried only after the idle cooldown.
  - done with a merged worktree -> worktree dir removed, branch deleted, worktree attribute cleared, "kanban: done" mirror commit. done without a worktree -> done mirror commit at the next rescan.
- Cross-checked all 8 spec items plus the 3 extra corrections against src/orchestrator.ts, src/kanban.ts, index.ts and agents/*.md. All MATCH.
- Searched both files for old-order leftovers (merger sets done, live-tester sets to-merge, live-testing -> to-merge bounce). None found.

Live-test design assumptions:
- A docs change is tested by reading the two files and by checking every claim against the merged code and the real daemon behavior.
- The stub-agent daemon run exercises the real daemon, the board library and the git plumbing. Only the two role actions that need an LLM (the merger merge and the live-tester done write) are out of reach, so I checked those in agents/merger.md and agents/live-tester.md.
- A scratch git repo is a valid stand-in for a project board.
- The docs-only assumption holds: git show --stat 3c551da lists README.md and SPECS.md only.

No observed behavior contradicts the task's stated assumptions.

Findings reported to the Project manager (follow-ups, no re-merge):
1. README.md Agents section (about line 97) still says every agent runs "with the task worktree as cwd". Under the new order the live-tester (README line 76 says the project root checkout) and merger step 2 run at the project root. The same README now contradicts itself. This is a leftover of the reorder in a file this task edited.
2. index.ts orchestrator_start tool description still says "spawns Developer/Reviewer/Live-tester agents for to-do/to-review/to-live-test tasks, polls agent liveness, and merges done branches". That is the old merge-on-done flow, with no Merger and no to-merge/merging lane. The PM sees this text in its tool list.
3. SPECS.md line 48 says "Poll the agents for liveness (every 15 minutes, configurable). If dead, kill the agent, and respawn at same state." The default poll is 1 minute and a dead agent bounces one state back, not respawn at the same state.
4. SPECS.md lines 41-42 and 75 say the merger "merges main" and "runs the tests there" unconditionally. The merger resolves the project root's current branch (#102) and skips the test suites on a clean merge (#113). README.md line 78 has the same unconditional "runs the tests there" wording.

Minor, probably no task needed: SPECS.md line 31 "Stateless process" (the daemon keeps in-memory state), SPECS.md line 10 PM backlog-promotion framing, and the undocumented to-merge shortcut "nothing to merge -> done".

# Open questions

No user or client questions. The specs were complete and I verified them against the #155 code.

Assumptions:
- The #155 branch (feat/155-review-merge-live-test) is the source of truth for the new flow. These docs describe the state it produces after it merges, although main does not contain the reorder yet.
- Docs-only: README.md and SPECS.md change. No code and no tests, as the specs say.
- Stale instances of the same claims beyond the enumerated 8 (reviewerCap row, done-with-a-worktree wording, SPECS states list) are in scope of "correct both files to the new order".
- Staleness unrelated to the order (SPECS.md generic liveness wording, "merges main") stays untouched.

Live-test design assumptions:
- See the Live test report in # Notes.
- The last assumption above left findings 3 and 4 in the report: a reader still hits stale liveness and merger wording in SPECS.md, and the to-merge/merging text in README.md line 97 is now wrong. They travel as new tasks, as the live-test procedure says.
