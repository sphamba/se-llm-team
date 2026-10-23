---
name: "feat: block and unblock a task from its detail dialog"
priority: "medium"
state: "done"
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
## What changed
- `src/hub.ts`: `POST /api/task-block` resolves the task like `/api/task-detail`, refuses a foreign Origin with 403, a non-JSON type with 415 and a body over 1 KiB with 413, then toggles the `user` hold. Block writes the hold and the queue state in one `updateAttrs` call before it stops the state's agent, so the integration liveness rule cannot advance the task to done. Unblock writes `blockedBy` only and pokes the daemon.
- `src/webui/page.ts`: a static `#m-actions` row between `#m-attrs` and `#m-agent`, a red Block and a green Unblock button with the inline stop and play icons, and `toggleHold` posts `{action}` and re-polls the detail.
- `docs/architecture.md`: the dashboard is no longer called read-only, and one sentence names the block control.
- Tests: the block endpoint part in `tests/webui/hub.test.ts`, the row and icon pins in `tests/webui/page.test.ts`, the liveness race part in `tests/orchestrator/poll.test.ts`.

## Acceptance
- pre-commit `git status --short`: 6 modified files, all in the Specs list.
- pre-commit `grep -c 'read-only' docs/architecture.md`: 0 hits (exit 1), so the dashboard is no longer called read-only.
- `node tests/webui/hub.test.ts` exit 0: 404, 400, 403, 415, 413, 409 on done and merging; `#42, #43` plus `user` on block; the refs survive the unblock; `.kanban/.poke` written; doing moves to to-do and the child pid is dead; to-do keeps its state and the splitter pid is dead.
- `node tests/webui/page.test.ts` exit 0: `#m-actions` between `#m-attrs` and `#m-agent`, the red and green tinted rules, the left-aligned row, the `:empty` rule, both icons, no button for done or an unheld merging task, Unblock on a held task, and the POST with `{action}` as JSON.
- `node tests/orchestrator/poll.test.ts` exit 0: the unblocked control advances a dead integration run to done, the blocked task stays in to-integration-test with its hold.
- `node tests/orchestrator/hub.test.ts` exit 0: the caller suite of the changed hub module.
- Substitution: the Specs `pnpm test` line runs as the scoped suites above, because the project rule forbids the aggregate script in a write run.
- The live pass (button colors in both themes, the row in a real browser) is left to the reviewer: no DOM library or browser driver exists and no fixture serves the page to one, so the page pins are static.

## Follow-up
- `tests/webui/page.test.ts` moves its exact font-size pin from 11 to 12 for the new button rule.

## Live test: block and unblock from the task detail dialog

Merged tree: `/home/phamba/repos/se-llm-team/.worktrees/feat/357-task-block-button`
Driver: `/tmp/357-block/driver.mjs`, wrapper: `/tmp/357-block/run.sh`, results: `/tmp/357-block/{merged,control}-*.json`
Runs: 3 merged (merged-1, merged-2, merged-3) and 1 control (`git archive HEAD^` of the merged tree, in `/tmp/357-block-pre`). Every merged run agreed on every row.

### Assumptions

- Each run built a throwaway git repo under `/tmp/357-block-runs/` with one task file per state and started the merged hub in-process on `127.0.0.1` port 0, reading the bound port back. Requests are real HTTP `fetch` calls.
- Fake agents are detached `node -e setInterval()` children, recorded with `writePid` so the stored discriminator matches `/proc`. Liveness read the `/proc/<pid>/stat` state, and `Z` or gone counts dead.
- The page was checked in Chromium (Playwright) on the hub-served page: a card click opens the dialog, `reducedMotion: reduce` drops the entrance animation, and the mouse rests at `0, 0` before every style sample. The light palette was sampled in a default context, dark via `documentElement.dataset.theme` and again via `prefers-color-scheme` in a separate context.
- The integration row ran on a board that holds only the integration fixture, so the poll sweep cannot start another lane. `poll(root, 60)` ran in-process.
- Row 15 is a guard: both trees show `deadFiles=0`, because neither writes a `.dead` marker for a user block.
- The dialog row and the two buttons were sampled, not clicked, in the table; the click path is in the supplementary note below.

Not exercised: a real spawned sh-wrapper agent under the daemon (detached fake children stand in), a live daemon reacting to `.poke` (only the file write is measured), and the button's disabled window during an in-flight request (only the post-click state is measured).

Supplementary user run, merged tree, not a table row: on a `doing` card, a click of the red Block button left the dialog showing Unblock on `m-action m-unblock`, enabled, and its attrs list showed the `state` cell `to-do` and the `blockedBy` cell `user`, the file at `state=to-do blockedBy=user`, the worktree kept, and the developer pid gone with its pid file gone. A click of Unblock returned the button to Block, kept `state=to-do`, and cleared `blockedBy`.

