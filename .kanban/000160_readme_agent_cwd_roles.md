---
name: "docs: README Agents paragraph says every agent runs in the task worktree"
priority: "low"
state: "done"
worktree: ""
issuer: "#156"
complexity: "simple"
shortName: "readme-agent-cwd-roles"
---

# Summary
README.md's Agents paragraph (line 97) still says the orchestrator runs each agent "with the task worktree as cwd". Under the review -> merge -> live-test order only the Developer and Reviewer spawn there; the Merger (src/orchestrator.ts:838) and the Live-tester (:984) spawn at the project root, and README.md:76 already says the live test runs on the project root checkout, so README contradicts itself.

# Specs
Docs-only change in README.md (the file task #156 edited). Found by the #156 live test.

Claim (README.md:97, the "## Agents" paragraph): "The orchestrator runs each agent as a headless `<executable> --approve --mode json [<llm flags>] -p <prompt>` process, with the task worktree as cwd, the task file path in the prompt, ...".

That is a leftover of the #155 pipeline reorder. In the merged code only developer and reviewer use the worktree dir:
- developer: spawnAgent(root, cfg, "developer", {...task, worktree: ensured.wt}, ensured.wtDir) - src/orchestrator.ts:782
- reviewer: spawnAgent(root, cfg, "reviewer", task, ensured.wtDir) - src/orchestrator.ts:964
- merger: spawnAgent(root, cfg, "merger", {...task, worktree: ensured.wt}, root, "merger") - src/orchestrator.ts:838
- live-tester: spawnAgent(root, cfg, "live-tester", task, root) - src/orchestrator.ts:984
README.md:76 (to-live-test bullet, updated by #156) says the Live-tester runs "on the merged commit (the project root's checkout)", so the paragraph at :97 now contradicts it.

Fix: state in the Agents paragraph which roles run where - Developer and Reviewer with the task worktree as cwd; the Merger and the Live-tester at the project root - or record the cwd at each of the existing spawn-role mentions. Leave the rest of the paragraph (headless command shape, task file path in the prompt, log, prompt-load path) unchanged.

Repro: sed -n '97p' README.md; grep -n 'spawnAgent(root' src/orchestrator.ts

Acceptance:
- The Agents paragraph lets a reader tell the cwd of all four roles, and no README statement contradicts README.md:76.
- node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts pass (docs-only; no code change and no new test).

# Notes
- Verified the spec's spawn calls in the worktree (developer :782 and reviewer :964 with ensured.wtDir; merger :838 and live-tester :984 with root) and that all four roles have prompts in agents/, so "role agents" covers the Merger and Live-tester.
- README.md:97 (Agents paragraph): removed "with the task worktree as cwd" from the headless-command sentence and added "The Developer and the Reviewer run with the task worktree as cwd. The Merger and the Live-tester run at the project root." Rest of the paragraph (command shape, task file path, log, prompt-load path) unchanged.
- README.md:89 (Extension load path) also said "Role agents run in task worktrees", which contradicted :76 the same way; changed to "Role agents run in the task worktree or at the project root". This was not in the Fix clause but is required by the acceptance criterion (no README statement contradicts :76).
- node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts all pass. Committed as 8e390da in docs/160-readme-agent-cwd-roles.
- Review: diff main...HEAD is docs-only (8e390da, README.md, 2 lines) and matches the Fix clause; the new sentences match the verified spawn calls; full README sweep found no other statement contradicting :76 or the new wording; the :89 change is outside the Fix clause but required by the acceptance criterion and documented, not a silent assumption; all three test suites pass (orchestrator.test.ts needs ~5 min). No fixes, no open questions. State set to to-merge.
- Merge step 1: base branch resolved to main; merged main into docs/160-readme-agent-cwd-roles in the worktree (merge commit 941d567, 'ort' strategy, README.md auto-merged, no conflicts). Verified the auto-merged README: the Agents paragraph gives the cwd of all four roles and the Extension load path sentence keeps the :76-compatible wording. No conflicts, so the test suites were skipped per merge policy.
- Merge step 2: base branch re-resolved to main (unchanged); merged docs/160-readme-agent-cwd-roles into main at the project root as a fast-forward (dc5ee61..941d567). Both merges complete, no conflicts at any point. State set to to-live-test.
- Live test (docs-only, so the user-facing flow is reading the merged README at the project root, commit 941d567 on main):
  - README.md:97 (Agents paragraph) reads: "The Developer and the Reviewer run with the task worktree as cwd. The Merger and the Live-tester run at the project root." A reader can tell the cwd of all four roles. The rest of the paragraph (headless command shape, task file path in the prompt, llm flags, agent log, prompt-load path) is unchanged by the fix.
  - README.md:76 (to-live-test bullet) says the Live-tester runs on the merged commit (the project root's checkout). It agrees with :97 and with README.md:89 ("Role agents run in the task worktree or at the project root"). Full README sweep (grep worktree|cwd|project root) found no other statement contradicting :76.
  - Cross-checked the claim against the merged code: spawnAgent at src/orchestrator.ts:782 (developer, ensured.wtDir) and :964 (reviewer, ensured.wtDir) use the worktree dir; :838 (merger, root) and :984 (live-tester, root) use the project root. The documented cwds match the actual spawn calls.
  - Assumption: for a docs-only change there is no runtime flow to exercise; the live test is the read-and-cross-check above. I did not spawn real agents (out of scope and costly) and did not run the unit suites (developer/reviewer gate).
  - Result: no findings. No technical difficulties. No open questions.

# Open questions

