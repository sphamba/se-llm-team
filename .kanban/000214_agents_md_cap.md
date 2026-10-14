---
name: "fix: lower the AGENTS.md injection cap below the kernel argv limit"
priority: "high"
state: "done"
worktree: ""
issuer: "#213"
complexity: "simple"
shortName: "agents-md-cap"
---

# Summary
The 1,000,000-byte AGENTS.md injection cap sits above the kernel's 131,072-byte per-argument limit, so a root AGENTS.md between about 131 KB and 1 MB makes every agent spawn fail with E2BIG and the task livelocks in a doing -> to-do retry loop. Lower PROJECT_PROMPT_CAP in src/orchestrator/spawn.ts to about 131,000 bytes so the injection skips with its warning and the spawn always continues.

# Specs
PM decision: the user confirmed the lower cap (~131,000 bytes). A larger cap keeps injection working between 131 KB and 1 MB but makes every spawn fail with E2BIG, so the lower value wins.

Required behavior:
- Lower the AGENTS.md injection cap (PROJECT_PROMPT_CAP in src/orchestrator/spawn.ts) to about 131,000 bytes — a safe margin below the kernel's 131,072-byte single-argv-element limit (MAX_ARG_STRLEN).
- When the cap is exceeded, keep the current skip behavior: one warning line naming the file and its byte size, no injection, and the spawn continues normally (agents must never fail to start because of an oversized AGENTS.md).
- Update docs/agents-and-tools.md where it states the 1,000,000-byte cap to the new value.
- Update the test fixture in the part AX cap test: the oversized fixture and the 1,000,001-byte expectation must move to the new cap value (cap + 1).

Evidence from the live test of #213:
- With a target project root AGENTS.md of 200,000 bytes (below the 1,000,000-byte cap), the daemon logged `error handling <task> (to-do): spawn E2BIG` and `agent pid=0 dead without state update, doing -> to-do` repeatedly; no agent process ever started and the task retried forever.
- The reviewer measured that a single argv element of 131,000 bytes passes and 132,000 bytes fails; MAX_ARG_STRLEN is 131,072.

# Notes

- Lowered PROJECT_PROMPT_CAP in src/orchestrator/spawn.ts from 1,000,000 to 131,000 (72 bytes below MAX_ARG_STRLEN, 131,072). The comment above it now names the kernel limit.
- Updated the cap sentence in docs/agents-and-tools.md to 131,000 bytes.
- tests/orchestrator.test.ts: the oversized fixture moved to 131,001 bytes and the warning assertion to "131001". Added an at-cap check: a 131,000-byte AGENTS.md is injected as one argv element and the stub spawn still succeeds, so the boundary is exercised by a real node spawn against the kernel limit.
- `node tests/orchestrator.test.ts` passes (about 3m20s), including the agents.md injection smoke. Commit 898a13b.
- Review pass 1: the diff meets all four Spec requirements (cap 131,000 in src/orchestrator/spawn.ts, unchanged skip-and-warn behavior, docs sentence, fixture and warning assertion at cap + 1).
- Both assumptions the developer left under Open questions verified against the code, so the section is empty again. Cap margin: MAX_ARG_STRLEN is 32 pages, 131,072 bytes on 4 KiB-page kernels and larger on bigger pages, and the injected element rides through one sh -c spawn path, so 131,000 always fits and the total argv stays far below ARG_MAX. Cap scope: projectAgentsPrompt (spawn.ts) is the only argv element that carries target-project content; the task prompt comes from agents/<role>.md and carries no task content, and the role notes reach the agent through the cwd symlink, not argv.
- Reviewer fix (3365ced): the at-cap check in the part AX test lacked the promptIdx !== -1 guard the first spawn has, so a boundary regression would have failed as a confusing length mismatch against argv[0] (the stub path) instead of a missing-flag message. Added the guard. Re-ran node tests/orchestrator.test.ts after the fix: passes, with the at-cap spawn injecting 131,000 bytes through a real spawn and the over-cap spawn logging "131001 bytes is over the 131000-byte argv cap".

- Live test (merged 3365ced, isolated daemon e2e, fake-pi, plain `git init` root, `--no-webui`): three one-task rounds, root AGENTS.md tracked and committed at each size. (1) exactly 131,000 bytes: real spawn has `--append-system-prompt` with one argv element, byte length 131,000 and sha256 equal to `sha256sum AGENTS.md`, agent process alive, no warning. (2) 131,001 bytes: one warning `skipping /tmp/t214/repo/AGENTS.md injection: 131001 bytes is over the 131000-byte argv cap`, no flag, the `spawned developer` line follows and the agent runs (task stays doing, no bounce). (3) 200,000 bytes (the #213 repro): one warning naming 200000, no flag, agent runs, no `spawn E2BIG`, no `failed to start`, no `doing -> to-do`. Kernel probe with the daemon's own argv shape (`spawnSync("sh", ["-c","true","sh","x".repeat(n)])`): 131,000 passes, 131,072 and 132,000 fail with E2BIG, so the cap sits 72 bytes below the limit and 131,001 would have failed if injected. docs/agents-and-tools.md line 5 states the 131,000-byte cap, and no `1_000_000`/`1000000`/`1,000,000` remains in src, docs, agents, skills, README.md or index.ts.
- Live-test assumptions: the injected element rides the same single `sh -c` exec layer as a real agent (fake-pi replaces only the pi process), so the measured boundary is the kernel one; E2BIG is an exec failure, so a fake agent is the right probe for it; the skip is proven by argv absence, not by pi behavior.
- No findings, no new tasks.

# Open questions