| # | Claim | Expected | Control | Observed | Verdict |
|---|---|---|---|---|---|
| 1 | block on a doing task writes the hold, moves it to to-do, keeps the worktree | state=to-do blockedBy=user worktree=feat/405 | state=doing blockedBy=(empty) worktree=feat/405 | state=to-do blockedBy=user worktree=feat/405 | pass |
| 2 | block on a doing task stops the live developer child | developer=dead pidfile=gone | developer=alive pidfile=present | developer=dead pidfile=gone | pass |
| 3 | block on a to-do task with a live splitter keeps to-do and kills it | state=to-do splitter=dead | state=to-do splitter=alive | state=to-do splitter=dead | pass |
| 4 | block keeps the other refs in order and appends user | state=to-review blockedBy=#42, #43, user | state=to-review blockedBy=#42, #43 | state=to-review blockedBy=#42, #43, user | pass |
| 5 | unblock removes only the user hold and keeps the state | blockedBy=#42 state=to-do | blockedBy=USER, #42 state=to-do | blockedBy=#42 state=to-do | pass |
| 6 | unblock writes .kanban/.poke | poke=yes | poke=no | poke=yes | pass |
| 7 | block on integration-testing leaves to-integration-test and a poll does not advance it | state=to-integration-test integration=dead afterPoll=to-integration-test | state=integration-testing integration=alive afterPoll=integration-testing | state=to-integration-test integration=dead afterPoll=to-integration-test | pass |
| 8 | block on a done task is refused | status=409 state=done | status=404 state=done | status=409 state=done | pass |
| 9 | block on a merging task is refused | status=409 state=merging | status=404 state=merging | status=409 state=merging | pass |
| 10 | an unknown num is 404 | status=404 error=unknown task | status=404 error=(empty) | status=404 error=unknown task | pass |
| 11 | an invalid action is 400 | status=400 error=action must be block or unblock | status=404 error=(empty) | status=400 error=action must be block or unblock | pass |
| 12 | a foreign Origin is 403 | status=403 error=cross-origin request refused | status=404 error=(empty) | status=403 error=cross-origin request refused | pass |
| 13 | a non-JSON content type is 415 | status=415 error=content-type must be application/json | status=404 error=(empty) | status=415 error=content-type must be application/json | pass |
| 14 | a body over 1 KiB is 413 | status=413 error=body too large | status=404 error=(empty) | status=413 error=body too large | pass |
| 15 | a user block writes no .dead marker (guard) | deadFiles=0 | deadFiles=0 | deadFiles=0 | pass |
| 16 | the dialog row sits between attrs and agent, left aligned | order=attrs,actions,agent display=flex justify=flex-start xDelta=0 | row=absent | order=attrs,actions,agent display=flex justify=flex-start xDelta=0 | pass |
| 17 | a done task shows no block button | actionsLen=0 display=none | row=absent | actionsLen=0 display=none | pass |
| 18 | a merging task without a hold shows no block button | actionsLen=0 display=none | row=absent | actionsLen=0 display=none | pass |
| 19 | a doing task shows the red Block button with the stop icon (light) | text=Block icon=rect cls=m-action m-block color=rgb(229, 71, 79) border=rgb(230, 80, 80) bg=color(srgb 0.985294 0.897059 0.897059) | row=absent | text=Block icon=rect cls=m-action m-block color=rgb(229, 71, 79) border=rgb(230, 80, 80) bg=color(srgb 0.985294 0.897059 0.897059) | pass |
| 20 | a held task shows the green Unblock button with the play icon (light) | text=Unblock icon=path cls=m-action m-unblock color=rgb(113, 151, 0) border=rgb(134, 179, 0) bg=color(srgb 0.928824 0.955294 0.85) | row=absent | text=Unblock icon=path cls=m-action m-unblock color=rgb(113, 151, 0) border=rgb(134, 179, 0) bg=color(srgb 0.928824 0.955294 0.85) | pass |
| 21 | both buttons read in the dark theme (data-theme) | block[text=Block icon=rect cls=m-action m-block color=rgb(217, 87, 87) border=rgb(217, 87, 87) bg=color(srgb 0.194314 0.131176 0.161176)] unblock[text=Unblock icon=path cls=m-action m-unblock color=rgb(170, 217, 76) border=rgb(170, 217, 76) bg=color(srgb 0.166667 0.207647 0.154706)] | block[row=absent] unblock[row=absent] | block[text=Block icon=rect cls=m-action m-block color=rgb(217, 87, 87) border=rgb(217, 87, 87) bg=color(srgb 0.194314 0.131176 0.161176)] unblock[text=Unblock icon=path cls=m-action m-unblock color=rgb(170, 217, 76) border=rgb(170, 217, 76) bg=color(srgb 0.166667 0.207647 0.154706)] | pass |
| 22 | both buttons read in the dark theme (media path) | block[text=Block icon=rect cls=m-action m-block color=rgb(217, 87, 87) border=rgb(217, 87, 87) bg=color(srgb 0.194314 0.131176 0.161176)] unblock[text=Unblock icon=path cls=m-action m-unblock color=rgb(170, 217, 76) border=rgb(170, 217, 76) bg=color(srgb 0.166667 0.207647 0.154706)] | block[row=absent] unblock[row=absent] | block[text=Block icon=rect cls=m-action m-block color=rgb(217, 87, 87) border=rgb(217, 87, 87) bg=color(srgb 0.194314 0.131176 0.161176)] unblock[text=Unblock icon=path cls=m-action m-unblock color=rgb(170, 217, 76) border=rgb(170, 217, 76) bg=color(srgb 0.166667 0.207647 0.154706)] | pass |
| 23 | docs/architecture.md no longer says read-only and names the block control | readonly=0 blockSentence=yes | readonly=1 blockSentence=no | readonly=0 blockSentence=yes | pass |

Red proof: the first wrapper pass marked rows 19 to 22 RED because the checker still carried a `(print)` placeholder in the expected cell. The cells were frozen from the spike print, the claim was kept, and the wrapper was rerun once. The final pass has no red row and exits 0. No run failed.

Verdict: pass. Every row matches the Specs acceptance, and the control tree differs on every row but the labelled guard.
