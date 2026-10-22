---
name: "fix: the web UI shows the integration-tester as finished while it runs"
priority: "high"
state: "done"
worktree: ""
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

Review of 1af61c1 (first pass):
- `src/pid.ts:93` `agentPidName` returns the role for `merger`/`integration-tester` and the slug otherwise, with the why on `src/pid.ts:92`; both call sites use it: `src/webui/payload.ts:179` (live flag) and `src/webui/payload.ts:761` (open-line hold). `agentLogPath` returns the `role` it matched (`src/webui/payload.ts:266`) and its ceiling comment names the new pid-name rule (`src/webui/payload.ts:252-253`).
- `grep -n "agentAlive(root, slug)" src/webui/payload.ts` exits 1: no stale call site remains.
- `src/webui/logpane.ts:12` adds `merging: "merger"`, which the Specs' merger expectation needs (before it `liveRole` was undefined for a merging task and `history.agent` was null). `src/webui/logpane.ts:19` still resolves `LOG_ROLES` to splitter, developer, reviewer, live-tester, integration-tester, merger, doctor, so the enumerated role order and tie-break are unchanged.
- `tests/webui/agentlog.test.ts:500-538` covers a live integration-tester lane, a stale lane pid and a live merger lane through `taskHistory`, asserting `agents` and `history.agent`; the diff stat names no orchestrator file, so Specs item 4 holds.
Test: agentlog exit=0, page exit=0, board exit=0, logpane exit=0, hub exit=0.
Note: `tests/webui/agentlog.test.ts:521` writes `999999`, a valid pid number, while the neighbouring stale case at `tests/webui/agentlog.test.ts:126` writes `999999999`; a host process at that pid would flip the stale assertion. Upgrade path: write `999999999`.
Note: the `src/webui/logpane.ts` edit sits outside the Specs' numbered items but is required by the Specs' own merger case and is stated in `# Notes`; no action.


## Live test (usage) 000337

Harness: `/tmp/lt337` (`driver.mjs`, `run.sh`, `gen-report.mjs`, `run.log`). Each run gets a fresh hub-only git root. The fixture uses the merged tree's `createTask` and `setState` to make two tasks: `000001_live_lane_it` in `integration-testing` with a `<slug>.integration-tester.0.log` run, and `000002_live_lane_member` in `merging` with a `<slug>.merger.0.log` run. The real hub serves the page (`startHub`, port 0) and a headless Chromium clicks each task card, waits for `#m-agent-btns .agent-card[data-handle]`, and reads the mark span class and its computed `animation-name`. A live keeper process holds each lane pid file. The stale case writes `999999999`. Three scored runs plus one control run on the pre-fix tree (`git archive HEAD^`).

| id | claim | expected | actual (scored run 1) | control (pre-fix tree) | pass |
| --- | --- | --- | --- | --- | --- |
| C1 | a live integration-tester lane pid marks its newest run live | {"agents":{"role":"integration-tester","run":0,"alive":true,"status":"live","handle":"000001_live_lane_it.integration-tester.0","tokens":null,"duration":null},"agent":{"role":"integration-tester","alive":true,"log":"000001_live_lane_it.integration-tester.0"}} | {"agents":{"role":"integration-tester","run":0,"alive":true,"status":"live","handle":"000001_live_lane_it.integration-tester.0","tokens":null,"duration":null},"agent":{"role":"integration-tester","alive":true,"log":"000001_live_lane_it.integration-tester.0"}} | {"agents":{"role":"integration-tester","run":0,"alive":false,"status":"ok","handle":"000001_live_lane_it.integration-tester.0","tokens":null,"duration":null},"agent":{"role":"integration-tester","alive":false,"log":"000001_live_lane_it.integration-tester.0"}} | PASS |
| C2 | a live merger lane pid marks its newest merger run live | {"entry":{"role":"merger","run":0,"alive":true,"status":"live","handle":"000002_live_lane_member.merger.0"},"agent":{"role":"merger","alive":true,"log":"000002_live_lane_member.merger.0"}} | {"entry":{"role":"merger","run":0,"alive":true,"status":"live","handle":"000002_live_lane_member.merger.0","tokens":null,"duration":null},"agent":{"role":"merger","alive":true,"log":"000002_live_lane_member.merger.0"}} | {"entry":{"role":"merger","run":0,"alive":false,"status":"ok","handle":"000002_live_lane_member.merger.0","tokens":null,"duration":null},"agent":null} | PASS |
| C3 | a live lane run's card spins instead of showing the finished checkmark | mark "spin", class has agent-live, animation-name "spin" | mark=spin cls=agent-card agent-integration agent-live anim=spin/0.9s | mark=check cls=agent-card agent-integration agent-past anim=none/0s | PASS |
| C4 | a stale integration-tester lane pid keeps the run finished | alive:false status:"ok" + card agent-past/check | alive=false status=ok agent={"role":"integration-tester","alive":false,"log":"000001_live_lane_it.integration-tester.0"} / dom: mark=check cls=agent-card agent-integration agent-past | alive=false status=ok agent={"role":"integration-tester","alive":false,"log":"000001_live_lane_it.integration-tester.0"} / dom: mark=check cls=agent-card agent-integration agent-past | PASS |
| C5 | a live lane run's open log line is held back, so no fragment renders | token=false (the open text_delta record renders nothing) | token=false tools=0 text="IT RUN\n" | token=true tools=0 text="IT RUN\n\n\nLIVE-HOLD-337" | PASS |

Assumptions:
- The lane pid file holds a bare pid, so `pidAlive` reads it through the signal check. The orchestrator writes `<pid> <disc>`, and `pidEntry` parses the leading pid, so the same rule holds.
- A lane runs once per project, so two tasks in `merging` in one root read the same `merger.pid`. The finished case therefore uses one task per lane and a stale pid.
- The open-line hold engages only for a `message_update` `text_delta` record (`runText` in `src/webui/logpane.ts:101`), so the pane probe writes that record shape, copied from `tests/webui/agentlog.test.ts:35`. A `tool_execution_start` record renders whole and is not held; the first probe measured that and the fixture changed, the claim did not.
- A `#m-log-text` row wait reached its bound in one scored run before the pane showed its line; the sampled value was still settled and equal in all three scored runs.

Not exercised: a real daemon spawn of a merger or integration-tester (the diff touches no orchestrator file), gzip-swept logs, doctor cards, and browsers other than Chromium. No test suite was run.
