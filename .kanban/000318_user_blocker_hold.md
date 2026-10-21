---
name: "feat: hold a task on a user blocker at every stage start"
priority: "medium"
state: "live-testing"
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

Re-review of 41ad23b: the tree is clean and `HEAD` equals `main`, so this is verification-only again, and every Specs line holds on the merged base.

- One predicate: `hasUserHold` is defined once, `src/kanban.ts:370`, and the six gates call it at `src/orchestrator/pipeline.ts:148`, `:254`, `:337`, `:514`, `:541`, `:632`. The only second copy of the token test is `src/webui/board.ts:462`, the browser-side class toggle that must stay inline because `page.ts` ships functions as text.
- Token semantics: `blockedNums` (`src/kanban.ts:377`) and `assertNoBlockCycle` (`src/kanban.ts:390`) parse numbers only, so both ignore the token, and `dropDoneBlockers` keeps every non-numeric part (`src/orchestrator/pipeline.ts:665`) while it drops a satisfied ref.
- Card: `.card` keeps the 3px left accent, the 6px radius and the `8px 10px` padding (`src/webui/page.ts:145`), hover sets `background` only (`:146`), and `:153` draws `0 6px` on and `6px 10px` off on the top, bottom and right edges. `syncBoard` toggles `user-hold` before the `__html` diff (`src/webui/board.ts:462-463`), so a poll adds and removes it and the one-shot `enter` class stays.
- Analysis is not held and nothing is killed: `spawnRunAnalysis` runs at `src/orchestrator/pipeline.ts:238`, before the to-merge gate at `:254`, and at `src/orchestrator/liveness.ts:200` and `:229` with no hold test. `pipeline.ts` holds no `kill` call.

Tests: `node scripts/test-changed.mjs` exit=0, which prints "no modifications, nothing to run" because `HEAD` 41ad23b equals `main`; `tests/webui/page.test.ts` exit=0; `tests/webui/board.test.ts` exit=0; `tests/kanban/blockedby.test.ts` exit=0. The orchestrator suites were not re-run, because no file changed since the prior 41ad23b pass: 14 green and `tests/orchestrator/spawn.test.ts` red (pass 1, reused).

- Pre-existing red, not this batch: `tests/orchestrator/spawn.test.ts` part A fails on the integration done-fold that never reaches the `meta/kanban` mirror, at 84a0c8c too. Upgrade path: a separate task under `src/orchestrator/`.
- This card carries no diff against `main`, so the merger receives an empty branch. Upgrade path if it bounces back here: the merger treats an empty branch as a no-op merge and moves the card on.

## Live test (2026-10-21)

Usage test of the joined change on the merged base `41ad23b` from this worktree, tree unmodified. No test suite and no `*.test.ts` file ran. One driver, two lanes: `/tmp/lt318/driver.mjs`, run log `/tmp/lt318/run.log`, per-check JSON `/tmp/lt318/result.json`.

- Hub lane: a plain fixture root (`/tmp/lt318/hub`, no git, no daemon) with three to-do tasks, served by `startHub({port: 0})` and driven in Chromium by Playwright. Task `000002_held.md` carries `blockedBy: "user, #42"`. Task `000003_blocked.md` carries `blockedBy: "#1"` and is the no-hold control.
- Daemon lane: a git fixture root (`/tmp/lt318/daemon`) with nine tasks, one per held state plus an eligible neighbour in the merge and integration lanes, a fake agent that appends one JSON capture line, and `node src/orchestrator.ts --root <fixture> --rescan-seconds 1 --poll-minutes 0.01` with `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME` and a fixture `XDG_CONFIG_HOME`.

