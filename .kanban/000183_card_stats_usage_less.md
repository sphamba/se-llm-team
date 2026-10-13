---
name: "fix: summary cards of usage-less runs show 0 · Ns instead of just Ns"
priority: "medium"
state: "done"
worktree: ""
issuer: "#178"
complexity: "simple"
shortName: "card-stats-usage-less"
blockedBy: ""
---

# Summary
A task whose agent entries carry a duration but no usage record (legacy/no-usage logs, or every live run before its first usage record) shows "0 · Ns" on its summary card. Decided (user, 2026-10-12): such usage-less runs show NO stats line at all on the summary card. Finding reported by #178's live test.

# Specs
## Change
- taskStatsText (src/webui.ts, next to agentStatsText, ~:871) sums the agents array's tokens per entry with non-number fields counting as 0, so a usage-less task sums to 0 and fmtTokens(0) renders "0" ahead of the duration.
- Decided acceptance (user, 2026-10-12): a task with NO usage-bearing entry shows nothing on the summary card — no tokens part, no duration part, the whole .card-stats line hidden. Track whether any entry carries a finite numeric token count; when none does, return "" (the line is hidden).
- Tasks with at least one usage-bearing entry keep the current behavior unchanged: the summed input + output tokens and time across all entries.
- agentStatsText/fmtTokens/fmtDur are untouched; the .card-stats styling, card placement after the chips (#178), modal agent cards and syncBoard mechanics stay unchanged.

## Tests
- src/webui.test.ts: extend the #178 card-stats block with an assertion that entries carrying durations but no numeric tokens render no stats line at all (no "0 · 1s", no "1s"), keeping the summed-totals, hiding and css assertions intact.

# Notes
- Filed by the PM from #178's live-test finding (2026-10-12), hand-written with blockedBy "#182" because #182 is in doing and both tasks touch the card-stats assertions near src/webui.test.ts:533 and adjacent functions in src/webui.ts.
- Implemented in worktree fix/183-card-stats-usage-less, commit 5386def: taskStatsText returns "" unless some entry carries a finite numeric tokens field (logStats writes null for usage-less logs); doc comment updated. Test added at src/webui.test.ts:535: entries with tokens: null + duration, and duration only, render no card-stats line. npm test passes (all files).

## Assumptions
- "Usage-bearing entry" means an agent entry with a finite numeric tokens field; a tokens: null entry (logStats with no usage record) or one with no tokens field counts as usage-less. An entry whose real usage record sums to 0 keeps the current summed-totals line.

## Review
- Review pass 1: implementation matches the specs. taskStatsText returns "" when no entry carries a finite numeric tokens field (Number.isFinite check matches the stated assumptions, tokens: null and missing-field entries count as usage-less), tasks with a usage-bearing entry keep the summed behavior, agentStatsText/fmtTokens/fmtDur untouched, taskStatsText's only caller is cardHtml so the whole .card-stats span disappears. Doc comment updated. Test asserts no "card-stats" at all, stronger than the spec's "no 0 · 1s, no 1s"; summed-totals, hiding and css assertions intact.
- Fixed in commit 363325e: the new test line ended with a comma instead of a semicolon, joining it with the css assert into one comma-operator statement; semicolon restored, webui.test.ts re-run passes. No silent assumptions found: the tokens: 0 edge (a real usage record summing to 0) renders the summed line per the spec's finite-token-count rule, and it is stated in Assumptions.

## Merge
- Base branch at merge time: main. Step 1, main into fix/183-card-stats-usage-less in the worktree: already up to date (main was fully contained in the branch), no conflicts, test suites skipped per the clean-merge rule.
- Step 2, fix/183-card-stats-usage-less into main in the project root: fast-forward b2566ae..363325e, clean, no conflicts. Merged commit on main: 363325e (carries 5386def). Verified the finite-token check in taskStatsText (src/webui.ts:872) and the 000183 assert (src/webui.test.ts:535) are on main.
- Live test (2026-10-13, merged 363325e). Method: hub-only webui (no daemon, no agents) on 127.0.0.1:4488 with an isolated HOME and root, four probe tasks with synthetic run logs in real pi record shapes, real browser via Playwright. Probes: (1) done usage-less run, developer tokens null / duration 3000 ms; (2) done usage task, developer 420 tok / 1500 ms + reviewer 1580 tok / 2000 ms; (3) done run whose real usage record sums to 0, developer 0 tok / 3000 ms; (4) live doing task before its first usage record, session-only log + live sleep pid.
- All 15 card checks and 3 transition checks pass. Board: probe 1 renders no .card-stats element at all (old bug was "0 · 3s"); probe 2 renders "2k · 4s" (tokens 420+1580=2000, durations 1500+2000 ms rounded once) with display:block; probe 3 renders "0 · 3s" per the stated finite-token-count assumption; probe 4 renders no .card-stats and still none after a 5 s poll with its live spinner alive. A board-wide scan found the only "0 ·" tokens part on probe 3. Transition: appending a first 345-token usage record to the live run's log made "345 · 3m 5s" appear on the next poll while the usage-less card stayed hidden. Modal agent cards unchanged: usage-less "3s" (duration only), usage "420 · 2s" and "2k · 2s", zero-usage "0 · 3s", live usage-less "2m 30s"; no summary .card-stats inside any modal. GET /api/tasks returned the expected agents data (tokens null/0/420/1580 and durations in ms).
- Live-test assumptions: "usage-bearing entry" means a finite numeric tokens field, so tokens:null and missing-field entries count as usage-less (matches the Notes Assumptions); a real usage record summing to 0 keeps the summed "0 · Ns" line by design; live durations tick from the session record. No observed behavior contradicted the task's stated assumptions. No issues found; no new tasks filed.
