---
name: "fix: clamp the quiet gate's newest mtime to now"
priority: "low"
state: "done"
worktree: ""
issuer: "#295"
complexity: "trivial"
shortName: "clamp-gate-mtime"
---

# Summary
promoteBacklog's quiet gate compares Date.now() against the newest task-file mtime without clamping, so a future mtime (clock skew) keeps all promotion deferred until the clock passes it. The #295 defer logging makes this visible but the clamp is a one-line prevention. Found and recorded by #295, deliberately left out of that fix.

# Specs
# Context

Found during #295 (see its notes, "Latent hole"): promoteBacklog (src/orchestrator/pipeline.ts, the quiet-gate mtime loop) computes `newest` from task-file mtimes and defers while `Date.now() - newest < backlogIdleMinutes * 60_000`. A task file with a future mtime makes that comparison true for the whole skew duration, silently shutting all promotion. No board file has a future mtime today, so this is prevention, not a live defect.

# Change

- In the quiet-gate mtime loop, clamp: `newest = Math.min(newest, Date.now())` (or skip files whose mtime is in the future when computing `newest` — either form, keep it one line of behavior).
- A small test in tests/orchestrator/promote.test.ts: a task file with a future mtime (utimesSync) still promotes on the next sweep; the defer log, if it fires, shows no negative age.

# Acceptance

- tests/orchestrator/promote.test.ts green, other scoped orchestrator suites unaffected (sweep.test.ts at most).
- No behavior change for normal mtimes.

# Notes

Implemented the quiet-gate future-mtime guard in `src/orchestrator/pipeline.ts`: the newest-mtime loop skips any task file whose mtime is in the future, so a clock-skewed file is not treated as fresh board activity on every sweep.

Chose the "skip future files" form over `newest = Math.min(newest, Date.now())`. The clamp still yields an age of 0 on every later sweep while the mtime stays in the future, so the gate would remain shut for the whole skew, the same symptom. Skipping lets the gate open on the next sweep.

Added part BC in `tests/orchestrator/promote.test.ts`: a task aged one hour into the future promotes with `backlogIdleMinutes` 0.01, and the orchestrator log has no negative defer age. Confirmed red before the fix (unexpected deferral, `-3600s ago`), green after.

Suites: `node tests/orchestrator/promote.test.ts` green, `node tests/orchestrator/sweep.test.ts` green. No behavior change for normal mtimes; both suites cover the normal gate paths. Task is `complexity: trivial`, but the Specs require the new test, so it is included.

Commit: `fix(#296): skip future task mtimes in the backlog quiet gate`.

## Live test (2026-10-20)

Lane: daemon end-to-end. Each scenario ran the real orchestrator (`node src/orchestrator.ts --root <fixture> --rescan-seconds 1 --poll-minutes 0.01`) on a git fixture root with a fake agent, `SE_LLM_TEAM_NO_WEBUI=1`, and a fixture `HOME` and `XDG_CONFIG_HOME`. The quiet window was 1 min (`backlogIdleMinutes: 1`), except in the ages-out scenario (3 s). Driver: `/tmp/lt296/driver.mjs` through `/tmp/lt296/run.sh`, log `/tmp/lt296/run.log`.

| # | Scenario | Expected | Observed |
|---|---|---|---|
| A | Merged code, task mtime now + 1 h | Task promotes on the sweep | Promoted 87 ms after start, log `promoting 000001-fix-skewed-mtime.md to to-do (blockers done)`, no negative defer age |
| B | Parent commit `a11bf3a`, task mtime now + 1 h (control) | Task stays backlog, defer log shows a negative age | State stayed `backlog`, log `promotion deferred, newest task write -3600s ago`, no promotion in 14 s |
| C | Merged code, task mtime now, 1 min window | Promotion still deferred | State `backlog` after 8 s, log `promotion deferred, newest task write 0s ago` |
| D | Merged code, skewed file plus a fresh neighbour | The neighbour still defers the whole board | State `backlog` after 6 s, log names the neighbour `000002-feat-fresh-neighbour.md`, no negative age |
| E | Merged code, task mtime now, 3 s window | Defer, then promote when the window closes | Deferred at 0 s, promoted about 3 s later |

Last printed tally: `TALLY: 12 passed, 0 failed`.

Fixture assumptions that shaped the result:

- The fixture writes the task file first and then sets its mtime with `utimesSync` to now + 1 h. No daemon write touches the task before the first sweep.
- `backlogIdleMinutes: 1` makes the window long enough that a fresh normal mtime cannot promote during scenario C or D, so those checks are decisive.
- The fake agent writes one capture line and stays alive. It never spawned in the scenarios that promote: promotion lands about 0.1 s into the first sweep and the check stops the daemon right after, so the agent spawn path stays outside this test. The gate is the only subject.
- The hub was disabled. This change touches only the daemon sweep, so no browser or HTTP path applies.

No behavior contradicts the task's stated assumptions. The note claim "the defer log, if it fires, shows no negative age" holds after the fix (scenario A). The control on `a11bf3a` fails exactly as the task describes, so the check does discriminate the change. Each scenario killed the daemon and the exact `<slug>.pid` and `<slug>.analysis.pid` sidecars, and every pid was gone after the run.
