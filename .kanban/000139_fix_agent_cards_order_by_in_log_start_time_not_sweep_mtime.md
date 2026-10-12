---
name: "fix: agent cards order by in-log start time, not sweep mtime"
complexity: "simple"
priority: "medium"
state: "done"
worktree: ""
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
- logStats (src/webui.ts) now surfaces first, the first parseable record timestamp in epoch ms, alongside tokens and duration, memoized by size as before.
- agentHistory sorts entries by start ?? mtime, then mtime, then the stable enumeration order (LOG_ROLES pipeline order, legacy unsuffixed file first, index ascending), so legacy timestamp-less boards render exactly as before. Entry fields unchanged, start and mtime stay internal to the sort.
- The sub=list payload strips first so its exact {id, index, tokens, duration} shape stays intact; no orchestrator changes.
- webui.test.ts: new 000139 section builds two .log.gz runs whose mtimes invert their in-log first-record timestamps plus a timestamp-less legacy log between them, and asserts the order developer.1, developer, developer.0. All suites pass: webui, kanban, orchestrator, index, extension.
- Review: sort keys verified against the specs, primary start ?? mtime, secondary mtime, stable enumeration tiebreak; logStats memoizes first by size and the sub=list payload keeps its exact {id, index, tokens, duration} shape; taskPayload agents entries stay stripped of start and mtime; no orchestrator changes. The discriminating test case is real: under the old mtime sort the asserted order would read developer.0, developer, developer.1. All five suites re-run green in the worktree. One fix: the comment introduced the codebase's only em-dash, replaced with the house-style semicolon (commit 8b97adb).
- Live test (real usage, no code edits): the running production hub serves the main checkout, so the test served the board through separate hub instances on test ports, one with the worktree webui.ts (fixed) and one with the main checkout webui.ts (old). Real user flow, verified over HTTP and in a headless Chromium browser.
  - Real board, task 121 (this task's example): the fixed hub renders Developer, Reviewer 1, Reviewer 2, Live-tester, Merger in the card DOM. The old hub renders Developer, Live-tester, Merger, Reviewer 1, Reviewer 2, so the bug reproduces live and the fix corrects it.
  - Independent check of all 137 board tasks: the API order equals the order from the first raw in-log timestamp of each log (mtime fallback for the 55 timestamp-less logs), 0 mismatches. 80 tasks changed order against the old code.
  - Controlled board: 3 timestamped logs with inverted mtimes plus 1 timestamp-less legacy log with its mtime between them. Fixed pre-sweep order developer, reviewer, merger (mtime fallback), live-tester. Old pre-sweep order live-tester, merger, reviewer, developer. After a real compactFinishedLogs sweep the fixed order stays developer, reviewer, live-tester, merger while the old order reads developer, live-tester, reviewer, merger.
  - Legacy-only board (all 4 logs timestamp-less, 1 equal-mtime tie): fixed and old renderings are identical, developer, reviewer, merger, live-tester, the tie broken by enumeration order.
  - No regression: entry fields (role, run, alive, status, handle, tokens, duration) identical old against new over all 137 tasks. /api/agent-log payloads byte-identical for a .gz chunk, offset, before=1, sub=list, sub=n and the 404 cases. sub=list keys stay exactly id, index, tokens, duration.
  - UI behavior: the live card renders last with the spinner (task 139), the dead run shows the cross (task 138), and the 5 s refresh keeps the card order stable (tasks 121 and 138).
  - No issues found. One observed, spec-accepted limitation: a timestamp-less legacy log that the sweep gzips carries the sweep mtime, so it sorts last. This is the prescribed mtime fallback.
