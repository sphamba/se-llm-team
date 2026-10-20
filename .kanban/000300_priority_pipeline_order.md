---
name: "feat: priority orders the pipeline under the cap"
priority: "high"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "priority-pipeline-order"
---

# Summary
When maxParallel binds, the scheduler must start higher-priority tasks first across the whole pipeline: sort the per-sweep task pass by priority (creation order within a tier) before the state loop. No preemption, promotion and splitter unchanged.

# Specs
# Problem

The scheduler has no priority awareness. rescan (src/orchestrator/pipeline.ts:322) takes one snapshot via listAll, which is name-sorted (creation order, src/kanban.ts:105-112), and the single state loop (pipeline.ts:345) handles every task in that order. The four maxParallel gates (developer pipeline.ts:64-65, merger :144-145, reviewer :388-389, live-tester :414-415) then serve whichever eligible task comes first by name. A low-priority task created earlier consumes slots before a critical one.

# Decided design (user-confirmed)

1. Sort the per-sweep task pass by priority before the state loop: critical, high, medium, low, with creation order inside a tier. Reuse PRIORITY_RANK from src/kanban.ts:22 (already used by the webui backlog sort, src/webui/board.ts:426); do not add a new ranking table. Sort ascending by PRIORITY_RANK if critical is the highest rank there, or descending, whichever matches the webui usage; keep it in one place.
2. The sort covers the whole state loop, so every capped stage (developer, reviewer, merger, live-tester) picks the highest-priority eligible task first. Effect: a critical task advances through the whole pipeline before lower-priority tasks when the cap binds.
3. Rely on a stable sort or sort by (priority, name) explicitly, so equal priorities keep today's creation order. Say which in a comment.

# Explicitly unchanged

- No preemption: a higher-priority task waits for the next free slot; running agents finish. No new kill paths.
- Backlog promotion (promoteBacklog, pipeline.ts:542) keeps its name order and stays uncapped (test part AY pins promotion to to-do at cap).
- The splitter spawn stays outside the cap (pipeline.ts:56). Even at a full cap, a moderate/complex task gets its split immediately; only the developer start waits.
- The cap itself, the dead-cooldown and respawn paths, the blockedBy and openQuestions gates stay as they are. Test part AH ("blocked critical task not promoted despite priority") must stay green.

# Tests

T1. Ordering under the cap: cap 1 with a low-priority to-review task and a critical to-do task, both eligible, in creation order low-before-critical. Assert the critical task's developer spawns first and the low task's reviewer waits (no reviewer pid file). Then free the slot and assert the reviewer spawns.
T2. Same-priority tie: two same-priority eligible to-do tasks at cap 1 promote/spawn in creation order.
T3. Keep green: promote.test.ts parts AX and AY, sweep.test.ts part AZ, config.test.ts part AQ. Note: no existing test pins ordering among multiple eligible tasks, so these are new pins, not edits.

# Docs

- docs/architecture.md: one sentence in the scheduling/per-state section: under the maxParallel cap the orchestrator starts higher-priority tasks first, creation order within a priority.
- README.md config table: extend the maxParallel row's meaning with "; when the cap binds, higher-priority tasks start first".

# Acceptance

- Scoped orchestrator suites green (promote, sweep, config, spawn as touched), run serially.
- T1 and T2 pass; the whole-pipeline effect is visible in the T1 assertion order.
- No new config key; no changes to promotion, splitter, or kill paths.

# Notes

