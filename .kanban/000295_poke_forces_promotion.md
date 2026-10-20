---
name: "fix: poke bypasses the backlog quiet gate and gate deferrals become observable"
priority: "high"
state: "doing"
worktree: "fix/295-poke-forces-promotion"
issuer: "user"
complexity: "moderate"
shortName: "poke-forces-promotion"
---

# Summary
A poke triggers a sweep but promotion still rides the backlog quiet gate, so the promised immediate scheduling lands ~1 minute late whenever the PM wrote a task file just before poking. Make the poke-triggered sweep bypass the gate and log gate deferrals, then use that observability to chase the proven 20-hour promotion stall.

# Specs
# Bug 1 (confirmed): poke does not schedule immediately

User report: "The orchestrator poke from the PM doesn't seem to trigger immediate scheduling into to-do. I still wait like a minute."

Mechanism (verified in code):

- orchestrator_poke (src/tools.ts:283-297) touches `.kanban/.poke`; its description promises "immediate scan and agent scheduling".
- The daemon's fs.watch handler (src/orchestrator/main.ts) runs scheduleSweep -> sweep() -> rescan(root, cfg) -> promoteBacklog(root, current, cfg.backlogIdleMinutes) (src/orchestrator/pipeline.ts:457).
- The quiet gate (src/orchestrator/pipeline.ts:537-559) defers ALL promotion while any task file's mtime is younger than backlogIdleMinutes (default 1 minute, src/orchestrator/config.ts:9). isSelfWrite masks only the daemon's own writes; the PM session's kanban_create/kanban_update are a different process and always count as board activity.
- A poke almost always follows a PM write (create/update a task, then poke), so the poke's own sweep is gated and the user waits up to ~1 minute. Exactly the reported behavior.

# Required fix

A poke-triggered sweep must bypass the quiet gate. A poke is the PM's explicit "I am done editing, schedule now".

- Recommended wiring: the fs.watch listener receives (eventType, filename); when filename === ".poke", schedule the sweep as forced; thread the flag sweep(force) -> rescan(root, cfg, force) -> promoteBacklog(root, current, cfg.backlogIdleMinutes, force), which skips the mtime window when force.
- Do not lose the forced-ness: scheduleSweep currently clearTimeouts the pending sweep on every event, so a non-poke event arriving within the 500 ms debounce would downgrade a pending forced sweep to a normal one. Keep the pending sweep forced once a poke requested it.
- Timer sweeps (every 10 s) and non-poke watch sweeps keep the gate unchanged.

# Observability (needed for bug 2)

When the quiet gate defers promotion, log it once per defer episode (on the open->deferred flip, not per sweep; sweeps run every 10 s and would spam): e.g. `promotion deferred, newest task write Ns ago (<file>)`. Reset the episode state when the gate opens again.

# Bug 2 (proven, mechanism unknown): the 20-hour promotion stall

Task #293 (backlog, no blockedBy, empty open questions, trivial) sat unpromoted from creation (2026-10-19 ~21:47 CEST) until 2026-10-20 19:14:08Z. Evidence:

- The daemon (pid 164752) started 15:08:15Z; the newest task-file mtime at its startup sweep was 15:06:45Z (#292's done write, 90 s old), so the quiet gate was open, and it stayed open (board idle, no writes 15:11:29Z -> 19:12:46Z).
- With an open gate promotion is same-sweep fast (proven live: blocker drop and promotion of #294 23 ms apart at 19:17:17Z).
- No "promoting", no "promotion ... failed", no "error handling" lines in the log for #293 in that window; the daemon never crashed.
- So promoteBacklog either did not run or returned [] for ~4 h with an open gate. The startup sweep and the 10 s timer sweeps both call it.

With the defer logging from this task, run the live daemon and try to reproduce: a fixture daemon (fast delay profile) with a schedulable backlog task and NO further board activity must promote within one sweep; a poke during the fresh-write window must promote immediately after the poke. If the stall mechanism shows up, fix it; if the fixture cannot reproduce, record that on the task. The three leftover `node --watch src/orchestrator.ts --root <this repo>` processes (pids 1763171, 1774105, 2261937) hold no lock; check whether a --watch child can sweep without the lock and say so on the task.

# Tests

- Daemon-path test: PM-style task write younger than the gate window, then touch .poke -> the task reaches to-do within ~1 s of sweeps (fast delay profile), not a full gate window.
- Gate intact: a normal (non-poke) sweep right after a fresh PM write still defers.
- The defer log line fires once per episode, not per sweep.

# Acceptance

- Scoped suites green (tests/orchestrator/*), including the new tests.
- On this repo after merge: file a throwaway-grade check is not required; the next PM create+poke cycle must promote in seconds, visible in .kanban/.logs/orchestrator.log.

# Notes

## No-split decision (Splitter)

Kept as one task, not split.

- Bug 1 is one flag threaded through one call chain: `watch` -> `scheduleSweep` -> `sweep` -> `rescan` -> `promoteBacklog`. That is 2 source files (`src/orchestrator/main.ts`, `src/orchestrator/pipeline.ts`) plus a log line. There is no second lane to fill.
- Bug 2 cannot run in parallel. It needs the bug 1 defer log and the merged code to reproduce on a live daemon. As its own subtask it would be blocked by bug 1, so it would grow pipeline overhead (review, merge, live test) with zero time saved, and it would fight bug 1 for the same lines of `pipeline.ts`.
- Bug 2 is mostly an investigation. If the fixture cannot reproduce the stall, the outcome is a finding written on this task, not a second code change. A subtask needs a worktree and a full pipeline for that, which is too much for the value.

Guidance for future splitters of this board:

- Do not split a "fix X, then use the fix to chase Y" task. The chase is follow-up work on the same files, not a parallel lane.
- `promoteBacklog` has a third call site: `src/orchestrator/liveness.ts` (poll path). The developer must keep the gate there. Only the poke watch path is forced. Do not add `force` to the poll call.
- The promotion tests live in `tests/orchestrator/promote.test.ts` and `tests/orchestrator/sweep.test.ts`.
