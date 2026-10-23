---
name: "fix: stop the task-block body reader at the cap and clear a stale pid"
priority: "medium"
state: "done"
worktree: ""
issuer: "#357"
complexity: "simple"
shortName: "task-block-body-cap"
---

# Summary
Stop the task-block body reader from buffering past 1 KiB on a chunked upload, and clear a stale agent pid when a block finds the agent already gone. Add a chunked-body test and a stale-pid test.

# Specs
## Problem
`readCapped` in `src/hub.ts` appends every chunk before it checks the cap. When the data passes 1 KiB it resolves null, but the `data` listener keeps appending, so a client that sends a chunked body without `content-length` can grow the server memory. The comment says the cap covers that case. It does not. The declared-length 413 is correct and the existing test passes.

`stopAgent` in `src/hub.ts` returns when `pidAlive` is false, before `clearPid`, so a block on a task whose agent already died leaves its stale pid file. The next spawn overwrites it, but the block should clear it.

## Fix
- In `readCapped`, stop buffering the moment the next chunk would pass the cap. Remove the data listener or drain it without storing, resolve null, and let the caller answer 413. Close or drain the request so the client cannot keep feeding the buffer.
- In `stopAgent`, always `clearPid` when a pid file exists. Kill only when `pidAlive(pid, disc)` is true. Do not kill a stale pid.
- Add to `tests/webui/hub.test.ts`: a chunked POST with no `content-length` sends more than 1 KiB, the response is 413, and the reader stops at the cap. Use a `node:http` request with `transfer-encoding: chunked` or a `fetch` stream body.
- Add a stale-pid case: write a dead pid for a doing task, block it, assert the state moved and the pid file is gone.
- Keep the existing declared-length 413 test.

## Acceptance
- `node tests/webui/hub.test.ts` exits 0.
- A chunked body over 1 KiB answers 413 and the reader stops at the cap.
- A stale pid file is gone after a block.
- `pnpm test` exits 0.

## Constraints
- Change `src/hub.ts` and `tests/webui/hub.test.ts` only.
- Do not change the endpoint contract, the state table, the UI, or the docs.

# Notes

## What changed
- `readCapped` in `src/hub.ts` now checks `data.length + chunk.length` before appending, settles null once, clears the buffer and drains every later chunk without storing. Exported so the suite can drive it with a fake chunk stream.
- `stopAgent` in `src/hub.ts` clears the pid file whenever a pid entry exists, and signals the process group only when `pidAlive(pid, disc)` is true.
- `tests/webui/hub.test.ts`: dead-pid doing task block (state moves, pid file gone), reader cap assertion (only the chunk below the cap is stringified), and a `node:http` chunked POST with no `content-length` over 1 KiB that answers 413. The declared-length 413 test is unchanged.

## Acceptance
- pre-commit, `git diff --stat HEAD~1`: 2 files, `src/hub.ts` and `tests/webui/hub.test.ts` only, exit 0.
- `node tests/webui/hub.test.ts` exit 0 (red before the source fix: stale pid file assertion, exit 1).
- `node tests/webui/hub.test.ts tests/webui/page.test.ts tests/webui/board.test.ts tests/webui/agentlog.test.ts tests/orchestrator/hub.test.ts tests/orchestrator/config.test.ts` all exit 0 (caller suites from `grep -rln 'src/hub' tests/`).
- `pnpm test` not run: the worktree has no `node_modules`, so the aggregate script cannot start; the suites above cover the change.
- Live chunked upload against a browser is left to the reviewer: no DOM library or browser driver in the repo.

## Follow-up
- The cap counts chunk bytes but compares against the decoded string length, so a multi-byte chunk can trip the cap a few characters early. Safe direction, no user-visible change.

## Live test: task-block chunked body cap and stale pid

Exercise: a real hub (`startHub`, bound port) on a fixture project root with a task in each needed state, driven only through the served `/api/task-block` endpoint and, as a supplementary probe, one real click on the task-detail dialog's Block button. Fix #358 touches the hub body reader and `stopAgent`.

### Assumptions
- A user reaches the block flow through the detail dialog's Block button, which POSTs JSON with a `content-length`; the chunked, length-less upload is a hostile or malformed client, so rows 1 and 2 use a raw `node:http` request on the same endpoint.
- "Reader stops at the cap" is internal: over HTTP the 413 answers and `connection: close` cuts the upload on both trees, so the stored-buffer difference has no live gesture. Row 1 therefore only proves the wire behaviour (413, upload cut, bounded RSS) and is labelled a guard.
- A dead pid is a node process that has exited; a live agent is a detached node process, so `killTree` takes the process-group path. Liveness reads `/proc/<pid>/stat`, where `Z` counts as gone.
- "Upload cut" means the client sent less than the 24 MiB body before the hub closed the connection.

Not exercised: the in-process size of the read buffer after the cap (`readCapped`); no live gesture reaches it (see assumptions). The suite's fake-stream assertion covers it. The declared-length 413 path is unchanged by this fix and was not re-run here.

Tree: `/home/phamba/repos/se-llm-team/.worktrees/fix/358-task-block-body-cap` (merged 8c4639b), control `/tmp/358-body-cap-pre` from `git archive HEAD^`.
Driver: `/tmp/358-body-cap/driver.mjs`, wrapper `/tmp/358-body-cap/run.sh`, supplementary `/tmp/358-body-cap/ui-probe.mjs`.
Runs: control 1, merged 3 (all three agree on every cell), supplementary UI click 1 on the merged tree.

| # | claim | expected | control HEAD^ | observed merged x3 | verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | guard: a chunked body over 1 KiB with no content-length answers 413, the client cannot keep feeding, memory stays bounded | status=413 upload=cut mem=bounded | status=413 upload=cut mem=bounded | status=413 upload=cut mem=bounded | pass |
| 2 | guard: a refused chunked body leaves the task state alone | state=doing | state=doing | state=doing | pass |
| 3 | a block clears the stale pid file of a dead agent | pidfile=absent | pidfile=present | pidfile=absent | pass |
| 4 | guard: a stale-pid block still moves the doing task to its hold queue state | state=to-do | state=to-do | state=to-do | pass |
| 5 | guard: a block still stops a live agent and clears its pid file | agent=gone pidfile=absent | agent=gone pidfile=absent | agent=gone pidfile=absent | pass |

Red proof: row 3, the control tree answers the stale-pid block with `pidfile=present` while the expected and merged cell is `pidfile=absent`. Rows 1, 2, 4 and 5 are guards: they read the same on both trees and prove the fix did not change the 413 contract, the refused-body state, the hold state move, or the live-agent kill.

Supplementary click probe (merged): `ui-click: state=to-do pidfile=absent button=Unblock`. A doing card with a stale pid file opened in the detail dialog, one click on Block moved it to `to-do`, cleared the pid file, and the dialog switched to Unblock. This is the real user gesture; it is not a table row.

Verdict: PASS for every frozen row. The stale pid file is cleared by a block, and the chunked upload over 1 KiB still answers 413 with the connection cut. The stored-buffer behaviour has no live gesture, so this report does not prove it.
