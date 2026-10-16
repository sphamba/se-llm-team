---
name: "fix: orchestrator RAM ratchet (whole-log parse churn and never-evicting caches)"
priority: "critical"
state: "doing"
worktree: "fix/250-orchestrator-ram-ratchet"
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
