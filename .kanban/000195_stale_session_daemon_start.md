---
name: "fix: a stale pi session can restart the daemon without --watch and silently undo #192"
priority: "medium"
state: "done"
worktree: ""
issuer: "#192"
complexity: "simple"
shortName: "stale-session-daemon-start"
---

# Summary
#192 makes orchestrator_start spawn the daemon under node --watch, but pi loads extension code at session start and only applies changes after /reload (docs/extensions.md). Any session started before the #192 merge therefore spawns the old unwatched daemon on the next orchestrator_stop + orchestrator_start, silently regressing the self-restart. Found in #192's live test (the claim that the production daemon already ran under --watch was false); the live board was repaired from a fresh session. Document the session-restart/reload requirement and/or make orchestrator_start warn when the running daemon has no --watch supervisor.

# Specs
## The trap

`orchestrator_start` (index.ts) spawns the daemon as `node --watch <extDir>/src/orchestrator.ts --root <root>` since #192. But pi loads extension code at session start and applies a changed extension only after `/reload` (docs/extensions.md). A pi session started before the #192 merge keeps the pre-#192 `orchestrator_start`, so `orchestrator_stop` + `orchestrator_start` from such a session spawns an unwatched daemon. That daemon then survives merges that change src/, silently undoing #192 — with no error and no log line.

## Evidence (from #192's live test, 2026-10-13)

