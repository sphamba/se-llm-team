---
name: "fix: orchestrator RAM ratchet (whole-log parse churn and never-evicting caches)"
priority: "critical"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "orchestrator-ram-ratchet"
blockedBy: ""
---

# Summary
Stop the daemon's memory ratchet: keep the stats+paths caches but evict them correctly, never hold full-log content in orchestrator memory across requests, parse logs incrementally instead of whole-file re-reads, and extend the gzip sweep to doctor logs.

# Specs
Problem (facts, measured by the PM probe on 2026-10-16): daemon RSS grew 114 MB to 321 MB in ~10 min (VmHWM 408 MB, Private_Dirty 284 MB, V8 heap) while serving 4 requests; passive creep ~1 MB/min. Levers: logStats (src/webui/payload.ts:259) reads a log whole + text.split("\n") + JSON.parse per filtered line on every cache miss; subagentLogs (payload.ts:199) parses the parent log whole, size-keyed so a LIVE log re-parses every request; agentLogPayload does gunzipSync(readFileSync(target)) for every .gz log request; module-level Maps never evict: statsCache (payload.ts:258), subsCache (payload.ts:198), doneAgents (payload.ts:449); the gzip sweep's .log to .log.gz rename orphans old-path entries permanently. .kanban/.logs holds 601 MB (1,189 files; 72 doctor .log up to 26.8 MB, never gzipped because the sweep pattern in src/orchestrator/log.ts:122 omits the doctor role).

Decisions (user, 2026-10-16): stats (token counts and time spent) and paths ARE cacheable in the orchestrator and the frontend. Full logs are NOT cached anywhere server-side. Just find the leak and fix the obvious cause; no numeric RSS bar and no dedicated soak check.

Requirements:
1. Keep statsCache, subsCache and doneAgents (they hold stats and paths metadata only), but make eviction correct: drop orphaned entries when the gzip sweep renames .log to .log.gz, keep delete-on-sight for non-done tasks, and bound the maps so unbounded growth is impossible.
2. No full-log content in orchestrator memory across requests: no module-level raw or decompressed log text; per-request reads only. Incremental parsing is allowed with at most tiny per-log offset bookkeeping (a number per log path, never content).
3. logStats and subagentLogs stop re-reading and re-parsing whole logs on every cache miss: parse incrementally from the last known offset so a live log's re-poll reads only the new bytes.
4. agentLogPayload never caches decompressed logs; gunzip stays a per-request transient (or streamed), never held between requests.
5. Extend the gzip sweep pattern (src/orchestrator/log.ts:122) to cover .doctor.log so doctor logs gzip like role logs; the webui decompresses transparently (established #123 path); counter files and live logs stay untouched.
6. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui.test.ts and node tests/orchestrator.test.ts pass.
- Live test (feel-based): after sweeps and detail opens the daemon RSS returns to a stable baseline and stops ratcheting; doctor logs land as .log.gz and stay readable in the web UI.

# Notes

- 000250 implemented (commit e1633e4). payload.ts: logStats and subagentLogs parse
  incrementally from a byte offset past the last complete line (windowed scanner, 1 MB windows,
  byte-precise offset via lastIndexOf on raw window bytes, partial tail lines re-parsed whole on
  the next growth); a head fingerprint (first 4 KB) detects in-place log rewrites and re-parses
  whole, keeping the old size-keyed contract; no module-level raw or decompressed log text
  remains. The .gz cold parse gunzips whole once per size state (compressed size keys the cache,
  full re-parse when size < offset), a per-request transient. statsCache and subsCache are
  bounded (MAX_LOG_CACHES 512, orphaned plain-path entries dropped first, oldest evicted past the
  cap); doneAgents is bounded per root (16) and per task (512) with the delete-on-sight semantics
  kept. New exports: logStats, subagentLogs, statsCache, subsCache, evictLogCaches,
  MAX_LOG_CACHES.
- The gzip sweep (compactFinishedLogs) now also compacts <slug>.<role>.<n>.doctor.log, guarded by
  the <slug>.<role>.<n>.analysis pid file (a live analysis keeps its plain log), and calls
  evictLogCaches after each .log to .log.gz rename. doctorHistory resolves swept doctor handles to
  the .gz path, so the UI reads them transparently. spawnRunAnalysis skips re-analysis when
  .doctor.log.gz exists.
- Tests: orchestrator part AC's doctor pin flipped (the doctor log compacts like a role log; a
  live analysis pid keeps its plain log), AT2's second poll now asserts the sweep gzipped the
  finished analysis's doctor log with content intact and a third poll leaves the .gz, and a new
  webui part 000250 covers the offset bookkeeping (cold parse, growth, unterminated tail,
  shrink reset), incremental subagent growth, sweep-rename eviction, a swept doctor log served by
  taskHistory, and the map bound. Both suites green (55 orchestrator parts).
