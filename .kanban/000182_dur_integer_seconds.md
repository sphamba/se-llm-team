---
name: "fix: duration labels show integer seconds, no fractions"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "dur-integer-seconds"
blockedBy: ""
---

# Summary
Where time is shown in seconds in the webui (task summary cards' stats line and the agent cards' stats line), show integer seconds, never fractional.

# Specs

## Change
- fmtDur (src/webui.ts:853) is the single shared duration formatter: agent cards' stats lines (agentStatsText) and the task summary cards' card-stats line (taskStatsText -> agentStatsText) both use it, so one change covers both.
- Drop the below-10s one-decimal branch (s < 10 -> s.toFixed(1) + "s") and round seconds to an integer everywhere: sec = Math.round(s), then the existing whole-seconds (< 60 -> "Ns") and minutes branches unchanged. So 3.5s renders as "4s", 0.4s as "0s", 3479 ms as "3s".
- Tokens formatting (fmtTokens) and the k/M display are untouched; duration is still computed in ms server-side (#169 live duration) and only the label rounds.

## Tests
- src/webui.test.ts: update the two assertions pinning fractions — fmtDur(3479) === "3s" (:1282) and the card-stats assertion "2k · 3.5s" becomes "2k · 4s" (:533, the summed 3500 ms rounds after summing). The whole-minute/null assertions stay.

# Notes
- Filed by the PM (user request, 2026-10-12). Runs parallel to the in-flight #181 (pairLayout) and #179 (src/kanban.ts): the touched regions of src/webui.ts and src/webui.test.ts are disjoint per the standing parallelism order.
- Done (2026-10-12, 7343f8f). fmtDur now rounds once (sec = Math.round(ms / 1000)), the below-10s one-decimal branch is gone, comments updated. The spec listed two fraction assertions, but a third existed (src/webui.test.ts:937, syncAgentStats span join with 1200 ms expecting "999 · 1.2s"); updated it to "999 · 1s" too. Full suite (kanban, orchestrator, webui, extension, index) passes.
- Merged (2026-10-12, 83c758f). Step 1: merged main into fix/182-dur-integer-seconds in the worktree (auto-merged src/webui.ts and src/webui.test.ts, no conflicts; fmtDur verified correct in the result). Step 2: merged the branch into main at the root (fast-forward to 83c758f). Both merges clean, so test suites were not re-run; live test runs on the merged commit.
- Live test (2026-10-13, merged 83c758f). Method: hub-only webui (no daemon) from a scratch clone on 127.0.0.1:4390 with an isolated HOME, three done probe tasks with synthetic run logs (1500+2000 ms, 3479+420 ms, 62000+120000 ms), real browser via Playwright.
- All 18 checks pass. Task-card stats lines: "2k · 4s" (1500+2000 ms summed, then rounded; the old "3.5s" is gone), "500 · 4s" (3899 ms), "500 · 3m 2s". Agent-card stats lines: "1k · 2s" (1500 ms), "1k · 2s" (2000 ms), "300 · 3s" (3479 ms), "200 · 0s" (420 ms), "250 · 1m 2s" (62000 ms), "250 · 2m" (120000 ms exact minutes). A scan of the visible text (board and each of the three open detail cards) found no /\d+\.\d+s/ match. GET /api/tasks still returns durations in ms (1500, 420, ...), so only the label rounds. Token labels unchanged ("2k", "1k", "500", "250").
- Live-test assumptions: rounding is half-up via Math.round (3500 ms -> "4s"); 420 ms is the sub-second case; the card duration is rounded once after summing, per Specs. No observed behavior contradicted the task's stated assumptions.
- No issues found; no new tasks filed.

# Open questions

None. Assumptions: rounding is half-up via Math.round (3.5s -> "4s", 0.4s -> "0s"); sub-second durations render as "0s"; server-side duration stays in ms (#169) and only the label rounds.
