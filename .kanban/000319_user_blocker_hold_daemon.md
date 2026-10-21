---
name: "feat: hold a task on a user blocker in the daemon gates"
priority: "medium"
state: "done"
worktree: ""
issuer: "#318"
complexity: "moderate"
shortName: "user-blocker-hold-daemon"
---

# Summary
Add the `user` hold token to blockedBy with one shared predicate in src/kanban.ts, skip a held task at all six daemon stage starts, pin the dropDoneBlockers behaviour with a test, and reword the docs and the splitter prompt to state the rule.

# Specs
## Token

`Task.blockedBy` stays a comma-joined string (`src/kanban.ts:191` parse, `:286-289` serialize): no parse or serialize change. A ref whose trimmed value equals `user` (case-insensitive) is a hold. It may mix with task refs (`user, #42`): the task waits for the user AND for every ref, and the refs keep their old meaning. `user` alone is valid.

Add one exported shared predicate `hasUserHold(blockedBy: string): boolean` in `src/kanban.ts`, next to `blockedNums` (`:366-377`): true when any comma part, trimmed and lowercased, equals `user`. The daemon gates below use it.

Only the PM writes or removes `user`; no code adds it. `dropDoneBlockers` (`src/orchestrator/pipeline.ts:630-663`) must keep it (it already does, because `parseInt("user")` is NaN and the filter keeps the ref); pin that with a test and do not change its code. `blockedNums` (`src/kanban.ts:370-377`) and `assertNoBlockCycle` (`:383-392`) already ignore it; leave them alone. Other non-numeric refs stay ignored as today (ghost refs); do not add validation that rejects them.

## Gates

All six gates are in `src/orchestrator/pipeline.ts`. Skip a held task: it keeps its source state, no agent pid file and no marker file is written, and the scan moves to the next eligible task, so one hold does not stall the lane. Never kill a running agent and never revert its state.

- backlog to to-do: `blockedByUndone` (`:614-621`) returns true when `hasUserHold(task.blockedBy)`. Both gate call sites in `promoteBacklog` (the snapshot pass and the fresh re-check) then hold the task.
- to-do (splitter and developer): `startTodo` (`:137`) re-reads at `:144-145`; put the check right after `:145`, before the splitter branch at `:146`, and return before `ensureWorktree`, `setState` and `spawnAgent`. This blocks both the Splitter (`:152`) and the developer fallthrough (`:155-157`) and writes no splitter marker, so removing the token restarts the path cleanly with the splitter first.
- to-review to reviewing: in the reviewer branch after `ensureWorktree` (`:498`), before the `setState` and `spawnAgent` at `:514-519`, so the task stays to-review and no armed marker is written.
- to-merge to merging: in `sweepToMerge`, guard before the worktree and rebase side effects (guard region `:238-248`, merge spawn `:293`): return before `ensureWorktree`, `setWorktree`, `git rebase` and `writeMergerSlug`, so a held task never leaves a stopped rebase behind. Do not guard inside `spawnAgent` alone.
- to-live-test to live-testing: the live-tester spawn at `:536`, before `setState` and `spawnAgent`.
- to-integration-test to integration-testing: `sweepToIntegrationTest` (`:331`), before `setState` and `writeMergerSlug` at `:338`.

Do NOT hold `spawnRunAnalysis` (`src/orchestrator/spawn.ts:274`, called from `liveness.ts:200`, `:229`, `pipeline.ts:235`): it analyses a finished run log, writes no board state, and holding it would lose the analysis.

## Tests

- `tests/kanban/blockedby.test.ts`: a `user` ref parses and round-trips; `user, #42` is kept verbatim; `hasUserHold` is true for `user`, `USER`, ` user ` and `user, #42`, false for `#42` and an empty list; the cycle guard ignores `user`.
- `tests/orchestrator/promote.test.ts`: a backlog task with `user` stays in backlog; with `user, #42` it stays; `dropDoneBlockers` keeps `user` while dropping a done `#42`; after `kanban_update` removes `user` the task promotes.
- One case per gate: splitter/developer (`tests/orchestrator/split.test.ts`), reviewer, merger, live-tester, integration-tester. Each asserts the source state is kept and no agent pid or marker file is written, and for the single-slot merger and integration lanes that the next eligible task still runs. Use the existing fixtures in `tests/helpers.ts`.
- Run the touched suites only, never the full suite: `node scripts/test-changed.mjs`, plus the specific test files you changed.

