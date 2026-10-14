---
name: "fix: lower the AGENTS.md injection cap below the kernel argv limit"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#213"
complexity: "simple"
shortName: "agents-md-cap"
---

# Summary
The 1,000,000-byte AGENTS.md injection cap sits above the kernel's 131,072-byte per-argument limit, so a root AGENTS.md between about 131 KB and 1 MB makes every agent spawn fail with E2BIG and the task livelocks in a doing -> to-do retry loop. Lower PROJECT_PROMPT_CAP in src/orchestrator/spawn.ts to about 131,000 bytes so the injection skips with its warning and the spawn always continues.

# Specs
Required behavior:
- Lower the AGENTS.md injection cap (PROJECT_PROMPT_CAP in src/orchestrator/spawn.ts) to about 131,000 bytes — a safe margin below the kernel's 131,072-byte single-argv-element limit (MAX_ARG_STRLEN).
- When the cap is exceeded, keep the current skip behavior: one warning line naming the file and its byte size, no injection, and the spawn continues normally (agents must never fail to start because of an oversized AGENTS.md).
- Update docs/agents-and-tools.md where it states the 1,000,000-byte cap to the new value.
- Update the test fixture in the part AX cap test: the oversized fixture and the 1,000,001-byte expectation must move to the new cap value (cap + 1).

Evidence from the live test of #213:
- With a target project root AGENTS.md of 200,000 bytes (below the 1,000,000-byte cap), the daemon logged `error handling <task> (to-do): spawn E2BIG` and `agent pid=0 dead without state update, doing -> to-do` repeatedly; no agent process ever started and the task retried forever.
- The reviewer measured that a single argv element of 131,000 bytes passes and 132,000 bytes fails; MAX_ARG_STRLEN is 131,072.

# Notes

# Open questions
Open question carried from #213: the kernel rejects a single argv element over 131,072 bytes, so the spec's 1,000,000-byte cap is unsafe. Keep the spec's 1,000,000-byte cap, or lower it to about 131,000 so the spawn always continues? This task implements the lower value.
