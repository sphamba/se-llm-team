---
name: "fix: merging step takes minutes per task and tasks get stuck in merging"
priority: "high"
state: "reviewing"
worktree: "fix/113-merging-step-takes"
---

# Summary
A merger run is a full LLM session (3-11.5 min, mandated suite run) strictly serialized one-per-project, and pid reuse defeats the liveness check so a task can sit in merging forever while the global gate blocks every other merger. Make clean merges fast, make liveness pid-reuse-proof, and take pushMirror off the synchronous loop path.

# Specs
User report (2026-10-11): the merging step takes a long time even for simple merges, and tasks sit stuck in "merging" even though the agent has finished working. One task covers the mitigations.

Root causes (investigated 2026-10-11, code + logs):

A. Long merging time:
1. The merger run is a full LLM session: agents/merger.md step 1 mandates resolving the merge AND running the project's test suites and fixing failures. Measured spawn-to-done: 6m11s (#88), 11m33s (#91), 6m34s (#65), 4m05s (#64), 3m33s for docs-only #90.
2. Strict serialization: the global gate pidAlive(agentPid(root, "merger")) (src/orchestrator.ts:656) allows one merger project-wide; merging tasks are a no-op in rescan (src/orchestrator.ts:780). With 10 tasks in to-merge the last waits 40-50 min. The 5-min idle cooldown applies only to re-queued/failed tasks (gated on the <slug>.merge-attempted marker, src/orchestrator.ts:660) - fresh entries spawn immediately.
3. Handoff tail 5-60s: the next merger needs a rescan (10s) + gate clear (no merging task AND dead merger pid) + the previous pi process fully exiting.
4. pushMirror runs synchronously in the sweep (commitKanban path, execFileSync, 30s timeout, src/orchestrator.ts:285,300) - it currently fails fast (~0.7-0.9s "Host key verification failed", 77 consecutive failures) but a hanging SSH would block the single-threaded loop 30s per changed board file, delaying poll and the next merger spawn.

B. Stuck in merging:
1. PID reuse defeats the liveness check: pidAlive (EPERM = alive) reads merger.pid; this box's pid space wraps (~4M; a reviewer was observed spawned with pid=404). A recycled pid means poll never fires DEAD_TRANSITIONS merging -> to-merge (src/orchestrator.ts:809): the task sits in merging indefinitely AND the :656 gate blocks all mergers project-wide. Zero merging-bounces in 2,219 log lines - the recovery path has never fired in production.
2. Merger dies without setting done: recovery costs poll (<=1 min) + 5-min cooldown + a full 3-11 min re-run (~6-17 min).
3. RESPAWN_CAP=5 give-up: verify against the landed #95 code that a past-cap task still bounces and respawns after the idle cooldown and never strands indefinitely (log lines show historical give-ups for doing/reviewing and counters that grow every poll, e.g. 000072 dead.count=40; confirm these are pre-#95 history, and if the current code still strands, fix it here).

