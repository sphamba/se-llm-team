---
name: "feat: hold a task on a user blocker at every stage start"
priority: "medium"
state: "to-do"
worktree: "feat/318-user-blocker-hold"
issuer: "user"
complexity: "simple"
shortName: "user-blocker-hold"
blockedBy: ""
---

# Summary
Verification of the user-blocker hold after #319 (daemon gates and docs) and #320 (card border) land. Check the token end to end on a real board: a held task starts no stage, releasing it restarts the path cleanly, and the card carries the 6-on/4-off dashed border.

# Specs
## Check after the pieces land

Both subtasks are done when this task runs, so check the joined behaviour on the merged base branch.

- One predicate: `hasUserHold` exists once in `src/kanban.ts`, all six daemon gates in `src/orchestrator/pipeline.ts` call it, and no gate re-implements the token test.
- Token semantics: `user` alone and `user, #42` both parse, round-trip and hold; `dropDoneBlockers` keeps `user` while dropping a satisfied ref; `blockedNums` and `assertNoBlockCycle` still ignore it; no new validation rejects other ghost refs.
- Gates end to end on a scratch project: a held backlog task stays in backlog; a held to-do task of moderate complexity reaches neither the Splitter nor the Developer and writes no splitter marker; a held to-review, to-merge, to-live-test and to-integration-test task keeps its state, writes no pid or marker, and the next eligible task in the single-slot merger and integration lanes still runs. Removing the token starts the path at the splitter for a moderate task.
- No running agent is killed and no state is reverted by a hold.
- `spawnRunAnalysis` is not held.
- Web UI: `syncBoard` toggles `user-hold` on every pass, the CSS rule keeps the 6px-on/4px-off dashes with the 3px left accent, the 6px radius and the sizes, hover does not wipe the dashes, `relationPaths` draws no line for `user`, and the dialog row prints it plain.
- Docs state the rule: `skills/se-llm-team/SKILL.md`, `docs/architecture.md`, `docs/agents-and-tools.md` and `agents/splitter.md`.
- Scoped suites pass: `node scripts/test-changed.mjs`.

## Out of scope

No new feature work. A defect found here is a new task, not an edit to this one.

# Notes

- Split on 2026-10-10 into #319 (token, `hasUserHold`, the six daemon gates, kanban and orchestrator tests, docs, `agents/splitter.md`) and #320 (the `user-hold` card class, the 6-on/4-off dashed border, the webui tests). The two lanes share no file, so they run as parallel lanes; the parent waits on both and verifies the joined behaviour.
- Splitter guidance for this repo: split by file set, never by test file. A test belongs with the code it asserts, and two lanes that touch one test file conflict at the merge. The daemon gates all live in `src/orchestrator/pipeline.ts`, so they are one lane however many state pairs they cover.
- `src/webui/board.ts` is shipped by interpolating `String(fn)` into the page, so a helper a browser-side function calls must be interpolated too. Keep such checks inline instead, or the client breaks while the node test still passes.
- A task is marked moderate only when its lane is honest about it: the reviewer cap is 1 pass for simple and 2 for moderate, and the splitter runs again on moderate and complex children. A child that cannot split further carries a `## Split scope` line that says so.

## Blocked: the blockers are not merged

Verification-only run. No source, test or doc change. This notes block is the deliverable.

State of the blockers:

- `000319_user_blocker_hold_daemon.md` has `state: "to-do"`.
- `000320_user_blocker_hold_card.md` has `state: "to-do"`.
- `HEAD` and `main` are both `84a0c8c`, so the worktree base is current. The base branch does not hold either piece.

Probes on the base commit, all negative:

- `grep -rn 'hasUserHold' src/` gives no match. The predicate does not exist.
- `grep -rn 'user-hold\|userHold' src/ docs/ skills/ agents/` gives no match. No daemon gate, no `syncBoard` toggle, no CSS rule and no doc line exists.
- `grep -rn 'dashed' src/webui/` matches only two unrelated relation-line comments in `page.ts`.
- `grep -rn "'user'" src/kanban.ts` matches only the `issuer` field, which is not the blocker token.

The Specs premise "Both subtasks are done when this task runs" is false. Each check line under "Check after the pieces land" depends on a piece that is absent, so no line can be made red or green. There is no defect to report and no edit to make.

`node scripts/test-changed.mjs` was not run. With no change against `main` the changed set is empty, so it would prove nothing about the Specs.

Action for the board: keep this task out of `to-do` until #319 and #320 both reach `done`. Re-run it on the merged base after that point.

Method finding: a `blockedBy` pair did not stop this task from being promoted and spawned while both blockers sat in `to-do`. The hold check in the board promotion path does not cover this case, or the edge was dropped. `src/kanban.ts` owns `blockedBy` parsing and `promoteBacklog` gates the promotion.
