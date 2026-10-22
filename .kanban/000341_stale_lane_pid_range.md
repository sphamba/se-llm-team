---
name: "test: use a pid above pid_max for the stale lane case"
priority: "low"
state: "done"
worktree: ""
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

## Live test

Lane: test-file change, so no test run. The driver replays the shipped scenario through the production path (`taskHistory` -> `agentAlive` -> `pidAlive`) with the literal read from the merged file. Post tree is this worktree, control tree is `git archive HEAD^` (old literal `"999999"`).

| id | result | post runs | claim | expected | actual | control | control run (pre-fix) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | PASS | 3 | The stale integration-tester lane case writes a pid that no kernel issues, and its neighbours stay as they were. | {"literal":"999999999","olderStaleLiteral":"999999999","liveCaseBefore":true,"rmSyncAfter":true} | {"literal":"999999999","olderStaleLiteral":"999999999","liveCaseBefore":true,"rmSyncAfter":true} | parent tree tests/webui/agentlog.test.ts:521 literal "999999" (measured) | FAIL {"literal":"999999","olderStaleLiteral":"999999999","liveCaseBefore":true,"rmSyncAfter":true} |
| C2 | PASS | 3 | grep -n '"999999"' finds nothing in the test file, so no reachable pid literal is left. | {"matches":0,"exit":1} | {"matches":0,"exit":1} | parent grep '"999999"' on tests/webui/agentlog.test.ts: 1 match at line 521 (measured) | FAIL {"matches":1,"exit":0} |
| C3 | PASS | 3 | git diff --stat names only the test file, so nothing else moved. | {"files":["tests/webui/agentlog.test.ts"],"insertions":1,"deletions":1} | {"files":["tests/webui/agentlog.test.ts"],"insertions":1,"deletions":1} | (n/a: commit metadata, same in both runs; git status --short is empty so no uncommitted path adds scope) | PASS {"files":["tests/webui/agentlog.test.ts"],"insertions":1,"deletions":1} |
| C4 | PASS | 3 | A lane pid file holding this tree's literal, which is above pid_max, leaves the lane run not live through the payload. | {"literal":"999999999","abovePidMax":true,"agent":{"role":"integration-tester","run":0,"alive":false,"status":"ok","tokens":null,"duration":null}} | {"literal":"999999999","abovePidMax":true,"agent":{"role":"integration-tester","run":0,"alive":false,"status":"ok","tokens":null,"duration":null}} | parent literal "999999" vs pid_max 4194304: abovePidMax=false (measured; 999999 is reachable on this host) | FAIL {"literal":"999999","abovePidMax":false,"agent":{"role":"integration-tester","run":0,"alive":false,"status":"ok","tokens":null,"duration":null}} |
| C5 | PASS | 3 | The live lane branch next door still marks the run live, so the case keeps testing both sides. | {"alive":true,"status":"live"} | {"alive":true,"status":"live"} | pid file removed -> {"alive":false} (measured, so the true above comes from the pid file) | PASS {"alive":true,"status":"live"} |

Rows: 5, post runs: 3, control runs: 1, failing rows: 0. The control run is red on C1, C2 and C4 because the pre-fix literal `"999999"` is present, reachable (`<=` pid_max 4194304) and not above pid_max. C3 is commit metadata, so it reads the same in both runs and its control cell says so. C5 passes in both runs, because the merger `process.pid` case is unaffected.

### Assumptions
- The claim is a test literal, so the usage proof is the production path the case calls, replayed with the literal read from the merged file. The test file was not executed.
- The lane fixture is a plain directory with `.kanban/.pids` and `.kanban/.logs` and a task in `integration-testing`, copied from the shipped test part, because the payload reads disk state only for that card.
- `pid_max` is read from `/proc/sys/kernel/pid_max` at run time, not assumed.

### Not exercised
- `node tests/webui/agentlog.test.ts` was not run (no test-run lane). The assertion object, its message, the `rmSync` and the merger `process.pid` case are read from the merged file and replayed, not executed.
- No process at pid 999999 exists on this host, so the pre-fix flake cannot be reproduced here. The control run shows the mechanism instead: 999999 is below pid_max, so a host process at that number would read live.
