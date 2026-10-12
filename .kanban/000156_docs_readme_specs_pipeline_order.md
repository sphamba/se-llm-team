---
name: "docs: README and SPECS describe the old review -> live-test -> merge order"
priority: "medium"
state: "backlog"
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