Changes:
1. agents/merger.md: a clean merge (no conflicts) skips the test suites entirely and goes straight to the merge-back; suites run only when the merger had to resolve conflicts (semantic-merge risk). State the reason in the prompt: every branch was already developer-reviewed and live-tested; the suites re-run doubles the merge time for the common case (consistent with the #107 philosophy).
2. src/orchestrator.ts pid-reuse-proof liveness: writePid records the pid AND a discriminator - the process start time from /proc/<pid>/stat (field 22) or, as a fallback, the process cmdline; pidAlive re-reads /proc/<pid> and treats the pid as alive only when the discriminator still matches. A recycled pid then reads dead: poll bounces merging -> to-merge and the :656 gate stops blocking. Non-Linux fallback: if /proc is unreadable, keep today's behavior (never crash).
3. src/orchestrator.ts pushMirror: move it off the synchronous loop path - spawn it detached (child_process.spawn, unref) with the same 30s timeout; the daemon loop never waits on the network. Push results (success/failure count) are still logged and counted, asynchronously.
4. src/orchestrator.ts janitor: when a task leaves merging (or is done), the sweep removes its stale .kanban/.pids/<slug>.merger.pid leftover (the 7 old-scheme leftovers 000038/047/050/054/057/069/072 are unread by current code but clutter .pids/). Never remove a pid file whose process is alive and belongs to a current run.
5. src/orchestrator.test.ts: a recycled pid (simulated: a pid file whose discriminator does not match the live process) reads dead and the task bounces; a clean-merge merger prompt renders without the suite-run instruction and a conflicted one with it; pushMirror no longer blocks the sweep (the sweep completes while the push is in flight).

Acceptance:
- A clean, conflict-free merge no longer runs the test suites (merger prompt only).
- A merger pid recycled by another process is read as dead; the task bounces to to-merge and the gate clears.
- pushMirror never blocks the rescan/poll loop; failures still counted and logged.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

Constraints:
- Files: agents/merger.md, src/orchestrator.ts, src/orchestrator.test.ts.
- Deliberate non-goal: concurrent mergers - two mergers merging back into the same root checkout race the git index; revisit only if the queue still drains too slowly after this task (upgrade path: a config key mergerConcurrency with the merge-back serialized).
- HOLD: none (sequential merges accepted with the in-flight agents/merger.md and orchestrator.ts lanes - #102, #105, #83, #110).

# Notes

Implemented in worktree fix/113-merging-step-takes, commit acfb479 (on top of main c917c6e). All three suites pass: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

- agents/merger.md step 1 now reads: a clean (conflict-free) merge skips the test suites entirely and goes straight to the merge-back, with the stated reason (branches were already developer-reviewed and live-tested; the suites re-run doubles the merge time for the common case); suites run only when conflicts had to be resolved. The instruction is a single static conditional, because the merger only discovers conflicts during its run, so no per-scenario prompt can be rendered at spawn time.
- Liveness is pid-reuse-proof: writePid records "<pid> <discriminator>" where the discriminator is the process start time (parsed from /proc/<pid>/stat field 22 after the last ')', since comm can contain spaces/parens) with the cmdline as fallback. pidAlive(pid, disc?) compares the discriminator when /proc is readable and otherwise falls back to today's kill(pid, 0)/EPERM check, so legacy pid files, the .orchestrator.lock check and the reviewer armed-marker comparison are unchanged; a non-Linux box (no /proc) keeps the old behavior. A new agentAlive(root, name) helper (pid + discriminator from the pid file) replaced agentPid at the merger gate in sweepToMerge, the rescan tail clearPid check and poll. parseInt still reads the first token, so consumeReviewerRun is untouched.
- Ported the in-flight #95 semantics exactly (same helper names, log lines and behavior) so the eventual merge of #113 and #95 is trivial: poll() bounces DEAD_TRANSITIONS unconditionally (the past-cap give-up freeze is gone), bumps the <slug>.dead counter only after the bounce, a completed run clears the counter when a stale pid file existed (hadPid guard so a waiting past-cap task is not wiped), and deadCooldownActive (counter > RESPAWN_CAP AND the task file younger than the idle window) gates the four fresh-agent spawn paths (sweepToMerge, rescan to-do/to-review/to-live-test). The give-up log line is now "agent died 5+ times; respawn waits for the idle cooldown (state <next>)", fired once at cap+1. Spec B.3 answer: the pre-#95 main code did still strand past-cap tasks (no state transition after the give-up), fixed here by the port.
- pushMirror is off the synchronous loop path: it queues doPush (module-level promise chain, so concurrent pushes keep their order and cannot report a spurious non-fast-forward), which spawns git detached+unref with a 30s SIGKILL cap; counters and the PUSH_WARN_AFTER warning are updated asynchronously from the child's close/error. New: in-flight push children are tracked and SIGKILLed on daemon exit, because a stopped daemon's kill timer dies with it and would leave an orphaned hanging git push forever (this also made the test suite hang; the old suite exits 0, verified).
- Janitor: janitorPids removes stale .kanban/.pids/<slug>.merger.pid leftovers (old per-task merger scheme) whose process is dead, skips a task still in merging and never removes a live process's pid file. The 7 production leftovers are cleaned on the next sweep.
- Tests added/changed: part A waits for the detached push to land before the origin ref compare; part B ported to six unconditional bounces + one cooldown log + aged-mtime release + counter intact during the wait; parts E/I/R switched from the "giving up" log to the cooldown log (part I asserts the bounced task parks in to-do); new part AC (completed run clears a stale dead counter), part AD (recycled pid: unit pidAlive assertions plus a doing task whose pid file names the live test process with a stale discriminator bounces, while the matching-discriminator control never bounces), part AE (merger prompt recorded via a recording stub asserts the clean-merge skip, the conflicted-branch suite run and rendered placeholders), part AF (a silent-TCP origin holds the push in flight while the pipeline still completes and the 30s cap still counts and logs the failure).

Deliberate non-goal respected: no concurrent mergers (the global merger gate stays; revisit via a mergerConcurrency config key if the queue still drains too slowly).

Review 2026-10-11 (worktree fix/113-merging-step-takes): implementation matches the Specs. Checked the /proc/<pid>/stat parse against a live process (starttime field read correctly, matching discriminator alive, mismatched dead, legacy pid-only file and dead pid both fall back correctly), the two-token pid file compatibility with parseInt readers (agentPid, consumeReviewerRun armed-marker compare, webui currentPid, lock readers), and that janitorPids cannot touch the global merger pid (merger.pid does not end in .merger.pid) or a current-scheme <slug>.pid. Poll counter logic re-traced: the hadPid guard protects a waiting past-cap task's counter, the bounce is unconditional and the counter bumps after the setState, single-threaded so no rescan can interleave. One fix committed on top (fe9a5f6): merger.md step 1 ordered "go straight to step 2" before "Complete the merge, stage the resolved files and commit", which read as contradictory sequencing; the merge-and-commit now comes first, then the suite-run conditional. All three suites pass after the fix (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts). Out-of-scope notes for follow-up, not fixed here: (1) the .orchestrator.lock file is still pid-only, so a recycled daemon pid would make acquireLock refuse to start the daemon, same root cause class but a different file and reader set (acquireLock/releaseLock/holdsLock/removeTask, hub.ts); (2) the webui's pidAlive mirror is not discriminator-aware, so a recycled pid could show a stale live badge, cosmetic only since the poll bounces the task and the state change re-renders the board.
