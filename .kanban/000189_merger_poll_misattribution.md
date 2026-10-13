---
name: "fix: poll false-bounces the second task in the merging state"
priority: "medium"
state: "done"
worktree: ""
issuer: "#187"
complexity: "simple"
shortName: "merger-poll-misattribution"
---

# Summary
With two tasks in the merging state, src/orchestrator/liveness.ts attributes the shared .pids/merger.exit to the first task and crash-bounces the second, which gets a false dead marker and dead-count increment even though its merger exited 0. Both tasks still reach to-merge, but the false death record is user-visible and counts toward RESPAWN_CAP.

# Specs
Symptom: with two conflicted to-merge tasks, one poll pass logs for task A "agent exited 0, merging -> to-merge" and for task B "agent pid=0 dead without state update, merging -> to-merge", although task B's merger resolved its merge and exited 0. The poll writes .kanban/.logs/B.merger.0.dead and bumps B's dead counter (clearDeadStreak later logs "run completed, cleared the dead-agent counter" for B only). Root cause: spawnAgent stores the merger pid and exit under the global .kanban/.pids/merger.pid and .kanban/.pids/merger.exit (pidName "merger"), and the poll's dead-pid branch maps every "merging" task to that pair; it clears the exit file after the first task. The stall check already guards with getMergerLogSlug() === slug. Two tasks can be in "merging" at once because the "at most one merger" guard only prevents two live merger processes.

Required behavior: with two tasks in the merging state and one merger at a time, each task must get the outcome of its own merger, and no task may get a false death record.

Fix sketch (developer decides the exact shape): in the poll, handle a merging task only when it is the current merger's task (same getMergerLogSlug() === slug guard as the stall check) and leave the other merging tasks for the sweep, OR keep the merger's slug next to its pid/exit file and match it.

Acceptance: (1) node tests/orchestrator.test.ts passes with a new case: two conflicted to-merge tasks, one merger at a time; after both mergers end, both tasks are in to-merge, no .logs/<slug>.merger.N.dead marker exists for the task whose merger exited 0, its <slug>.dead.count stays 0, and the log contains no "dead without state update" line for it. (2) node tests/kanban.test.ts and node tests/webui.test.ts stay green. (3) Live check: two conflicted merges queued at once produce no false dead line, no .dead marker and no dead-count bump.

Evidence is in /tmp/lt187 (fixture repo, log .kanban/.logs/orchestrator.log around 2026-10-13T08:37:42Z, calls.jsonl, and the task file's live-test report).

# Notes

## 2026-10-13: implemented (worktree fix/189-merger-poll-misattribution, commit bbd7510)

- Root cause: the poll mapped every merging task to the shared .pids/merger.pid/.merger.exit pair. The first task consumed the shared exit 0 and cleared the files, so the second read a missing exit code and crash-bounced with a false dead marker and dead-count bump.
- Fix (spec option 2): the merger spawn now records its task slug in .pids/merger.slug next to the pid/exit files. The poll requeues a merging task the slug file does not name to to-merge without a death record or counter bump, and leaves the shared pair for the task the slug file names. On disk, so the match survives a daemon restart where the old in-memory slug did not.
- A superseded merger's exit code is unrecoverable by design (the superseding spawn clears the shared exit file), so the requeue is the recovery; the retry waits the existing failed-merge idle cooldown (the requeue's setState restarts the mtime clock).
- The stall check still samples only the recorded merger's own per-run log; its guard now reads the slug file, so stall protection also covers a daemon restart mid-merger-run.
- The rescan clears .pids/merger.slug together with the global merger pid once no task is merging and the merger is gone.
- Tests: tests/orchestrator.test.ts new part AU reproduces the buggy interleaving deterministically with two real conflicting merges (sweep, exit, superseding sweep, exit, one poll pass) and asserts both tasks reach to-merge, no .dead marker, no dead-count bump, no "dead without state update" line, and the recorded task consumes its own exit 0. Part AN task 5 now asserts the superseded requeue (merger not killed, no death record), task 6 covers the recorded merger's stall bounce. npm test green (all 5 files). A negative check with the requeue branch disabled reproduced the old false bounce.
- Acceptance 3 (live check: two conflicted merges queued at once) is left for the live-testing stage.

## 2026-10-13: re-verified (resumed session)