- `src/orchestrator/pipeline.ts`: the state loop now iterates a stable sort of the sweep snapshot by `PRIORITY_RANK` ascending (critical first, unknown after low), so every capped stage sees the highest-priority eligible task first. The sort is a copy, so the create-commit loop, merger bookkeeping, `dropDoneBlockers`, `promoteBacklog`, and `reportDone` keep the original name order.
- Same-priority ties rely on the stable `Array.prototype.sort` over the name-sorted `listAll` snapshot; the comment in the code says so. No second key and no new rank table.
- `tests/orchestrator/promote.test.ts` part BD (T1): cap 1, low to-review created before critical to-do; the critical developer takes the slot and the low reviewer has no pid file, then spawns after the slot frees. Part BE (T2): two high-priority to-do tasks at cap 1 start in creation order.
- Red first: part BD failed before the change (`spawned reviewer pid=... for 000001_low_review_waits.md`, critical stayed `to-do`).
- Suites run serially and green: `tests/orchestrator/promote.test.ts`, `sweep.test.ts`, `config.test.ts`, `spawn.test.ts`, plus `split.test.ts` and `poll.test.ts` because they drive `rescan`.
- Docs: `docs/architecture.md` scheduling paragraph and the `maxParallel` row in `README.md`.

## Reviewer findings (first review of a9af2df)

Mode: first review. Claims: Decided design 1 to 3, Explicitly unchanged, Tests T1 to T3, Docs, Acceptance. Test union: all 13 `tests/orchestrator/*` suites plus `tests/context-symlinks.test.ts` (the diff changes `rescan`, a shared function).

- Design 1 (PASS): `src/orchestrator/pipeline.ts:348` reuses `PRIORITY_RANK` from `src/kanban.ts:22`, ascending, `?? 4` for unknown. This matches the webui use at `src/webui/board.ts:426`, so critical is first. No new rank table.
- Design 2 (PASS): the sort feeds the whole state loop at `pipeline.ts:349`. All four cap gates read `runningCount` inside the loop: developer `pipeline.ts:65`, merger `pipeline.ts:145`, reviewer `pipeline.ts:393`, live-tester `pipeline.ts:419`. So the first eligible task in priority order takes the slot.
- Design 3 (PASS): `pipeline.ts:345-347` names the stable `Array.prototype.sort` and why no second key is needed. `listAll` inherits the name sort of `taskFiles` (`src/kanban.ts:206`), so equal ranks keep creation order. This is true: the sort is stable on Node 24.
- Explicitly unchanged (PASS): `[...tasks]` copies, so the create-commit loop (`pipeline.ts:337`), the merger bookkeeping (`:444-448`), `janitorPids` (`:451`), `dropDoneBlockers` and `promoteBacklog` (`:460-461`) and `reportDone` (`:465`) keep the name order. No preemption path, no splitter change, no config key.
- Tests (PASS): T1 is `tests/orchestrator/promote.test.ts:668-702` (part BD). T2 is `:705-735` (part BE). T3 parts (AX, AY, AZ, AQ, AH) are green.
- Docs (PASS): one sentence at `docs/architecture.md:17`, the `maxParallel` row extended at `README.md:115`.
- Acceptance (PASS): no new config key. The T1 order shows the whole-pipeline effect: the critical developer takes the only slot, the low reviewer waits, then starts when the slot frees.

Red proof, one call: reverted `pipeline.ts` to `main`, ran `node tests/orchestrator/promote.test.ts` to `/tmp/rev300/promote-red.log`.
`exit=1`. Failure class: `AssertionError: the critical developer took the only slot`, `actual: 'to-do'`, `expected: 'doing'` (`promote-red.log:53,60-61`). Restored the tree: `git status --short` was empty. So part BD pins the change and not only the cap.

Suites, all green, exit 0, serial groups: promote, sweep, config, spawn, split, poll, merge, analysis, daemon, worktree, singleton, hub, log, plus `tests/context-symlinks.test.ts`. Full suite not run.

Non-blocking:
- The comparator `(PRIORITY_RANK[x] ?? 4) - (PRIORITY_RANK[y] ?? 4)` now sits in three places (`src/webui/board.ts:426`, `src/webui/payload.ts:619`, `src/orchestrator/pipeline.ts:348`). Design line 1 asks for one rank table, which holds. A shared `byPriority` helper is optional, and it only pays off when a fourth caller appears.
- `README.md:115` writes the new clause as its own sentence, not with the semicolon of the task text. Same meaning, and the project style bans semicolons.

