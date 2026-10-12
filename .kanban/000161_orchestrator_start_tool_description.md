---
name: "fix: orchestrator_start tool description omits the Merger and the new pipeline order"
priority: "medium"
state: "done"
worktree: ""
issuer: "#156"
complexity: "simple"
shortName: "orchestrator-start-tool-description"
---

# Summary
index.ts:168, the orchestrator_start tool description (which the PM reads in its tool list), still frames the old pipeline: it names only Developer/Reviewer/Live-tester for to-do/to-review/to-live-test, omits the Merger role and the to-merge/merging lane, and says the daemon "merges done branches" - the Merger agent merges, and before the live test, not at done.

# Specs
Code-string change in index.ts only. Found by the #156 live test.

Current, index.ts:168: "Start the se-llm-team orchestrator daemon for this project. It watches .kanban/, spawns Developer/Reviewer/Live-tester agents for to-do/to-review/to-live-test tasks, polls agent liveness, and merges done branches. When webUi.enabled is set in ~/.pi/agent/se-llm-team.json it also starts an in-process web dashboard for the board. Exits early if it already runs for this project."

Three errors: it omits the Merger role and the to-merge/merging lane; it says the daemon merges branches (the Merger agent does; done only triggers worktree/branch cleanup in mergeDone); and it places the merge at done instead of before the live test.

Real flow (src/orchestrator.ts):
- Developer for to-do (startTodo, spawn at :782)
- Reviewer for to-review (spawn at :964)
- Merger for to-merge, at most one merger for the whole project (sweepToMerge, spawn at :838)
- Live-tester for to-live-test, on the merged commit at the project root (spawn at :984)
Pipeline order since #155: review -> merge -> live-test.

Fix: update the description to name the four roles and their trigger states (Developer/to-do, Reviewer/to-review, Merger/to-merge, Live-tester/to-live-test) and the review -> merge -> live-test order; drop the "merges done branches" claim. Keep the webUi sentence and the "Exits early" sentence.

Repro: grep -n 'spawns Developer' index.ts

Acceptance:
- sed -n '168p' index.ts names the four roles and their states and the review -> merge -> live-test order; no claim that the daemon merges done branches.
- node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts pass. index.ts has no test file; verify the string by inspection.

# Notes

- Rewrote the orchestrator_start description at index.ts:168 (commit c8e7f77): it now names the four roles with their trigger states (Developer/to-do, Reviewer/to-review, one Merger/to-merge, Live-tester/to-live-test on the merged commit), states the review -> merge -> live-test order, and drops the "merges done branches" claim. WebUi and "Exits early" sentences kept as-is.
- Acceptance: sed -n '168p' matches the contract; kanban.test.ts, orchestrator.test.ts (all smoke parts) and webui.test.ts pass.
- Review (no fixes needed): verified the new description against src/orchestrator.ts. The "one Merger agent" phrasing matches the code: sweepToMerge returns early when a merger is alive ("at most one merger at a time, project-wide", :812-813), and "on the merged commit" matches the live test running after the merge, at the project root. Branch changes only index.ts (single commit c8e7f77). The developer's one assumption was disclosed, not silent, and is confirmed by the code, so the Open questions section is empty again.
- Merge (Merger): base branch was main at both steps. Step 1 merged main into fix/161-orchestrator-start-tool-description in the worktree (clean, ort strategy; carried in README.md, SPECS.md, agents/live-tester.md pipeline-order changes). No conflicts, so test suites were skipped per the merge policy. Step 2 merged the branch into main at the project root (fast-forward 6a5666a..dc5ee61, index.ts only). No conflicts anywhere, nothing extra to commit.

## Live test report (2026-10-12, live-tester)
- Result: PASS, no findings, no open questions. The change is a tool-description string. Its real user interface is the tool list the PM reads.
- Real user flow (no unit suite, no *.test.ts, no code edits): a fresh headless pi session was started from the project root (`pi -p --no-session`, default provider/model) and asked to copy the complete orchestrator_start description from its tool definitions. The session loads the extension from `~/.pi/agent/extensions/se-llm-team`, a symlink to the merged main checkout at HEAD dc5ee61, so this is the same registration path as a PM session.
- Byte-exact: the model-reported description equals the string literal of index.ts:168 at the merged commit (diff: no differences). Evidence: /tmp/lt161-model.txt, /tmp/lt161-src.txt.
- New claims present in the loaded extension: "one Merger agent for to-merge tasks" (1 hit), "Live-tester agents for to-live-test tasks on the merged commit" (1), "Pipeline order: review -> merge -> live-test" (1).
- Stale claims gone from the loaded extension: "merges done branches" (0 hits), "Developer/Reviewer/Live-tester" (0 hits).
- Kept sentences: the webUi sentence and the "Exits early" sentence are unchanged in the new string.
- Cross-check with the merged code (grep of src/orchestrator.ts): the four role spawn sites exist (developer to-do :782, merger to-merge :838, reviewer to-review :964, live-tester to-live-test :984). This matches the new text. No contradiction found.
- Live test design assumptions:
  - For a tool description, the user-facing interface is the model tool list. A fresh headless session that reads back the description exercises extension discovery, tool registration and the exact text the PM receives.
  - A fresh session is representative. The live PM session of this test also sees the new text in its own tool schema.
  - The daemon behavior behind the roles and the order is the subject of #155 and #156. This task changes the string only, so the live test verifies the string.
- No observed behavior contradicts the task's stated assumptions.

