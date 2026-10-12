---
name: "fix: agent cards order by in-log start time, not sweep mtime"
complexity: "simple"
priority: "medium"
state: "doing"
worktree: "fix/139-agent-cards-order"
---

# Summary
Agent history cards must render in true chronological order even after the gzip sweep rewrote the log mtimes. Sort agentHistory entries by the first in-log record timestamp, falling back to mtime for legacy logs with no parseable timestamp.

# Specs
Root cause: compactFinishedLogs (src/orchestrator.ts:306-323, from #123) gzips finished logs into brand-new files (writeFileSync tmp + renameSync to <name>.log.gz + rmSync plain) with fresh sweep-time mtimes, in readdirSync alphabetical order. agentHistory (src/webui.ts:123-160) sorts entries by file mtime (:158), so after any sweep the card order becomes the alphabetical sweep order instead of chronology. Task #121 is the example: its five logs (developer.0, reviewer.0, reviewer.1, live-tester.0, merger.0, all .log.gz) all carry mtime 2026-10-12 07:33:03 within ~250ms, so the card order renders developer, live-tester, merger, reviewer, reviewer while the true order from first-record timestamps is developer 21:42:33Z, reviewer.0 21:58:46Z, reviewer.1 22:00:45Z, live-tester 22:02:45Z, merger 22:15:16Z.

Fix, src/webui.ts plus src/webui.test.ts only:
- agentHistory sorts entries ascending by the first record's in-log timestamp, which logStats already parses per record via tsMs(rec?.timestamp) ?? tsMs(rec?.message?.timestamp) (~:249) but currently only uses for duration = last - first; surface that first timestamp (e.g. return it from the per-file scan or expose a helper) and use it as the primary sort key.
- Fall back to file mtime for logs with no parseable in-log timestamp (legacy unsuffixed logs carry neither), keeping mtime as the secondary key and the existing enumeration order (LOG_ROLES pipeline order, then n ascending via indexRuns) as the final tiebreak so legacy boards render exactly as today.
- Keep everything else intact: the .log/.log.gz handling, runLogPath preference for plain .log, entry fields (role, run, alive, status, handle, tokens, duration), taskPayload/agentCardHtml/renderAgent/fetchSubs behavior, and the gzip sweep itself (no orchestrator changes).

Test: build two fake logs whose mtimes are inverted relative to their first-record timestamps and assert the entries come out in chronological order; assert a timestamp-less legacy log still sorts by mtime; assert the existing agentHistory tests stay green.

# Notes
