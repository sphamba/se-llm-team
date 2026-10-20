---
name: "fix: poke bypasses the backlog quiet gate and gate deferrals become observable"
priority: "high"
state: "done"
worktree: ""
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

## Developer notes: implementation and the bug 2 chase

What changed:

- `src/orchestrator/main.ts`: the fs.watch listener reads the filename. A `.poke` event calls `scheduleSweep(true)`. A pending forced sweep stays forced across the 500 ms debounce, so a later task event cannot downgrade it. The 10 s timer sweep and the non-poke watch sweeps keep the gate.
- `src/orchestrator/pipeline.ts`: `rescan(root, cfg, force = false)` passes `force` to `promoteBacklog(root, tasks, backlogIdleMinutes, force = false)`, which skips the mtime window when `force` is true. The poll path in `liveness.ts` still calls `promoteBacklog` with no force, so the gate stays there.
- The quiet gate now logs once per defer episode: `promotion deferred, newest task write Ns ago (<file>)`. The episode state is a module-level root set, reset when the gate opens or a forced sweep skips it. The root key keeps the fixtures of one test process apart.
- `docs/architecture.md` now states that a poke bypasses the gate.

Tests, added in `tests/orchestrator/promote.test.ts`:

- Part AZ: a plain sweep defers a fresh PM write and logs the deferral once. A second plain sweep logs nothing. A forced sweep promotes past the window, and a fresh write after the gate opened logs a second episode.
- Part BA, daemon path with `backlogIdleMinutes: 1`: the daemon defers the fresh task, then the poke promotes it well inside the 30 s assert (the gate window is 60 s). The deferral logged once, not once per 1 s sweep.
- Part BB, bug 2 probe: a daemon with an open gate, an aged task and no further board activity promotes the task on its own sweep.

Suites run and green: `tests/orchestrator/promote.test.ts`, `sweep.test.ts`, `poll.test.ts`, `daemon.test.ts`, `singleton.test.ts`.

Bug 2 findings:

