---
name: "fix: agent card tokens show input + output (reasoning included)"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Change the token metric the webui agent cards show from the cumulative usage.totalTokens (which adds cache reads and writes) to input + output summed over the run's usage-bearing records. Reasoning is a subset of output in pi's normalized usage, so it is included once; cacheRead/cacheWrite are excluded.

# Specs
The agent cards' token number currently sums usage.totalTokens over every turn_end/assistant record (logStats, src/webui.ts ~:268-269), and totalTokens = input + output + cacheRead + cacheWrite, so cache re-reads dominate the displayed value. The user wants the cards to show the actual processed volume: input tokens + output tokens, where reasoning is already a subset of output (included once, no double count).

Change in logStats (src/webui.ts ~:268):
- Sum rec.message.usage.input + rec.message.usage.output instead of rec.message.usage.totalTokens, guarding both as finite numbers; skip records that lack them.
- The cheap pre-filter line at ~:261 checks for '"totalTokens"' and must also pass records carrying '"input"'/'"output"' (or simply check for '"usage"').
- The one-decimal k/M display format (agentStatsText) is unchanged.
- duration/model/thinkingLevel extraction and the statsCache memoization stay unchanged.

Tests (src/webui.test.ts):
- The fake turn_end records at ~:1059-1060 carry only totalTokens; give them input/output fields and assert the payload tokens equal the input+output sum and exclude cacheRead/cacheWrite.

Files: src/webui.ts, src/webui.test.ts. Keep the #169 live-duration, #142 1s cadence and in-place stats updates untouched.

# Notes

- logStats (src/webui.ts) now sums message.usage input + output per turn_end/assistant record, both guarded as finite numbers; a record lacking either contributes nothing to the token sum. The usage-bearing guard is now input + output, so model/thinkingLevel extraction fires on records carrying input/output (real pi usage records always carry both; the fake totalTokens-only test records were updated accordingly).
- The cheap pre-filter before JSON.parse now passes lines containing "usage" so input/output-bearing records parse.
- The k/M display format (agentStatsText/fmtTokens), duration extraction and the statsCache memoization are untouched.
- Tests (src/webui.test.ts): the 000151 fake turn_end records carry input/output plus cacheRead/cacheWrite, and a new assertion checks the /api/tasks agents payload tokens equal the input+output sum (300), proving cache exclusion. The 000120 stat entry, the subagent transcript and the gzipped-run records got input/output with large cache values and the existing assertions now verify exclusion. Full npm test suite (kanban, orchestrator, webui, extension, index) passes. Committed cacb5a1 on fix/177-agent-card-tokens.
- Review: diff matches the Specs. pi's docs (message-types.md) confirm the reasoning assumption: "When present, `reasoning` is already included in `output`; do not add it again", and assistant messages always contain usage with required input/output numbers, so the input+output usage-bearing guard matches real records. No other totalTokens consumers in src/webui.ts. The meta-extraction coupling (model/thinkingLevel now rides the input+output guard) is a behavior change only for records pi never writes; it is documented above. src/webui.test.ts re-run passes (all assertions). The one-decimal k/M format, statsCache memoization and loadWebUiConfig (imported by orchestrator.ts) are untouched. Reviewer made no fixes.

- Merge: step 1 merged main into fix/177-agent-card-tokens in the worktree; clean (ort strategy), only src/kanban.ts and src/kanban.test.ts carried over from main (unrelated to this task), so test suites were skipped per the clean-merge protocol. Merged commit 966ce04. Step 2 merged fix/177-agent-card-tokens into main at the project root as a fast-forward (e33bf83..966ce04); no conflicts on either side.

- Live test (000177, merged 966ce04, hub-only fixture on an isolated root, scratch HOME and port 4533, real pi JSONL record shapes): PASS. `/api/tasks` agent tokens equal the exact input+output sums: developer 4275 (3621+104 turn_end, +500+40 assistant, +7+3 usage record with no timestamp), reviewer 25, live-tester 15. Excluded and proven absent: cacheRead/cacheWrite (13824/30000/2000/7000/900), the reasoning field (13/10/2, not added a second time), the message_end duplicate of a turn_end usage (17549), a totalTokens-only turn_end (100000/500100), and records whose input or output is null, a string or Infinity. Rendered cards use the unchanged format: "4k · 2m 23s", "25 · 10s", "15 · 4.0s"; the old totalTokens sums would have rendered 168k and 504k. The in-place 1 s poll still refreshes only the stats line (duration 2m 23s -> 2m 28s, token prefix kept). No page errors, no issues found.
- Live-test assumptions: the fixture logs copied pi's real record shape (turn_end/assistant records carry message.usage with input, output, cacheRead, cacheWrite, reasoning, totalTokens), confirmed against real run logs: totalTokens = input+output+cacheRead+cacheWrite and reasoning <= output. Card tokens come from per-run log stats, so the hub-only fixture (no daemon, no agents spawned) is sufficient. Technical note: the documented fixture port 4321 was already bound by a concurrent live-tester, so the test used 4533.

# Open questions
