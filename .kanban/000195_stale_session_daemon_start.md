---
name: "fix: a stale pi session can restart the daemon without --watch and silently undo #192"
priority: "medium"
state: "to-do"
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