- The production daemon at lock pid 758169 had PPID 1 and no `node --watch` supervisor process; it survived main moving to 077c67c (#193 merge, 13:24) and to 0bf8fed (#190 merge, 13:30) with no restart line in .kanban/.logs/orchestrator.log.
- The daemon had been started at 12:46 by a long-lived pi session whose loaded extension code predated the #192 merge (13:14), so the #192 hygiene claim in its Notes was inert.
- Repaired during the live test from a fresh pi session: stop then start produced supervisor 868290 with child 868359 under `--watch`; an mtime-only `touch src/kanban.ts` then changed the lock pid and the webui answered 200 on port 4242.

## Exact repro

1. In a pi session started before the #192 merge, call `orchestrator_stop` then `orchestrator_start`.
2. Read the lock pid (.kanban/.orchestrator.lock) and inspect `ps -o pid,ppid,args -p <pid>` plus its parent: no `node --watch` in the process tree.
3. `touch src/kanban.ts`: the lock pid does not change (contrast: with a `--watch` supervisor it does).
4. Repeat the same stop + start from a fresh session or after `/reload`: the supervisor runs `node --watch` and step 3 restarts the daemon.

## Smallest useful remedy (developer's judgement, pick one and keep it small)

- A README/SKILL.md hygiene line: after an extension merge, restart the pi session or run `/reload` before using `orchestrator_stop`/`orchestrator_start`; or
- A warning from `orchestrator_start` when a daemon is already alive whose process tree carries no `node --watch` supervisor (guard the non-Linux/no-/proc case so it does not mis-warn).

Either way the trap must be spelled out where a PM would hit it. No change to the `--watch` spawn itself.

## Acceptance

- The chosen remedy ships: the doc line is present or the warning fires exactly when the running daemon lacks a `--watch` supervisor and stays silent for a watched one.
- If code changes, the existing suites still pass and a test covers the warn/silent cases.

# Notes

Implemented the warning remedy (option 2 of the Smallest useful remedy list).

- `src/pid.ts`: added `procPpid` (stat field 4) and exported `orchestratorWatched(pid)`: true when the pid runs an orchestrator daemon (its cmdline carries `orchestrator.ts`) whose parent process is a `node --watch` supervisor (the parent's cmdline carries `--watch`, the 000192 spawn shape); false when the daemon's parent is gone or carries no `--watch`; null when /proc is unreadable (non-Linux) or the lock pid is no orchestrator daemon at all, so the caller stays silent instead of mis-warning.
- `index.ts`: `orchestrator_start`'s already-running early return now warns when `orchestratorWatched(pid) === false`: "Orchestrator already running (pid N) without a node --watch supervisor: a merge that changes src/ will not restart it. Stop the orchestrator, then start it again to restore the self-restart." Watched daemons and undecidable cases keep the plain "already running" line. No change to the `--watch` spawn itself.
- `index.test.ts`: three new cases. Warn: a real child whose cmdline carries `orchestrator.ts` with no `--watch` parent (lock = its pid) gets the warning and no new spawn. Silent (watched): a detached `node --watch` supervisor with a daemon child writing its own pid (the production spawn shape; the fixture dir needs a `package.json` with `"type": "module"`, otherwise node loads the `.ts` fixture as CJS and the child dies) keeps the plain line. Silent (undecidable): a lock pid that is no daemon (the test process itself) keeps the plain line.
- Detection shape verified live on this machine before coding: `node --watch <script>` runs a supervisor (cmdline `node --watch <script>`) plus a daemon child (cmdline carries the script path, no `--watch`); the lock pid is the child, so the child's ppid + the parent's cmdline decide.
- Verification: `npm test` all five suites pass, `npm run test:changed` passes (3 suites), `index.test.ts` re-run 3 times stable with no leaked fixtures. No typecheck command in this repo (see the SKILL rule); the module graph of index.ts is exercised by index.test.ts.
- Not done, deliberately: no README/SKILL.md line (the specs say pick one remedy), no `orchestrator_status` warning (the specs name `orchestrator_start` only), no change to the tool description or to the `--watch` spawn.

## Review (2026-10-13, no fixes needed)

- Detection shape verified live: under `node --watch`, the daemon child's ppid is the supervisor and the supervisor's cmdline carries `--watch`; the lock pid is the child (orchestrator main.ts writes its own `process.pid`). `procPpid` parses stat field 4 correctly (index 1 after the last `)`).
- Warning/silent semantics match the spec's option 2: `orchestratorWatched` returns null for a non-Linux /proc or a non-daemon lock pid (silent), false when the parent is gone or carries no `--watch` (warn), true only for the production spawn shape.
- Tests: index.test.ts covers warn, silent (watched), and silent (undecidable); re-run 3 times stable, full `npm test` passes (all five suites), no leaked test processes after runs.
- Observation, no fix: an assert abort inside the 000195 try blocks skips the top-level rmSync for orchDir/watchDir and leaks /tmp fixture dirs (stale dirs from a pre-package.json run were present at review time; harmless, boot-cleaned). Same leak shape as the pre-existing repo/plain cleanup.
- Observation, no fix: the parent cmdline check carries no start-time discriminator, so a parent-pid reuse could in theory flip the verdict. A heuristic warning, not liveness-critical; fine as shipped.
- README line 70 documents the hand-start path (`node src/orchestrator.ts --root <project>`), so assumption 3 in Open questions holds: a hand-started daemon gets the warning, and it genuinely lacks the merge self-restart.

## Live test (2026-10-13, no issues found)

Ran the merged code (7414f4b, main == worktree == 7414f4b) from the real user interface: fresh `pi -p --mode json` sessions in a scratch git root (`/tmp/lt195/repo`, one commit, empty board, isolated from the real board) calling the `orchestrator_start` tool. No suites were run. The fixture daemons used the same argv shapes as a stale session's spawn and the 000192 spawn, and were inspected with `ps -o pid,ppid,args` before each call.

- Warn, stale-session shape (exact pre-`a032ace` argv: bare daemon, no `--watch`): daemon started as `node <cwd>/src/orchestrator.ts --root ...`, lock pid 911031, parent a non-watch bash. `orchestrator_start` returned exactly: `Orchestrator already running (pid 911031) without a node --watch supervisor: a merge that changes src/ will not restart it. Stop the orchestrator, then start it again to restore the self-restart.` Lock pid unchanged after the call (no new spawn).
- Warn, supervisor killed (the #192 evidence shape, PPID 1): a `node --watch` supervisor 911908 spawned via `orchestrator_start`, `kill -9` on the supervisor; the daemon child 911914 survived and reparented to `/sbin/init`, lock pid still 911914. `orchestrator_start` returned the same warning for pid 911914.
- Silent, watched: `node --watch <cwd>/src/orchestrator.ts --root ...` supervisor 911367 with daemon child 911373. `orchestrator_start` returned exactly `Orchestrator already running (pid 911373)`, no warning, no new spawn.
- Silent, undecidable (non-daemon lock pid): lock file held a live `sleep 600` pid 911639. `orchestrator_start` returned exactly `Orchestrator already running (pid 911639)`, no warning.
- Start path regression: with a dead lock pid in place, a fresh session returned `Orchestrator starting (pid 911908), log: ...` and the spawned tree was supervisor 911908 (`node --watch /home/phamba/.pi/agent/extensions/se-llm-team/src/orchestrator.ts`) with daemon child 911914 (lock pid), both linked to the fixture root. So the merged code spawns watched daemons end to end and the warn/silent verdict matches that shape.
- The loaded extension came from `~/.pi/agent/extensions/se-llm-team -> /home/phamba/repos/se-llm-team` (main checkout at the merged commit), which is what a fresh PM session loads.

Assumptions made while designing the tests:

- A hand-started daemon is a faithful stand-in for a stale session's spawn: the pre-`a032ace` code spawned `[src/orchestrator.ts, --root, root]` with no `--watch` (verified with `git show a032ace^:index.ts`), which is the argv observed here. Detection is process-shape based, so the parent being a shell instead of a pi process does not change the verdict; the PPID-1 case was tested separately.
- The commandline test used the worktree path for hand-started daemons and the symlinked extension path for the `orchestrator_start` spawn; both carry `orchestrator.ts`, which is the discriminator the Specs name.

Technical notes (no user-visible issue):

- A hand-started daemon needs `.kanban/.logs/` to exist before shell redirection; the extension creates it, manual test setup must too (first attempt failed with `No such file or directory`, fixed by `mkdir -p` before the start).
- One `pi -p` invocation was run without `SE_LLM_TEAM_NO_WEBUI=1`, so its spawned fixture daemon registered `/tmp/lt195/repo` with the production hub on 4242 (expected behavior, nothing bound because the real hub holds the port). After the fixture daemon was killed, the hub pruned the entry within its 15 s stale window; `~/.pi/agent/se-llm-team-hub.json` is back to only the real project. No client/PM action needed; the recipe now lives in the live-tester AGENTS.md.
- The production daemon was untouched throughout: lock pid 909122 under `--watch` supervisor 868290, and the fixture board stayed empty so no agent spawned.

# Open questions

Assumptions made (confirm or correct):

- The warning is the chosen remedy (option 2), not the README/SKILL.md line: it fires at a touchpoint every fresh PM session hits (skill step 7 calls orchestrator_start), while a doc line cannot reach the stale session that causes the trap (its context is frozen at session start).
- A stale session never sees the warning (its loaded extension code predates it), so the warning targets fresh sessions: it flags any unwatched daemon already running, however it was spawned.
- A daemon started by hand (`node src/orchestrator.ts --root <project>`, documented in the README) also gets the warning, since it genuinely lacks the merge self-restart.
- The warning is tool output text only (no ui.notify): the PM agent reads the orchestrator_start result directly.