## Docs

- `skills/se-llm-team/SKILL.md:18` (state order), `:33` ("blockedBy only gates promotion"), `:37` ("never edit blockedBy after creation"): the PM adds the `user` token with `kanban_update` at the user's request (preserving the refs, for example `user, #42`) and on release removes only the `user` token; a held task starts no stage and a running agent finishes its current stage and stops at the next gate.
- `docs/architecture.md:19-20` (promotion and auto-drop, and the to-do splitter bullet): a `user` ref holds the task, it survives the auto-drop, and a held task never reaches the splitter or the developer.
- `docs/agents-and-tools.md:7` and `:13`: the splitter runs at the root and never on a held task.
- `agents/splitter.md:9-11`: state that a held task never reaches the Splitter, because the hold check sits before the splitter branch.

## Out of scope

No migration of existing task files. No auto-removal of `user`. No kill of a running agent. No relation line and no card styling: the web UI is the sibling subtask, so do not touch `src/webui/*` or `tests/webui/*`. No change to issuer, priority or complexity. No new validation of other non-numeric refs.

## Split scope

Do not split further. The predicate, the six gate sites and their per-gate tests land together in one pipeline file and one worktree.

# Notes

Review of 84a0c8c (first pass, empty committed diff): HEAD is an ancestor of main b7596fc, so the only work in the worktree is 5 uncommitted test-file edits and the feature itself is absent.
- `src/kanban.ts:369` `blockedNums` is untouched and still private: `rg -n hasUserHold src` prints nothing, so the shared predicate does not exist.
- `src/orchestrator/pipeline.ts:614` `blockedByUndone` still reads task refs only, and the six gates are unguarded at `:137` `startTodo`, `:220` `sweepToMerge`, `:329` `sweepToIntegrationTest`, `:520` reviewer spawn and `:546` live-tester spawn.
- `git diff main...HEAD --stat` is empty, so `## Docs` is untouched: `skills/se-llm-team/SKILL.md`, `docs/architecture.md`, `docs/agents-and-tools.md` and `agents/splitter.md` keep the old wording.
- `git status --short` lists only `tests/kanban/blockedby.test.ts` and `tests/orchestrator/{merge,promote,split,sweep}.test.ts`, all uncommitted.
- Tests: `node scripts/test-changed.mjs` exit=1, halted at merge.test.ts:611 "the held task stays in to-merge"; blockedby exit=1, SyntaxError "does not provide an export named 'hasUserHold'"; promote exit=1 at :752 "a user hold holds every promotion" (2 !== 0); split exit=1 at :170; sweep exit=1 at :392.
- Keep the five test cases: they match the Specs test list, so commit them with the implementation. Rebase onto main b7596fc first, because the branch sits on the stale 84a0c8c and the Specs line anchors came from a newer tree.
- `tests/orchestrator/promote.test.ts:420` ("a fresh task file still defers promotion within the window") failed in one of two runs and sits before this task's case: a pre-existing timing flake under load, recorded for a separate task, not this one.
- Nit: the uncommitted merge/split/sweep cases never ran against an implementation, so their own assertions are unverified. Re-check the branch-at-HEAD setup in merge part UH3 when the guard lands.

## Splitter pass (no split)

Decision: do not split. State is unchanged, so the developer starts after this pass.
- One shared symbol (`hasUserHold` in `src/kanban.ts`) gates all six gate sites in `src/orchestrator/pipeline.ts`. A subtask for the predicate and a subtask for the gates would serialize, so the split saves no time.
- The parent #318 already made the split that pays: #319 (daemon and docs) and #320 (card, `src/webui/*`, state doing). The Out of scope section keeps this task out of `src/webui/*`, so the two worktrees do not collide.
- Two subtasks would cost two review passes, two merge cycles and two live tests on almost the same test suites. That overhead is more than the time saved.
- Guidance for a future Splitter on a task of this kind: first find the shared symbol and count the files that it touches. A predicate plus its call sites is one unit of work, not a fan-out.


