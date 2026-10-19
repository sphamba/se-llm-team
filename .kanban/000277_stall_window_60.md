---
name: "fix: 60-minute stall window and prompt sentences about tool-call timeouts"
priority: "medium"
state: "live-testing"
worktree: "fix/277-stall-window-60"
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

- Default `DEFAULT_LOG_STALL_MINUTES` 10 -> 60 (src/orchestrator/config.ts) and the README config-table row. config.test.ts part AP now pins 60 for the missing key and both invalid values (the invalid-value warnings are unchanged).
- renderPrompt (src/orchestrator/spawn.ts) gained a required `logStallMinutes` parameter and an unconditional `{{logStallMinutes}}` replaceAll; the spawn call site passes `cfg.logStallMinutes`. agents/developer.md, agents/reviewer.md and agents/live-tester.md each got: "Keep every tool call's timeout under {{logStallMinutes}} minutes: the orchestrator kills your process if your run log is unchanged for that long." Splitter, merger, doctor and analyst prompts untouched.
- New asserts: merge.test.ts renders the reviewer prompt with 60 and asserts "under 60 minutes"; spawn.test.ts asserts the real spawned developer prompt carries "under 60 minutes"; context-symlinks.test.ts passes the third argument.
- Tests written first and confirmed red (config.test.ts: 10 !== 60; merge.test.ts: the reviewer prompt carried no stall window), then green. Scoped suites per policy (not the full `pnpm test`): tests/orchestrator/config.test.ts, poll.test.ts, merge.test.ts, spawn.test.ts, tests/context-symlinks.test.ts all exit 0. Commit bd61285.

- Review at bd61285: config.ts:13 default 60; the invalid-value fallback (:153-157) reads DEFAULT_LOG_STALL_MINUTES and the warning text is unchanged (config.test.ts:211-212 pins it). README config row updated. config.test.ts AP pins 60 for the missing key and both invalid values.
- poll.test.ts: part AN (:167) and part AO (:283) both pass explicit windows (5 and 2) to poll(), so no stall scenario runs against the default; liveness.ts:144 interpolates stallMinutes, so no exact log-line string needed updating. The spec's "part AN runs against the default window" premise is stale; the deviation the former Open-questions bullet recorded is confirmed, no behavior change, suite green.
- Part 2: the three prompts carry the stall sentence; renderPrompt (src/orchestrator/spawn.ts:14) replaces {{logStallMinutes}} unconditionally and the call site (:227) passes cfg.logStallMinutes; every renderPrompt caller carries the third argument (merge.test.ts:441, context-symlinks.test.ts:233, grep-settled). Splitter, merger, doctor and analyst prompts untouched.
- New asserts: merge.test.ts:441-446 renders the reviewer prompt with 60 and asserts "under 60 minutes" (the existing no-placeholder check covers the new token); spawn.test.ts:437 asserts the real spawned developer prompt carries "under 60 minutes".
- Tests: union of 14 suites green - 5 settled from Notes at bd61285 (config, poll, merge, spawn, context-symlinks), 9 run now, all exit 0 (analysis, hub, log, daemon, promote, singleton, split, sweep, worktree). No fixes.

## Live test (2026-10-19)

- Scope: daemon e2e with an isolated fixture (`/tmp/lt277`, log `/tmp/lt277/run.log`). The fake `agent` records each spawned role's prompt. Three phases, 20 checks, 0 failed.
- Default window: the fixture root config has no `logStallMinutes` key. The developer (to-do), reviewer (to-review) and live-tester (to-live-test) rendered prompts each carry the exact sentence "Keep every tool call's timeout under 60 minutes: the orchestrator kills your process if your run log is unchanged for that long." and no `{{...}}` token survives (the reviewer's `{{ROOT}}` render included). This proves the 60-minute default reaches the prompt. The splitter prompt carries no stall sentence and no token. The README config row shows 60.
- Configured window: with `"logStallMinutes": 2` in the root config, the rendered role prompts carry "under 2 minutes" and never the 60-minute sentence.
- Invalid value: with `"logStallMinutes": -3` the daemon logs `logStallMinutes -3 ignored: must be a positive number of minutes` and the rendered developer prompt falls back to the 60-minute sentence.
- The stall-kill mechanism itself is out of scope per the Specs, so no stall window was waited out.
- Assumptions: the checks assert the shipped sentence (the Specs allow refined wording); the fixture pre-creates the to-live-test worktree branch at HEAD so the merged-branch gate passes; `pollMinutes` 0.05 and `--rescan-seconds 1` keep the run fast.
- No findings and no technical difficulties.

