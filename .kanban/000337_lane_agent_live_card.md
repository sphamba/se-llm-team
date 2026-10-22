---
name: "fix: the web UI shows the integration-tester as finished while it runs"
priority: "high"
state: "reviewing"
worktree: "fix/337-lane-agent-live-card"
issuer: "user"
complexity: "simple"
shortName: "lane-agent-live-card"
---

# Summary
The web UI decides per-run liveness from agentAlive(root, slug), which reads <slug>.pid, but the merger and integration-tester carry project-wide pid files named after the role. So a live lane agent renders with the finished checkmark, and the log pane also treats its last open line as closed. One shared pid-name rule fixes both, and no test covers a live lane agent today.

# Specs
## Root cause (verified)

`src/webui/payload.ts:179`:

```ts
const live = !!liveRole && agentAlive(root, slug);
```

`agentAlive(root, name)` reads the pid file `<name>.pid`. The slug is right for the developer, reviewer and live-tester, whose pid file is the task slug. It is wrong for the two project-wide lanes: the merger's pid file is `merger` and the integration-tester's is `integration-tester` (src/orchestrator/liveness.ts:28-31 `LANES`; the spawns pass those names at pipeline.ts:300 and pipeline.ts:348).

So for a task in `merging` or `integration-testing`, `agentAlive(root, slug)` is false, every run entry is built with `alive: false` and `status: "ok"` (payload.ts:198-202), and `src/webui/page.ts:876` renders `<span class="check">✓</span>` instead of `<span class="spin"></span>`. The card says finished while the agent runs.

The same wrong assumption sits at `payload.ts:759`:

```ts
const alive = agentAlive(root, found.slug);
```

That flag holds back an unterminated last log line while the run is alive. For the two lanes it is always false, so a half-written line can render. Its comment at lines 755-758 even names the limitation.

The user reported the integration-tester. The merger has the identical bug by the same mechanism, and no test covers a live lane agent: `tests/webui/agentlog.test.ts` never writes a `merger.pid` or an `integration-tester.pid`.

## Specs

1. `src/pid.ts`: add one helper next to `agentAlive`:

```ts
export function agentPidName(role: string | undefined, slug: string): string
```

It returns `role` for the project-wide lane roles (`merger`, `integration-tester`) and `slug` otherwise, with one comment line saying why: a lane runs once per project, so its pid file is named after the role, not the task.

2. `payload.ts:179` becomes `const live = !!liveRole && agentAlive(root, agentPidName(liveRole, slug));`

3. `payload.ts:759` uses the same helper. `agentLogPath` already matches the role in its regex (`m[2]`) and drops it; return it as `role` alongside `path` and `slug`, and use `agentAlive(root, agentPidName(role, slug))`. Fix the stale "liveness is per task slug" ceiling comment so it states what the code now does.

4. Do not touch the orchestrator. `LANES` and the spawn pid names are correct today; the bug is that the UI guessed a different rule.

## Tests

Add to `tests/webui/agentlog.test.ts`, next to the existing run-history case around line 476:

- A task in `integration-testing` with a `<slug>.integration-tester.0.log` run and a live pid file named `integration-tester`: the entry is `alive: true, status: "live"`, and `history.agent` is `{ role: "integration-tester", alive: true, log: "<slug>.integration-tester.0" }`.
- A task in `merging` with a `<slug>.merger.0.log` run and a live pid file named `merger`: same expectation.
- A stale lane pid file (a pid that is not alive) keeps `alive: false`, so the fix does not mark a finished lane run as live.

Write the pid files the way the file already writes its other pids.

## Acceptance

1. `node tests/webui/agentlog.test.ts` passes, including the three new assertions.
2. `node tests/webui/page.test.ts` passes.
3. `node tests/webui/board.test.ts` passes.
4. `grep -n "agentAlive(root, slug)" src/webui/payload.ts` finds nothing.

# Notes
## What changed
- `src/pid.ts`: `agentPidName(role, slug)` next to `agentAlive` returns the role for the two project-wide lanes and the slug otherwise.
- `src/webui/payload.ts`: the live flag of `agentHistory` and the open-line hold of `agentLogPayload` both read liveness through `agentPidName`; `agentLogPath` returns the `role` it already matched, and its "pid file is per task" ceiling comment now states the pid-name rule.
- `src/webui/logpane.ts`: `AGENT_ROLE` maps `merging` to `"merger"` (it had no `merging` key, so the merger lane could never read live whatever its pid file), and `LOG_ROLES` dedupes the merger the map now yields, which keeps today's role order.
- `tests/webui/agentlog.test.ts`: a `000337` section with the three lane cases.

## Acceptance
1. `node tests/webui/agentlog.test.ts` passes. Red first: "a live integration-tester lane pid marks the newest run live" failed with `alive: false, status: 'ok'`.
2. `node tests/webui/page.test.ts` passes.
3. `node tests/webui/board.test.ts` passes.
4. `grep -n "agentAlive(root, slug)" src/webui/payload.ts` finds nothing (grep exit 1).
Extra: `node tests/webui/logpane.test.ts` passes (covers the `AGENT_ROLE`/`LOG_ROLES` edit).

## Notes
- Acceptance item 2 needed one UI fix the Specs did not name: `AGENT_ROLE` had no `merging` key, so `liveRole` was undefined and every merger run read `alive: false` even with the correct pid name. One shared map entry plus a `Set` in `LOG_ROLES` fixes it without touching the orchestrator.
- The stale-pid case runs on the integration-tester task, then the merging case reuses the same root, so the shared rule is proven once and the merger case adds only the role difference.
