---
name: "feat: block and unblock a task from its detail dialog"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "task-block-button"
---

# Summary
Add a red Block button and a green Unblock button to the task detail dialog. Block adds the user hold, moves an active task back to its queue state, and stops its agent. Unblock removes the user hold. Done and merging tasks show no block button.

# Specs
## Goal
Add a Block and Unblock control to the web UI task detail dialog. Block sets the existing user hold, moves an active task back to its queue state, and stops the task agent. Unblock removes the user hold and lets the normal lane start the task again.

## Reuse, do not rebuild
`blockedBy: user` is already the user hold. `hasUserHold` in `src/kanban.ts` matches a `blockedBy` part reading `user` with any case and spacing. Every start gate reads it: `startTodo`, `sweepToMerge`, `sweepToIntegrationTest`, the reviewer start, the live-tester start, and `blockedByUndone`. The board already draws a held card with `.card.user-hold`. Do not add a new state, a new side file, or new gate code.

`updateAttrs(root, task, patch)` in `src/kanban.ts` can write `blockedBy` and `state` in one file write. `setState` is only a wrapper. Use `updateAttrs` for the block so the hold and the queue state land together.

## Endpoint
Add `POST /api/task-block` to `src/hub.ts`.

- Query: `num` (the task number) and the existing `project` query. Use `resolveEntry` and `taskFiles`/`taskNum`/`getTask` the same way `/api/task-detail` does.
- Body: JSON `{ "action": "block" | "unblock" }`.
- Same-origin only: reject a present `Origin` whose host does not equal the request `Host` with 403. Reject a content type other than `application/json` with 415.
- Reject a declared `content-length` over 1024 with 413. Cap the read too.
- Unknown `num` is 404. Invalid `action` is 400. A block on `done` or `merging` is 409.
- `block`: remove any existing `user` token from `blockedBy` with any case and spacing, keep every other ref in order, append `user`, and write `blockedBy` and the target state in one `updateAttrs` call. The target state is the table below.
- `unblock`: remove any `user` token and keep every other ref in order. Write `blockedBy` only. Do not move the state. Do not stop an agent. After the write, remove and write `<root>/.kanban/.poke` the way `orchestrator_poke` does, so the daemon re-evaluates at once.
- Response: 200 `{"ok":true}`. Errors: `{"error":"..."}`.
- The state write happens before the kill. The integration lane's liveness rule is `integration-testing` to `done`. A kill first could let the liveness advance the task to done. The single `updateAttrs` first removes that race.

## State and agent table
| Read state | `blockedBy` | New state | Agent to stop |
|---|---|---|---|
| backlog | add `user` | unchanged | none |
| to-do | add `user` | unchanged | splitter, if its pid is live |
| doing | add `user` | to-do | developer |
| to-review | add `user` | unchanged | none |
| reviewing | add `user` | to-review | reviewer |
| to-merge | add `user` | unchanged | none |
| merging | refuse block, 409 | - | - |
| to-live-test | add `user` | unchanged | none |
| live-testing | add `user` | to-live-test | live-tester |
| to-integration-test | add `user` | unchanged | none |
| integration-testing | add `user` | to-integration-test | integration-tester, only when its lane slug is this task |
| done | refuse block, 409 | - | - |

`backlog` and `done` rows are shown for completeness. A block on `backlog` is allowed and holds promotion. A block on `done` is refused.

## Stop details
- Resolve the pid name with the existing `agentPidName(role, taskSlug(task.file))`. The splitter, developer, reviewer and live-tester use the task slug. The integration-tester uses the `integration-tester` lane.
- Read the pid entry, check `pidAlive` with its discriminator, then `killTree(pid)` to signal the whole process group, then `clearPid`. Do not kill a stale pid whose discriminator does not match.
- For the integration lane, compare `readMergerSlug(root, "integration-tester")` with `taskSlug(task.file)` first. Only kill and clear when they match. The state still moves for this task when they do not match.
- Do not write a `.dead` marker. A user block is not a failed run, so the dialog history must not turn red.
- A kill failure is logged. The task write already succeeded and the response is still 200.
- The task's `worktree` attribute stays. The next spawn reuses the worktree and the branch.