- The stall premise does not hold. `.kanban/000293_reviewer_prompt_says.md` has birth time 2026-10-20 21:12:45 +0200 (= 19:12:45Z), the create commit `kanban: create 000293_reviewer_prompt_says.md` is at 21:12:46 +0200, and `git log --all --diff-filter=A` finds one add only. The file did not exist on 2026-10-19.
- The 19:14:08Z promotion came about 83 s after the create. That is the quiet gate (bug 1): #294 was created at 19:12:58, so the gate reopened at 19:13:58 and the next 10 s tick promoted. The log shows no second daemon and no replayed sweep.
- The 15:11:29Z to 19:12:46Z silence in the log is normal. Nothing logs per sweep, and the only backlog task (#221) had open questions, so `promoteBacklog` returned [] silently.
- The three leftover `node --watch src/orchestrator.ts --root /home/phamba/repos/se-llm-team` processes (pids 1763171, 1774105, 2261937) are alive with PPID 1 and no children. They are supervisors that idle after their inner daemon exited, and the log shows each one logged `another orchestrator already runs for this project, exiting`. No lockless sweep path exists: `main` returns before `bootstrapBoard` and the timers when `acquireLock` fails, and every sweep re-checks `holdsLock` and exits.

Latent hole, not fixed (bug 2's spec says to record a finding, not to add a second code change):

- `promoteBacklog` does not clamp `newest` to `Date.now()`. A task file with a future mtime keeps the gate shut until the clock passes that mtime. No board file has a future mtime now (`find .kanban -maxdepth 1 -name '*.md' -newermt now` prints nothing), and the deferral log would show the negative age. The upgrade path is one line: `newest = Math.min(newest, Date.now())`.

After merge:

- The live daemon must restart to load the new code. Then a PM create plus poke shows `promoting <file> to to-do` in `.kanban/.logs/orchestrator.log` within about a second, and a gate deferral shows `promotion deferred, newest task write Ns ago (<file>)` once per episode.

Commits: `fix(#295): poke-forced sweep bypasses the backlog quiet gate and logs deferrals` and `docs(#295): a poke bypasses the backlog quiet gate`.

## Reviewer findings

- Bug 1 fix is correct end to end. `src/orchestrator/main.ts:143` reads the watch filename and calls `scheduleSweep(true)` for `.poke`. `forced ||= force` keeps a pending sweep forced across the debounce. `src/orchestrator/pipeline.ts:540` skips the mtime window when `force` is true. The startup sweep, the 10 s timer sweep and the non-poke watch sweeps keep the gate. The poll path (`src/orchestrator/liveness.ts:234`) still calls `promoteBacklog` with no force.
- The old `watch(kanbanDir(root), scheduleSweep)` form would have passed the event type ("change"/"rename", truthy) as the first argument of `scheduleSweep`. The new arrow wrapper avoids that trap.
- No other gate blocks the poke path. `rescan` has no `return` between its start and the `promoteBacklog` call, so a forced sweep always reaches the promotion.
- Red on revert, green on the fix. I replaced `scheduleSweep(filename === POKE_FILE)` with `scheduleSweep(false)` and ran `tests/orchestrator/promote.test.ts`: exit 1, `timeout waiting for the poke forces the promotion`. With the fix the same suite is exit 0. Part BA therefore covers the reported bug. The worktree is back at `a11bf3a` with a clean tree.
- Bug 2 premise is wrong, and the developer's finding holds. `git log --all --diff-filter=A -- .kanban/000293_reviewer_prompt_says.md` prints one commit only, `0d038fb kanban: create 000293_reviewer_prompt_says.md 2026-10-20 21:12:46 +0200`. `stat` prints birth time `2026-10-20 21:12:45`. The file did not exist on 2026-10-19. `.kanban/.logs/orchestrator.log:11469` promotes it at `19:14:08.140Z`, 83 s after the create: the 60 s gate window plus one 10 s tick. So the observed stall is bug 1. The task body still states a 20-hour stall as proven fact, and I did not rewrite the body.
- The lockless sweep question is settled. `main.ts:89` returns before `bootstrapBoard` and before the timers when `acquireLock` fails, and every `sweep` re-checks `holdsLock` (`main.ts:100-107`). The three `--watch` pids named in the Specs are alive with PPID 1 and no children.
- Tests, all green: `promote` (28 s), `sweep` (55 s), `poll` (23 s), `daemon` (12 s), `singleton` (11 s), `merge` (52 s), `split` (22 s), `spawn` (18 s), `worktree` (55 s), `analysis`, `context-symlinks`. The three tests that the Specs name exist: part AZ (gate intact, one log per episode, forced sweep promotes), part BA (daemon poke path), part BB (idle board promotes with no board activity).
- Non-blocking: the `assert.ok(Date.now() - pokedAtBA < 30_000)` in part BA is dead weight. The `waitFor` before it already fails at 20 s, so the assert cannot catch a regression that the `waitFor` misses.
- Non-blocking: no test pins the debounce preservation that the Specs call out (a non-poke event during the debounce must not downgrade a pending forced sweep). The code is correct by inspection (the `forced ||= force` set plus the reset inside the timeout), but a regression there would stay green.
- Accepted as recorded: the missing `Math.min(newest, Date.now())` clamp stays out of this fix. No board file had a future mtime, and the clamp is not the stall mechanism.
- Durable guidance for future reviewers of this repo: run `tests/orchestrator/promote.test.ts` alone. It spawns daemons and takes about 30 s with a green run and about 90 s when a daemon part times out.

## Live test (2026-10-20)

Fixture: throwaway git root `/tmp/lt295/root` (one board, a fake long-running agent, `pollMinutes: 0.01`, production gate `backlogIdleMinutes: 1`). Daemon: `node src/orchestrator.ts --root <root> --rescan-seconds 1 --poll-minutes 0.01` with `SE_LLM_TEAM_NO_WEBUI=1` and a fixture `HOME` and `XDG_CONFIG_HOME`. Tasks came from the real `createTask`, and the poke used the real `orchestrator_poke` sequence (unlink, then create `.kanban/.poke`). One rerun is `bash /tmp/lt295/run.sh` (setup, launcher, driver, about 95 s). No test suite ran.

Last tally: `TALLY 18 pass, 0 fail`, driver exit 0.

- Bug 1, the reported flow: a PM create, then a poke 200 ms later, promoted `000002_poke_target_task.md` 754 ms after the poke (`20:06:35.65Z` to `20:06:36.400Z`), with the 60 s gate still shut. A PM update that landed 150 ms after the poke did not downgrade the pending forced sweep: the same sweep promoted the older task too.
- Quiet gate intact: with a fresh PM write, 25 s of 1 s timer sweeps and one non-poke watch sweep promoted nothing, and the task stayed `backlog`.
- Deferral log: exactly one line for the episode across about 40 gated sweeps, `promotion deferred, newest task write 0s ago (000001_gate_control_task.md)`. After the forced sweep the next PM write started a second episode with its own line, 233 ms later.
- Bug 2 probe: with no poke and no board activity, the gate opened on its own and promoted `000003_idle_gate_task.md` 60.2 s after the last write. Live, the 20-hour stall did not show up. This agrees with the developer finding that the #293 premise is wrong.
- Shutdown: SIGTERM stopped the daemon, the log has `orchestrator stopped`, the lock file is gone, and every agent pid enumerated from `.pids/` is dead.

Assumptions:

- The fake agent only keeps running, so task-state moves and the orchestrator log are the observables. The spawn argv is not part of this change.
- `--rescan-seconds 1` shortens the observation windows only. The gate window stayed at the production 60 s, so the 0.75 s poke latency and the timer-sweep deferral control stay meaningful.
- The "PM update after the poke" write was a direct append to the task file, which is the same board activity class as `kanban_update`.
- The debounce preservation that the reviewer flagged as unpinned in tests passed live.

No product defect was found for this change.

