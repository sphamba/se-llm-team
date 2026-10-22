---
name: "test: use a pid above pid_max for the stale lane case"
priority: "low"
state: "to-live-test"
worktree: "test/341-stale-lane-pid-range"
issuer: "#337"
complexity: "trivial"
shortName: "stale-lane-pid-range"
---

# Summary
#337's stale lane case writes 999999 to integration-tester.pid to mean "no such process". pid_max on this host is 4194304, so 999999 is a pid the kernel can issue, and a host process at that number would make pidAlive true and fail the assertion. The neighbouring stale case at line 126 already writes 999999999, which no kernel reaches.

# Specs
One literal, in `tests/webui/agentlog.test.ts`:

`writeFileSync(join(lanePids, "integration-tester.pid"), "999999");`

becomes `"999999999"`, the value the older stale case at `tests/webui/agentlog.test.ts:126` already uses.

Why: `pidAlive` falls back to a signal check when the pid file holds a bare pid, so a real host process at 999999 would read live. `/proc/sys/kernel/pid_max` on this host is 4194304, so 999999 is reachable. 999999999 is above any possible pid_max on Linux, so it stays dead on every host.

Change nothing else: keep the assertion, its expected object and its message, keep the `rmSync` of the pid file, and keep the merger case that follows, which uses `process.pid` on purpose.

## Acceptance

1. `node tests/webui/agentlog.test.ts` passes.
2. `grep -n '"999999"' tests/webui/agentlog.test.ts` finds nothing.
3. `git diff --stat` names only `tests/webui/agentlog.test.ts`.

# Notes
Trivial run, no new pin.

## What changed
- `tests/webui/agentlog.test.ts`: the stale lane case now writes `999999999` to `integration-tester.pid`, the value the older stale case uses. That pid is above any Linux `pid_max`, so `pidAlive` stays false on every host. The assertion, its expected object, its message, the `rmSync` and the merger `process.pid` case are unchanged.

## Acceptance
- `node tests/webui/agentlog.test.ts` passes, exit 0.
- `grep -n '"999999"' tests/webui/agentlog.test.ts` finds nothing.
- `git diff --stat` names only `tests/webui/agentlog.test.ts`, 1 insertion and 1 deletion.