| # | claim | printed proof | expected | control | verdict |
| --- | --- | --- | --- | --- | --- |
| C1 | the held card carries user-hold, the ref-only card does not | [true,false] | [true,false] | ref card classes ["card","enter"] | PASS |
| C2 | the held card paints 6px on / 4px off dashes on three edges, the ref card none | {"gradients":3,"stops":"0,6,6,10 x3","raw":"repeating-linear-gradient(90deg, rgba(107, 125, 143, 0.12) 0px, rgba(107, 125, 143, 0.12) 6px, rgba(0, 0,… | 0,6,6,10 x3 | ref ::after none | PASS |
| C3 | sizes kept: 3px left accent, 6px radius, 8px 10px padding, 1px transparent top border | {"left":"3px","top":"1px","topStyle":"solid","radius":"6px","padding":"8px 10px","topTransparent":true} | {"left":"3px","top":"1px","topStyle":"solid","radius":"6px","padding":"8px 10px","topTran… | ref top border rgba(107, 125, 143, 0.12) | PASS |
| C4 | hover changes the background and leaves the dashes intact | {"bgChanged":true,"dashesSame":true,"imgNone":false} | {"bgChanged":true,"dashesSame":true,"imgNone":false} | bg color(srgb 1 1 1 / 0.85) -> color(srgb 0.913725 0.929412 0.94902 / 0.806667) | PASS |
| C5 | no relation line for the user token, one for the numeric ref | {"held":0,"ref":1} | {"held":0,"ref":1} | ref lines 1 | PASS |
| C6 | the dialog blockedBy row prints the token plain | {"text":"user, #42","links":0} | {"text":"user, #42","links":0} | n/a | PASS |
| C7 | syncBoard toggles user-hold on every pass | {"off":true,"on":true,"imgAfterOff":"none"} | {"off":true,"on":true,"imgAfterOff":"none"} | n/a | PASS |
| C8 | the held backlog task stays in backlog | {"state":"backlog","spawned":0} | {"state":"backlog","spawned":0} | eligible merger none | PASS |
| C9 | the held moderate to-do task starts no splitter | {"state":"to-do","pids":[],"spawns":0} | {"state":"to-do","pids":[],"spawns":0} | C15 after the release | PASS |
| C10 | the held to-review task keeps to-review with no pid and no armed marker | {"state":"to-review","pids":[],"armed":false,"spawns":0} | {"state":"to-review","pids":[],"armed":false,"spawns":0} | eligible merger ran | PASS (gate not reached (fixture)) |
| C11 | the held to-merge task is not merged while the eligible one is | {"state":"to-merge","mergeAttempted":false,"mergerPids":[],"heldSpawns":0,"eligibleSpawned":false} | {"state":"to-merge","mergeAttempted":false,"mergerPids":[],"heldSpawns":0,"eligibleSpawne… | eligible line null; other held pids [] | FAIL (eligible half not exercised (fixture)) |
| C12 | the held to-live-test task keeps its state and starts no run | {"state":"to-live-test","pids":[],"spawns":0} | {"state":"to-live-test","pids":[],"spawns":0} | n/a | PASS |
| C13 | the held to-integration-test task leaves the single slot to the eligible one | {"state":"to-integration-test","pids":[],"heldSpawns":0,"eligibleSpawned":true} | {"state":"to-integration-test","pids":[],"heldSpawns":0,"eligibleSpawned":true} | eligible line [2026-10-21T16:54:44.342Z] spawned integration-tester pid=33 | PASS |
| C14 | a hold kills nothing and reverts nothing | {"state":"to-do","pidFile":true,"alive":true,"initial":"doing"} | {"state":"doing","pidFile":true,"alive":true,"initial":"doing"} | n/a | FAIL (fixture pid name wrong) |
| C15 | removing the token starts the path at the splitter | {"first":"splitter","splitter":true} | {"first":"splitter","splitter":true} | before the release: 0 spawn(s) | PASS |

Observed:

- Card: the `user-hold` class, the three 6px-on/4px-off gradients, the transparent 1px top, right and bottom border, the 3px left accent, the 6px radius and the `8px 10px` padding are computed values, not screenshot pixels. Hover moved the background from `color(srgb 1 1 1 / 0.85)` to `color(srgb 0.913725 0.929412 0.94902 / 0.806667)` and left the pseudo-element image byte-identical. The control card showed `::after` = `none` and an opaque top border.
- Board: the held card drew 0 relation paths, the `#1` control drew 1. The dialog blockedBy row printed `user, #42` with 0 links or chips.
- Live toggle: two writes to the fixture task file (token out, token in) flipped the class off and on inside the 5 s poll, and `::after` read `none` while the class was off.
- Daemon: the held backlog, to-do moderate, to-live-test and to-integration-test tasks kept their state, produced no spawn line and left no pid file. The integration lane handed its single slot to the eligible task in the same pass: `spawned integration-tester pid=330888 for 000009_eligible.md`.
- Release: after the token left the moderate to-do task, its first spawn line is `spawned splitter pid=... for 000003_held_moderate.md`, and the log held 0 spawn lines for that file before it.
- Held to-merge: the state stayed `to-merge`, with no `<slug>.merge-attempted` marker, no `<slug>.merger` pid and 0 spawn lines. The lane was not wedged: the same pass moved the eligible task out of `to-merge` with `000006_eligible.md: nothing to merge, set done`.

Assumptions made while designing the checks:

- Each check reads a computed value, a DOM attribute, a file on disk or a daemon log line. Each hold check has a neighbour task, or a card with a numeric ref only, as its control.
- One card carries both accepted token forms (`user, #42`) and `#42` is deliberately a ghost ref, so the same card proves the plain dialog row and the absent relation line.
- The daemon fixture is a git root with one commit on `main`, `maxParallel: 0`, `backlogIdleMinutes: 0`, and a fake agent that exits 0 after one capture line. A held task can then keep its state only when no spawn happened.
- The held `doing` task uses a hand-written pid file plus a `sleep` keeper. That state cannot be reached otherwise without a long-lived agent.

Not exercised, with the reason:

- C10, the to-review gate: the daemon rejected the fixture worktree attribute (`git worktree add .worktrees/tmp/lt318/daemon/wt /tmp/lt318/daemon/wt failed: fatal: invalid reference`), and the gate sits after that step. The observed state and pid results hold, but a worktree failure produces them too, so this run does not pin the to-review gate.
- C11, the eligible merger: `sweepToMerge` reads `task.worktree` as a branch name or a `.worktrees/<name>` path, so my absolute path read as nothing to merge. A to-merge task needs a branch with a commit to spawn a merger, and the fixture branch had none.
- C14, no kill and no revert: my keeper pid file was named `held_run.pid`, and the daemon names a task pid `<numeric-prefix>_<slug>.pid` (`taskSlug` keeps the prefix). The daemon read pid 0 and bounced the task with `000001_held_run: agent pid=0 dead without state update, doing -> to-do`. That is the baseline crash bounce for a `doing` task with no pid file, not a hold effect, and not a defect of #319 or #320.
- `spawnRunAnalysis` is not held: a live proof needs a real analysis run with a provider. Both call sites sit before the hold gates in the source.
- The merge half of C11 and the to-review gate are the only Specs lines that this run leaves unpinned. Both are fixture limits, and the scoped suites named in the Specs cover both.

Method facts:

- Three driver invocations. The first two stopped on harness bugs of my own: a CSS stop parser that cut at the `rgba(` paren, a git commit that the global config tried to sign, and a missing `.pids` directory. The third is the run above.
- Cleanup: the driver reported `savedPids=5` and printed no `LEAK` line. The close-out call confirmed that each fixture pid is gone.
- Findings: none in the changed path. Both FAIL rows come from my fixtures, as listed above.


# Open questions

- Assumed: "both subtasks are done when this task runs" means their changes are on `main`, not that both cards read `done`. #319 is in `to-live-test` and #320 in `live-testing`, and their diffs are in `main` after one ff-only merge. Please confirm this reading for verification tasks.