## Developer pass (implementation)

Rebased onto main b7596fc (was 84a0c8c): stashed the five uncommitted test files, `git merge --ff-only main`, popped them back, and kept every case.
- `src/kanban.ts`: new exported `hasUserHold(blockedBy)` before `blockedNums`. `blockedNums`, `assertNoBlockCycle`, the parse and the serialize paths are unchanged.
- `src/orchestrator/pipeline.ts`: six guards on that one predicate. `blockedByUndone` first (so both `promoteBacklog` call sites hold the task), `startTodo` after the fresh to-do read and before the splitter branch, the reviewer branch after `ensureWorktree` as the Specs anchor says (a held task may still get a worktree), `sweepToMerge` before `const wt` so no setWorktree, rebase, fast-forward or merger slug runs, the to-live-test branch before the merged-branch test so a hold never requeues, and `sweepToIntegrationTest` first. `dropDoneBlockers` and `spawnRunAnalysis` unchanged.
- Tests: kept the five uncommitted cases and added the missing integration-gate case as part 16 of `tests/orchestrator/integration.test.ts` (held task keeps to-integration-test, the next eligible task takes the single slot, and the released task starts its run). Red proved for part 16 with the source stashed: exit=1 at line 639, "the held task stays in to-integration-test", actual integration-testing.
- Green: `tests/kanban/blockedby.test.ts`, `tests/orchestrator/{promote,split,sweep,merge,integration}.test.ts` all exit=0.
- Docs: `skills/se-llm-team/SKILL.md:18`, `:33`, `:37`, `docs/architecture.md` backlog and to-do bullets, `docs/agents-and-tools.md:7` and the Splitter table row, and `agents/splitter.md` after the split steps.
- Skipped `node scripts/test-changed.mjs`: `src/orchestrator/pipeline.ts` matches no RULES entry, so the script falls back to running every suite. Ran the six touched suites instead.
- `tests/orchestrator/spawn.test.ts` fails at "timeout waiting for the integration task runs to done and folds into the mirror" with and without this diff (base probe: stash, run, pop, same exit=1 and the same daemon log), so it is pre-existing. It is not in the Specs test list.

## Reviewer pass (1)

Review of ed99f3b (first pass): fix 30a425f scopes one false doc claim; code and tests hold.
- `src/kanban.ts:370` `hasUserHold` is the one predicate, and all six `spawnAgent` sites in `src/orchestrator/pipeline.ts` sit behind it (`:148` to-do, `:254` merge, `:337` integration, `:511` reviewer, `:538` live test, `:629` backlog). `spawnRunAnalysis` at `:238` still runs ahead of the merge guard, as the Specs require.
- `src/orchestrator/pipeline.ts:738` and `:745` route both promotion call sites through the predicate, and `dropDoneBlockers` (`:645`) keeps `user` by its unchanged `num > 0` filter. `blockedNums` and `assertNoBlockCycle` are untouched.
- Fixed in 30a425f: `skills/se-llm-team/SKILL.md:33` claimed "blockedBy gates every stage start ... a task with an unfinished blocker starts no stage". The code holds only on the `user` token, so the line now scopes the stage gate to the hold token and leaves plain refs gating promotion.
- Docs match the six gates: `docs/architecture.md:19-20`, `docs/agents-and-tools.md:7` and `:13`, `agents/splitter.md:13`.
- Tests: blockedby exit=0, promote exit=0, split exit=0, sweep exit=0, merge exit=0, integration exit=0. One case per gate, each asserting the kept source state plus the absent pid or marker, and UH2/UH3/part 16 assert the next eligible task takes the lane.
- Nit: the to-live-test guard at `:538` sits before the unmerged-branch requeue, one step earlier than the Specs anchor. That is stricter and matches "keeps its source state", so no change. Upgrade path: move it after the requeue only if a held task must still be corrected to to-merge.
- Nit: the reviewer guard reads the sweep snapshot at `:511`, not a fresh read like `startTodo` at `:146`. A hold written mid-sweep lands on the next sweep, which cannot race a spawn inside one sweep. Upgrade path: re-read there too if a same-sweep release must take effect.

