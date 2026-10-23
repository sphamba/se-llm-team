---
name: "fix: stop the task-block body reader at the cap and clear a stale pid"
priority: "medium"
state: "backlog"
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
