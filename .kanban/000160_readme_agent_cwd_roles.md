---
name: "docs: README Agents paragraph says every agent runs in the task worktree"
priority: "low"
state: "doing"
worktree: "docs/160-readme-agent-cwd-roles"
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

# Open questions