## Reviewer pass (2)

Re-review of 30a425f: the docs fix holds, so no code change and the Specs are met.
- `skills/se-llm-team/SKILL.md:33` now reads "blockedBy gates promotion ... A `user` ref ... holds the task at every stage start, so a held task starts no stage", which matches `src/kanban.ts:370` `hasUserHold` and its six call sites in `src/orchestrator/pipeline.ts` (`:148`, `:254`, `:337`, `:511`, `:538`, `:629`).
- The fix is one line in one file: `git show 30a425f --stat` prints `skills/se-llm-team/SKILL.md | 2 +-`, and no test or source file changed since ed99f3b, so the pass-1 findings stand.
- One `rg` over `skills agents docs` for "gates every stage", "gates promotion" and "starts no stage" prints only the two correct lines at `skills/se-llm-team/SKILL.md:18` and `:33`, so the false claim does not remain anywhere else.
- Tests: plugin exit=0, blockedby exit=0, promote exit=0, split exit=0, sweep exit=0, merge exit=0, integration exit=0.
- Note: `tests/orchestrator/spawn.test.ts` is red at base with and without this diff (developer base probe). It sits outside this change set, and the repo-wide gate belongs to the integration ladder, so it does not block this card.


## Live test (2026-10-21)

Lane: daemon e2e with a fixture board and a fake agent, plus the docs lane with no process. No test suite ran. One driver (`/tmp/lt319/driver.mjs`, `run.sh`) ran on both trees with one label argument. Merged tree `41ad23b` is 30 of 30. The pre-fix control (`git archive HEAD^^`, commit `d51a72e`) is 13 of 30, and every hold claim flips there.

Tree proof: `git log --oneline -1` prints `41ad23b docs(skill): scope the stage-start gate to the user hold token`. `grep -n hasUserHold src` prints `src/kanban.ts:370` and the six gate sites in `src/orchestrator/pipeline.ts` (`:632`, `:148`, `:514`, `:254`, `:541`, `:337`). `git diff --stat HEAD^^..HEAD` lists 12 files, and none of them is under `src/webui/` or `tests/webui/`, so the Out of scope line holds.

Driver setup: a git fixture root (`main` ahead of a `ctrlmerge` branch, `holdlive` at an ancestor of `main`), 13 tasks from `createTask`/`setState`/`updateAttrs`, one held task per gate plus a control task beside it. Config: `backlogIdleMinutes: 0`, `pollMinutes: 0.05`, no `maxParallel` cap, `SE_LLM_TEAM_NO_WEBUI=1`, fixture `HOME` and `XDG_CONFIG_HOME`. The daemon ran with `--rescan-seconds 1` from the tree under test. The fake agent writes one capture line (role, task file, cwd, pid) and stays alive, so no state cascades. The driver stops the daemon and then kills every agent pid the board can name. `CLEANUP savedPids=7 stillAlive=[]` on the merged tree, `savedPids=11 stillAlive=[]` on the control.