Both docs claims of the developer Notes are correct. Note the `state: "reviewing"` frontmatter is the reviewer stage, so this review moves the task to to-merge.
## Live test 2026-10-21

Lane: daemon e2e with a fake agent, one fixture per claim, merged tree plus the parent commit `6683c6e` as the control. Driver `/tmp/lt300/driver.mjs`, runner `/tmp/lt300/run.sh`, log `/tmp/lt300/run.log`. Every run starts `node src/orchestrator.ts --root <fixture> --rescan-seconds 1 --poll-minutes 0.01` from the merged checkout, with `SE_LLM_TEAM_NO_WEBUI=1`, a fixture `HOME` and a fixture `XDG_CONFIG_HOME`. Each fixture is a fresh git repo with `.kanban/se-llm-team.json` (`agent` = fake agent, `maxParallel: 1`, `backlogIdleMinutes: 0`). The fake agent records role, task name, cwd and pid in a capture file, then keeps running, so the cap stays bound.

Assumptions:
- Freeing the cap slot stands for a user closing or finishing the running card: the driver rewrites the winner's frontmatter to `done`, then waits for the next sweep. The change has no control over when a slot frees.
- The fake agent never exits, so no later stage starts on its own. The waiting task is a `moderate` to-review task, because a `simple` to-review task skips the reviewer spawn.
- The low task is created first (name `000001_...`), the critical task second (`000002_...`), so name order is the pre-fix order.

| # | Claim | Printed proof, merged tree | Control, parent `6683c6e` |
| --- | --- | --- | --- |
| C1 | T1: priority orders the state pass under cap 1 | first spawn `role=developer task="feat: critical todo first"`. The low task stays `state=to-review`, no pid file, spawn count 1 after 2.6 s. After the critical card is set to `done`: spawn `role=reviewer task="fix: low review waits"`, `state=reviewing`, pid file present, spawn count 2 | first spawn `role=reviewer task="fix: low review waits"`, critical task `state=to-do`, no pid file. The defect is real without the change |
| C2 | T2: equal priorities keep creation order | cap 1, two high to-do tasks: first spawn `role=developer task="feat: older same tier"`, the younger stays `state=to-do` with no pid file after 2.6 s | same order, so the tie claim is a keep-green pin |
| C3 | Docs | `docs/architecture.md`: "Under the `maxParallel` cap the orchestrator starts higher-priority tasks first, with creation order inside a priority". README table (header `Key`, `Default`, `Meaning`), `maxParallel` meaning ends "When the cap binds, higher-priority tasks start first." | parent architecture text has no `higher-priority` sentence, parent meaning ends at "0 means no limit." |

Orchestrator log evidence, merged C1: `spawned developer pid=432295 for 000002_critical_todo_first.md` at 23:35:14, then `spawned reviewer pid=432361 for 000001_low_review_waits.md` at 23:35:17, after the slot freed. That is the whole-pipeline order that T1 asks for.

Cleanup: all four runs ended with `daemon_exit="0/null"` (exit 0, no signal), `still_alive=[]`, and an empty `pgrep -af <fixture-root>`. The pid files stay on disk because the driver SIGKILLs the fake agents and the wrapper's `rm -f` does not run after SIGKILL. No process survives. No port 4242 and no project daemon was touched.

Not exercised: promotion order, the splitter spawn outside the cap, the merger and live-tester cap gates, and the no-preemption and kill paths. The change does not touch them, and one capped pair (developer against reviewer) already shows the order. No observed behavior contradicts the Specs.

First run tally: 4 failures, all one checker bug (the fake agent stored the role marker "Developer agent" while the assertions compared "developer"). The fix was the agent's role mapping only, then the rerun above. No product finding.