- Working tree clean at commit bbd7510. npm test green (exit 0, all 5 files), including part AU (two conflicted to-merge tasks, one merger at a time: both reach to-merge, no .dead marker, no dead-count bump, no "dead without state update" line, the recorded task consumes its own exit 0) and part AN tasks 5-6 (superseded requeue, recorded merger's stall bounce). No new changes; ready for review.

## 2026-10-13: reviewed (bbd7510, no code fixes)

- Traced the requeue branch and every interleaving: superseded exit clobber (part AU shape), daemon restart with and without a slug file, failed merger spawn (no pid), and the requeue-vs-state-move race (the branch re-reads and state-matches before setState). All correct; no death record or counter bump on the requeue path, and the shared pid/exit pair is left for the recorded task.
- The stall-check simplification (guard moved into the requeue branch above) is equivalent; the rescan now clears the slug file with the global merger pid; no stale references to the renamed setMergerLogSlug/getMergerLogSlug remain.
- Nuance worth the record: the requeue also covers a crashed merger whose exit file a subsequent spawn clobbered before any poll (no dead-count bump there). Same "exit code unrecoverable" assumption as above; the retry still waits the failed-merge idle cooldown via the merge-attempt marker + task mtime, so the backoff is preserved by a different mechanism.
- Verified in the worktree: tests/orchestrator.test.ts (incl. new part AU and part AN tasks 5-6), tests/webui.test.ts, tests/kanban.test.ts all pass.
- Added one line to .kanban/AGENTS.reviewer.md (poll fixtures for merging-state tasks must write .pids/merger.slug).

## 2026-10-13: live-tested (bbd7510, merged)

Live e2e on an isolated fixture (scratch origin with refs/heads/meta/kanban deleted, isolated HOME, `--no-webui`): two worktrees c1-wt/c2-wt each change README line 1, main moves the same line, two to-merge probe tasks at once. Role-aware fake-pi merger sleeps 9 s before resolving the conflict and exiting 0, which forces the interleaving where the second merger spawns before the poll consumes the first exit. The same fixture and flow also ran against pre-fix 60d6de6 as a differential control.

Merged (bbd7510):
- after the superseding spawn, the poll logged `000011: its merger run is over (superseded or unrecorded), merging -> to-merge` for the superseded task, then `000012: agent exited 0, merging -> to-merge` for the task the slug file named. Each task got one outcome, no false death.
- no `dead without state update` line (`grep` empty), no `.kanban/.logs/<slug>.merger.N.dead` marker, no `.dead.count` file at all (`find` empty).
- `.pids/merger.slug` recorded `000011` with its pid, then `000012` with the superseding pid; slug, pid and exit files were all cleared once no merger remained.
- both tasks continued `merged into main, set to-live-test` then `live-testing -> done`; final states done.

Pre-fix 60d6de6, identical fixture/flow:
- `000012: agent pid=0 dead without state update, merging -> to-merge` (false death for a merger that exited 0);
- `.kanban/.logs/000012.merger.0.dead` written;
- `000012: run completed, cleared the dead-agent counter` logged for 000012 only, which proves the counter had been bumped and then cleared. Bug reproduced, fix verified.

Assumptions made while designing the test:
- The unit-suite acceptance (part AU etc.) is the developer/reviewer gate; this live test only exercises the real daemon flow of acceptance 3.
- The control run uses the same fixture shape on a separate root with only the daemon code version differing (checked out pre-fix 60d6de6).
- The forced 9 s merger sleep is what makes the superseding spawn land before the poll tick; without it the interleaving is timing-dependent. The observed merged log matched the target interleaving exactly (requeue 2.4 s after the second spawn, recorded task's exit 0 consumed 9 s later).
- The two probe task files are named 000011.md/000012.md (the fixture's shell expansion dropped the suffix); names differ from the #187 fixture, the flow is identical.

No findings, no new tasks. Nothing contradicted the task's stated assumptions. The one nuance confirmed live: the superseded task's exit 0 was indeed unrecoverable (its merger exited 0 but the task was requeued, not moved by exit code), so the requeue is the actual recovery for that task.

# Open questions

No open questions. Assumptions (confirm or correct):
- A merging task whose recorded merger run is gone requeues to to-merge; it is never marked dead and its dead counter stays untouched.
- A superseded merger's exit code is unrecoverable (the superseding spawn clears the shared exit file), so the requeue is the accepted recovery for that task.
- A daemon restart mid-merger-run from a pre-upgrade daemon (no slug file) requeues the in-flight merging task; accepted as a one-time upgrade artifact.