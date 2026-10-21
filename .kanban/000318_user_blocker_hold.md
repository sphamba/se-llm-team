---
name: "feat: hold a task on a user blocker at every stage start"
priority: "medium"
state: "reviewing"
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

## Verified on the merged base 41ad23b

Verification-only run: no source, test or doc change, so no commit. One `git merge --ff-only main` took this worktree from `84a0c8c` to `41ad23b`. That diff holds both subtask sets: `src/webui/board.ts` and `page.ts` (#320), `src/kanban.ts`, `pipeline.ts`, the docs and `agents/splitter.md` (#319). The premise holds. #319 sits in `to-live-test` and #320 in `live-testing`, which `BLOCKER_SATISFIED` counts as satisfied, and both changes are on `main`.

Every Specs line holds:

- One predicate: `hasUserHold` has one definition, `src/kanban.ts:370`, imported at `pipeline.ts:3`. The six gates call it: `startTodo` 148, `sweepToMerge` 254, `sweepToIntegrationTest` 337, rescan to-review 514, rescan to-live-test 541, `blockedByUndone` 632. No gate repeats the token test. The only second copy is `src/webui/board.ts:462`, the browser-side class toggle, which must stay inline because `page.ts` ships functions as text.
- Token semantics: `blockedNums` (`kanban.ts:377`) and `assertNoBlockCycle` (`kanban.ts:390`) still parse numbers only and ignore the token. `dropDoneBlockers` (`pipeline.ts:648`) reads each part as a number, so `user` stays while a satisfied ref drops. A probe created `on-hold, #999` and `waiting-on-legal`: both round-trip, neither reads as a hold, and no validation rejects them.
- Gates end to end, each pinned: backlog (promote part BI), to-do moderate and simple with no splitter marker and a splitter restart on release (split part BG), to-review with no pid and no armed marker (sweep part UH1), to-merge with no rebase, no fast-forward, no merge-attempted marker and no merger slug, and the next eligible task merged (merge part UH3), to-live-test with the next eligible task started (sweep part UH2), to-integration-test with the next eligible task in the lane and the held run started on release (integration part 16).
- No kill and no revert: `pipeline.ts` holds no `kill` call. A scratch probe (deleted after the run) registered a live `sleep` pid for a `doing`, a `reviewing` and a `live-testing` task, each with `blockedBy: "user"`. One `rescan` plus one `poll(60, now, 0)` left every state, every pid file and every process intact.
- `spawnRunAnalysis` is not held: the to-merge analysis call at `pipeline.ts:238` sits before the hold gate at 254, and `liveness.ts:200` and `:229` call it with no hold test.
- Web UI: `syncBoard` toggles `user-hold` on every pass, outside the `__html` diff block, so a poll adds and removes it and the one-shot `enter` class stays. The CSS at `page.ts:152-153` keeps the 6-on/4-off dashes (`0 6px`, `transparent 6px 10px`) on the top, bottom and right edges, the 3px left accent, the 6px radius and the `8px 10px` padding. `.card:hover` sets only `background` on `.card`, so it cannot wipe the pseudo-element, and no later rule resets `::after`. `relationPaths` draws no line for `user`, and `blockedRow` prints it as plain escaped text. Pinned in `page.test.ts:591-594` and `board.test.ts:646-672`.
- Docs: `skills/se-llm-team/SKILL.md` (the states line, step 4, step 6), `docs/architecture.md` (backlog and to-do), `docs/agents-and-tools.md` (splitter row and text), `agents/splitter.md`.

## Suites

All 26 suites of the three affected areas ran, one at a time, from this worktree: `tests/orchestrator` (15), `tests/kanban` (6), `tests/webui` (5). 25 pass. `tests/orchestrator/spawn.test.ts` fails on a pre-existing wait, not on this batch: part A, `waitFor` "the integration task runs to done and folds into the mirror", 60 s. The daemon logs `000002_integration_of_1: agent exited 0, integration-testing -> done`, but `kanban: done 000002_integration_of_1.md` never reaches the mirror. The same wait with the same timeout line fails at `84a0c8c`, which I extracted to `/tmp` and ran there (that tree has no `hasUserHold`). Three runs, three failures: two on `41ad23b`, one on `84a0c8c`.

`node scripts/test-changed.mjs` was not run. In this worktree the changed set is empty now (`HEAD` equals `main`, clean tree), so it would print "no modifications, nothing to run" and prove nothing. Also, `docs/*.md` and `src/orchestrator/pipeline.ts` have no rule in `scripts/test-changed.mjs`, so it falls back to `ALL`, which is the full suite and the live tester's gate.

## Defect for a new task

The integration task's done-fold commit never lands on the `meta/kanban` mirror. `tests/orchestrator/spawn.test.ts` part A fails deterministically on this wait at `84a0c8c` and at `41ad23b`, so the defect predates #319 and #320. Not fixed here: the Specs put defects out of scope.

## Closed: the earlier method finding

The prior note said a `blockedBy` pair did not stop promotion. It does not repeat here, and it is not a defect. `dropDoneBlockers` removes a ref when its blocker enters the live test, by design (`docs/architecture.md`, backlog bullet). Both refs left this card at that point (frontmatter `blockedBy` is now empty), so promotion was allowed when both changes were already on `main`. The premise was true, and this run could verify it.

# Open questions

- Assumed: "both subtasks are done when this task runs" means their changes are on `main`, not that both cards read `done`. #319 is in `to-live-test` and #320 in `live-testing`, and their diffs are in `main` after one ff-only merge. Please confirm this reading for verification tasks.