| id | claim (printed actual value) | merged tree | pre-fix control |
| --- | --- | --- | --- |
| id | claim (printed actual value) | merged tree | pre-fix control |
| --- | --- | --- | --- |
| C16 | doc needles present | 9 PASS | 0 FAIL |
| C17 | doc links resolve | 11/11 PASS | 11/11 PASS |
| C1 | backlog hold keeps backlog | backlog PASS | doing FAIL |
| C2 | mixed hold: state | backlog PASS | doing FAIL |
| C2 | mixed hold: blockedBy after auto-drop | user PASS | user PASS |
| C3 | control backlog promotes | promoted PASS | promoted PASS |
| C4 | to-do splitter hold: state | to-do PASS | to-do PASS |
| C4 | to-do splitter hold: no splitter pid | false PASS | true FAIL |
| C5 | to-do developer hold: state | to-do PASS | doing FAIL |
| C5 | to-do developer hold: no developer pid | false PASS | true FAIL |
| C6 | control to-do starts the developer | doing,true PASS | doing,true PASS |
| C7 | to-review hold: state | to-review PASS | reviewing FAIL |
| C7 | to-review hold: no reviewer pid | false PASS | true FAIL |
| C7 | to-review hold: no armed marker | false PASS | true FAIL |
| C8 | to-merge hold: state | to-merge PASS | done FAIL |
| C8 | to-merge hold: no merger pid | false PASS | false PASS |
| C8 | to-merge hold: no merge-attempted marker | false PASS | false PASS |
| C8 | to-merge hold: no branch left behind | (empty) PASS | (empty) PASS |
| C8 | to-merge hold: no worktree created | false PASS | false PASS |
| C9 | control to-merge merged | true,true PASS | true,true PASS |
| C10 | to-live-test hold: state | to-live-test PASS | live-testing FAIL |
| C10 | to-live-test hold: no live-tester pid | false PASS | true FAIL |
| C10 | to-live-test hold: no worktree created | false PASS | true FAIL |
| C11 | to-integration-test hold: state | to-integration-test PASS | integration-testing FAIL |
| C12 | control takes the single integration slot | integration-testing,true PASS | to-integration-test,true FAIL |
| C12 | integration slug file names the control | 000013_ctrl_int PASS | 000012_hold_int FAIL |
| C13 | no held lane spawned an agent | 0 PASS | 3 FAIL |
| C14 | released to-do starts the splitter | true PASS | true PASS |
| C14 | released to-do keeps to-do | to-do PASS | to-do PASS |
| C15 | released backlog promotes | promoted PASS | promoted PASS |

Reading of the table: a merged PASS with a control FAIL is the change claim. C3, C6, C9, C14, C15 and C17 are keep-green rows and pass on both trees. `C2 blockedBy` is keep-green on purpose: `dropDoneBlockers` is unchanged by the task, so it keeps `user` in both trees and the state row carries the change claim.

Printed spawn capture on the merged tree: `developer` for `feat/7-ctrl-todo-dev` and `feat/4-ctrl-backlog`, `integration-tester` for `000013_ctrl_int.md`, `live-tester` for `.worktrees/ctrlmerge`. No held task appears. On the control the same capture lists 3 held lanes (the splitter for `000005_hold_todo_split.md`, the reviewer in `.worktrees/holdreview`, the integration-tester for `000012_hold_int.md`).

Assumptions that shaped the checks:
- The driver writes the fixture with `createTask`, `setState` and `updateAttrs` from `src/kanban.ts`. That is the write path the PM's `kanban_update` tool uses. No real PM agent ran.
- The release step is one `updateAttrs(fresh, { blockedBy: "" })` on the held backlog task and on the held to-do task. That is the PM's release path. The first rescan after it starts the Splitter and promotes the backlog task.
- The fake agent stays alive for 180 s. The run ends after about 15 s, so no agent exit changes a state under an assertion.
- `backlogIdleMinutes: 0` disables the board quiet window. The Specs do not cover that window, and a 1 minute default would hide the promotion gate.
- The to-merge control branch is one commit behind `main` and has no conflict. On the control tree the held to-merge task reads `nothing to merge, set done`, because its worktree branch did not exist yet. The task still advanced, so the control cell is a true FAIL. No rebase conflict was set up.
- The integration lane claim uses the global `integration-tester` pid and its `.slug` file, which the Specs name as the single slot.

Not exercised:
- The Merger spawn on a stopped rebase. The fixture has no conflict, so no merger agent starts in either tree. The held to-merge task leaves no branch, no worktree, no merger pid and no marker, and the base branch does not move for it.
- `spawnRunAnalysis`, which the Specs leave unguarded. No run wrote an exit code 0 while a task sat in to-merge, so it never fired.
- The `user` token written by a live PM agent through the MCP `kanban_update` tool, and the card marker in the web UI (Out of scope, sibling task #320).
- The task's own test files and `scripts/test-changed.mjs`. Live test rules forbid a suite run.

No finding. Each Specs gate holds on the merged tree, the control tree shows the difference, and the docs carry the new wording. Two harness bugs came up and were fixed inside one cycle: the host git config signs commits (the fixture sets `commit.gpgsign false`), and the to-merge control expectation now accepts the follow-on live-test state that a 1 s rescan reaches.
