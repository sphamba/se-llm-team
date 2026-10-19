---
name: "fix: 60-minute stall window and prompt sentences about tool-call timeouts"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "stall-window-60"
---

# Summary
Keep the log-stall kill but raise its default window from 10 to 60 minutes, and add a templated sentence to the developer, reviewer and live-tester prompts telling the agent to keep its tool call timeouts under the configured window, otherwise its process gets killed.

# Specs
Goal: the log-stall kill stays; its default window becomes 60 minutes; the three long-running role prompts tell the agent about the window so it keeps tool call timeouts under it.

Background (user decisions 2026-10-18): the earlier idea of removing the stall kill was dropped. The kill stays (task #115's mechanism: a live-but-hung agent whose run log is unchanged for logStallMinutes is bounced and killed, src/orchestrator/liveness.ts logStalled :35-60, triggered in poll() :143-146 with bounceDead kill=true). The default window goes 10 -> 60, and the agents get told about it in their prompts. Accepted trade-off: a hung-but-alive agent is killed after 60 minutes of log silence instead of 10.

Part 1 - window default 10 -> 60:
- src/orchestrator/config.ts: DEFAULT_LOG_STALL_MINUTES (L13) 10 -> 60; the invalid-value fallback follows (validation ~L153-158 keeps the default and warns - the warning message stays otherwise unchanged).
- README.md config table row (~L86): default 10 -> 60 (keep the behavior description accurate).
- Tests: tests/orchestrator/config.test.ts part AP asserts the default value 10 (~L177) -> 60 (the invalid-value keeps-default asserts follow). tests/orchestrator/poll.test.ts part AN (~L167-281) stall scenarios run against the default window - update their simulated timestamps and any exact log-line strings ("agent log unchanged for 10+ min") to the 60-minute window. Part AO (~L283-301, its own configured 2-minute window) stays untouched.

Part 2 - templated prompt sentences:
- Role prompts are editable markdown files at the repo root, read fresh at every spawn (settled by #224/#225): agents/developer.md, agents/reviewer.md, agents/live-tester.md. The only renderer is renderPrompt (src/orchestrator/spawn.ts:14-21) with one existing substitution precedent: reviewer-gated prompt.replaceAll("{{ROOT}}", root) at spawn.ts:20.
- Append one sentence to each of the three prompts, e.g.: "Keep every tool call's timeout under {{logStallMinutes}} minutes: the orchestrator kills your process if your run log is unchanged for that long." (wording may be refined, the meaning stays: tool call timeouts under the window, the process gets killed otherwise.)
- Plumbing (minimal): renderPrompt gains a logStallMinutes parameter; add an UNCONDITIONAL prompt.replaceAll("{{logStallMinutes}}", String(logStallMinutes)) (not reviewer-gated - all three roles need it); the render call site spawn.ts:225 passes cfg.logStallMinutes (cfg is already in scope there; every pipeline call site already passes cfg). Generic-template precedent: renderTemplate in src/efficiency-analysis.ts:284-286 if a generic approach is preferred, but the one-token replaceAll is enough.
- Splitter, merger, doctor and analyst prompts stay untouched. No prompt already mentions timeouts or the stall behavior (verified by grep).

Tests:
- New asserts in the existing style (substring includes on the rendered prompt): tests/orchestrator/merge.test.ts renders the reviewer prompt and asserts substrings (~L441-446) - add an assert that the rendered prompt contains the configured minutes (e.g. "under 60 minutes" for the default) and that no {{ placeholder survives (the existing !promptRev.includes("{{") assert already covers the new token). A developer or live-tester prompt render assert in tests/orchestrator/spawn.test.ts following the same style.
- Nothing else pins prompt content: spawn.test.ts:436 (claude argv prompt substring) and the efficiency-analysis prompt pins (analyst/doctor only) stay green.
- Acceptance: node tests/orchestrator/config.test.ts, node tests/orchestrator/poll.test.ts, node tests/orchestrator/merge.test.ts, node tests/orchestrator/spawn.test.ts pass and pnpm test passes.

Out of scope: the stall-kill mechanism itself, the config key shape (logStallMinutes stays settable), the dead-pid bounce path, and the splitter/merger/doctor/analyst prompts.

# Notes