## Dialog
- Add a static `<div id="m-actions"></div>` between `<div id="m-attrs"></div>` and `<div id="m-agent">` in `src/webui/page.ts`. `#m-attrs` and `#m-agent` are rebuilt on every detail poll, so the button cannot live inside them.
- `writeHead(t)` also sets `#m-actions.innerHTML = actionsHtml(t)`.
- `actionsHtml(t)` uses `hasUserHold` logic on `t.blockedBy`. Done returns "". Merging with no user hold returns "". Merging with a user hold follows the generic held branch and shows Unblock. That state is not expected. Do not add a special branch.
- Held tasks show Unblock. All other allowed states show Block. Keep the other refs untouched.
- Block: red tinted button, `color: var(--error-text)`, `border: 1px solid var(--error)`, `background: color-mix(in srgb, var(--error) 15%, var(--panel))`, with an inline stop SVG. Unblock: green tinted button, `color: var(--accent-done-text)`, `border: 1px solid var(--accent-done)`, `background: color-mix(in srgb, var(--accent-done) 15%, var(--panel))`, with an inline play SVG.
- The row is left aligned and the button keeps its normal width. Use `display: flex; justify-content: flex-start;`. Add `#m-actions:empty { display: none; }` so no gap appears when there is no button.
- `toggleHold(btn)` posts `{action}` to `/api/task-block?num=<num>` plus the existing `projectParam()`. Disable the button while the request runs. On success call `pollDetail()` so the detail state and the button redraw. On failure show the error and re-enable the button.
- Use `t.file` to get the number, for example `parseInt(t.file.slice(0, 6), 10)`, the same way `detailUrl` does.
- Both themes must read. The button uses the existing Ayu variables from `src/webui/page.ts`, not new hex values.

## Tests
- `tests/webui/hub.test.ts`: the route returns 404 for an unknown num, 400 for a bad action, 403 for a foreign Origin, 415 for a non-JSON body, 413 for a body over 1 KiB, and 409 for a block on done and merging. A block on `"#42, #43"` yields `"#42, #43, user"`. An unblock yields `"#42"` and keeps the state. A block on a doing task with a live detached child pid yields the to-do state and a dead pid. A block on a to-do task with a live splitter pid keeps to-do and kills the pid. An unblock writes `.kanban/.poke`. Use the existing temp root, `startHub` and `fetch` harness.
- `tests/webui/page.test.ts`: `#m-actions` sits between `#m-attrs` and `#m-agent`. The CSS pins the red block and green unblock variables, the left aligned row, the `:empty` rule, and the two SVG icons. The source shows done returns no button, merging without a hold returns no button, a held task shows Unblock, and the POST sends `{action}` with JSON to the block URL. Use the existing `cssRule` and page-string helpers.
- `tests/orchestrator/poll.test.ts`: an integration-testing task that the block moves to to-integration-test with a cleared integration pid stays in to-integration-test after a poll. It must not advance to done. The route test proves the state write. This test proves the liveness race is closed.
- Run `pnpm test` and keep it at exit 0. The developer may run the three touched suites while working, but the acceptance is the full suite.

## Docs
- `docs/architecture.md:44` calls the web dashboard read-only. Add one sentence: the task detail dialog can block or unblock a task. It adds or removes the `user` hold, moves an active task back to its queue state, and stops its agent. A done or merging task shows no block button.
- Do not edit `README.md`. It does not call the dashboard read-only.

## Acceptance
- A real hub on a temp board accepts the endpoint with the same-origin and JSON headers.
- A block on a doing task writes `user`, moves it to to-do, and the live child pid is gone.
- A block on a to-do task with a live splitter keeps to-do and the splitter pid is gone.
- A block on an integration-testing task leaves to-integration-test, not done.
- The refs are kept and only `user` is added or removed.
- A done task and a merging task show no block button. The endpoint refuses a block on both.
- The detail row is between the attributes and the agent cards, left aligned, with the stop and play icons.
- `pnpm test` exits 0.
- `docs/architecture.md` no longer says the dashboard is read-only.

## Constraints
- Do not change the start gates. The user hold already works.
- Do not change `README.md`.
- Do not add a new task state, side file or `.dead` marker.
- Do not add a mirror commit for the block write. The task file is the source and the existing create/done mirror points are unchanged.
- Keep the diff to `src/hub.ts`, `src/webui/page.ts`, `docs/architecture.md`, `tests/webui/hub.test.ts`, `tests/webui/page.test.ts` and `tests/orchestrator/poll.test.ts`. Reuse `src/kanban.ts`, `src/pid.ts` and `src/orchestrator/spawn.ts` helpers. Touch those source files only if a helper must be exported.

# Notes
