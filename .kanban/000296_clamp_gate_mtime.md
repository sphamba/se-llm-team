---
name: "fix: clamp the quiet gate's newest mtime to now"
priority: "low"
state: "backlog"
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