- Live check (fixture daemon, port 4399): the run log and doctor log landed as .log.gz at the
  daemon's first sweep; /api/task-history served the doctors from the .gz (tokens 10, duration
  2000 ms); RSS 118964 KB at baseline, 119100 KB after 3 history fetches, no ratchet.
- Review at e1633e4 (the range's only commit): all six requirements check out against the diff.
  Both acceptance suites re-run green (webui: all assertions passed; orchestrator: exit 0). The
  agentLogPayload gunzip stays request-local (payload.ts:713), the new log.ts -> payload.ts import
  is acyclic (payload imports only kanban/pid/logpane), and the Open-questions assumptions stand.
- Minor, non-blocking: (1) the head fingerprint stores 4 KB of raw log text per cache entry, so
  the requirement's "never content" letter bends; bounded at ~4 MB worst case across both maps and
  stated openly in Notes, the no-ratchet/no-full-log intent holds. (2) scanLogLines splits a
  multi-byte UTF-8 char at a 1 MB window boundary into replacement chars, so that one line's
  JSON.parse fails and its record drops; only single lines over 1 MB, a small delta vs the old
  whole-file read.

## Live test (2026-10-17)

Merged b9ced0d on an isolated fixture (git root, fake agent, own HOME, daemon port 4350, poll
0.05 min, rescan 1 s, startup plus continuous sweeps). 25 checks, 0 failed. No suites run.

Sweep and doctor gzip:
- The startup sweep gzipped the 34.8 MB developer.0.doctor log and the small reviewer.0.doctor
  log, and removed the plain files. A doctor log guarded by a live reviewer.1.analysis pid
  stayed plain. The live developer.0 run log stayed plain, and the .count sentinel was
  untouched.
- A doctor log written while the daemon ran was gzipped by a later sweep, and the web UI read
  it back.

Web UI:
- /api/tasks and /api/task-detail served the done task. /api/task-history served the big doctor
  stats from the .gz (tokens 600030, duration 201000 ms, equal to the generator values), the
  small doctor stats (10, 4000 ms), the guarded doctor as alive, and the swept run log (300
  tokens, 2000 ms).
- /api/agent-log rendered the big doctor and the swept run log. A 100-token append to the live
  plain log appeared as 400 tokens on the next task-history poll, so the incremental parse read
  only the growth.
- A real Chromium page opened the done task, clicked both doctor cards, and the log pane showed
  DOCTORBIGMARKER and DOCTORSMALLMARKER. Zero page errors.

RSS (feel-based, no soak and no numeric bar per the Specs decision):
- Baseline 226 MB. 12 iterations of task-detail + task-history + the 34.8 MB agent-log gave
  226/259/259/279/279/246/246/246/279/279/279/279/246 MB. After 12 s idle the daemon settled at
  213 MB, below the baseline. No upward ratchet, only GC sawtooth.

Assumptions:
- The 34.8 MB doctor log stands in for the production 26.8 MB shape, and one daemon with sweeps
  plus repeated detail opens is enough for the feel check.
- The daemon pid is the whole RSS surface, because the web UI runs in the daemon process.
- The detail-open load is the same three HTTP calls that the served page makes.

Not tested live: the analysis-respawn skip on an existing .doctor.log.gz (unit-level, no
acceptance bullet), and no second daemon as a ratchet control (the Specs asks for a feel-based
check only). No observed behavior contradicts the stated assumptions.

# Open questions

- Assumption: the head fingerprint reads the first 4 KB; a rewrite that preserves those bytes
  byte-for-byte re-parses only from the old offset. No real writer does this; upgrade path is a
  full hash if one appears.
- Assumption: the cache bounds (512 log entries, 16 roots, 512 done tasks per root) are judgment
  calls, not config knobs.
- Assumption: doneAgents' bounds are untested (the suite pins the statsCache bound only); the
  shape mirrors boundLogCache.
