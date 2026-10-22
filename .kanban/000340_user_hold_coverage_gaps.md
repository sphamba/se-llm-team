---
name: "test: pin the user-hold right border and the two unpinned release gates"
priority: "low"
state: "done"
worktree: ""
issuer: "#325"
complexity: "simple"
shortName: "user-hold-coverage-gaps"
---

# Summary
Two coverage gaps found by the integration runs of #320, #322, #319 and #318, both still open. The held card's solid right border is never asserted as transparent, so it could return behind the dashes unnoticed. And the hold release is pinned at backlog, to-do, to-review and to-integration-test, but parts UH2 and UH3 pin only the hold at to-live-test and to-merge, never that clearing blockedBy starts them again.

# Specs
## Gap 1: the held card's right border

`src/webui/page.ts:152` sets `border-top-color`, `border-right-color` and `border-bottom-color` to `transparent`, so the dashed `::after` strokes are the only edges. `tests/webui/page.test.ts:593` asserts only the top and bottom colours, so a solid right border left in place under the dashes still passes.

Add `border-right-color: transparent` to that assertion (or a second assertion beside it) with a message that names the right edge.

## Gap 2: the two unpinned release gates

Clearing `blockedBy` is pinned at four gates: backlog (`tests/orchestrator/promote.test.ts`), to-do (`tests/orchestrator/split.test.ts`), to-review (`tests/orchestrator/sweep.test.ts` part UH1, lines 386-400: `updateTask` then `rescan` then assert `reviewing` and the armed marker), and to-integration-test (`tests/orchestrator/integration.test.ts`).

The two other hold parts pin the hold only:

**part UH2, `tests/orchestrator/sweep.test.ts:401-437`** (to-live-test). After its existing assertions, clear the hold on `heldUH2`, `rescan` with the same `cfgUH2`, and assert the held task moved to `live-testing` and that `pidPath(rootUH2, taskSlug(heldUH2.file))` exists. Follow the UH1 pattern exactly.

**part UH3, `tests/orchestrator/merge.test.ts:585-618`** (to-merge). After its existing assertions, clear the hold on `heldUH3`, `rescan` with `cfgUH3`, and assert that main now contains `held-change` and that `heldUH3` left `to-merge` (it reaches `to-live-test`: both branches carry one empty commit on main, so the rebase is clean and the orchestrator fast-forwards without a merger). Assert the state, not only the log line.

Do not weaken or reorder the existing hold assertions. The release lines go after them.

## Acceptance

1. `node tests/webui/page.test.ts` passes.
2. `node tests/orchestrator/sweep.test.ts` passes.
3. `node tests/orchestrator/merge.test.ts` passes.
4. Revert one assertion locally and confirm the suite fails: the new right-border assertion must fail if `border-right-color` is dropped from the rule, and each release assertion must fail if the `blockedBy` clear is removed. Record the result in `# Notes`.

# Notes
`test:` code run, complexity simple. `test:` is a hint, not a classifier: the Specs name exact assertions and no read-only marker.

## What changed
- `tests/webui/page.test.ts` (Gap 1): `cssRule(".card.user-hold")` now also asserts `border-right-color: transparent`, message "the solid right border steps aside for the dashes too". The assertion sits beside the top/bottom one, and the `::after` dash assertions are unchanged.
- `tests/orchestrator/sweep.test.ts` part UH2 (Gap 2, to-live-test): after the hold assertions, `updateTask(rootUH2, heldUH2, { blockedBy: "" })` then `rescan(rootUH2, cfgUH2)` then assert state `live-testing` and `pidPath(rootUH2, taskSlug(heldUH2.file))` exists. UH1 pattern, same `cfgUH2`.
- `tests/orchestrator/merge.test.ts` part UH3 (Gap 2, to-merge): `updateTask` added to the `src/kanban.ts` import. After the hold assertions, clear `heldUH3`'s `blockedBy`, `rescan(rootUH3, cfgUH3)`, then assert `main` log contains `held-change` and state is `to-live-test` (asserted, not read from the log line). The branch rebases onto the moved base (`next-change` already on main) and fast-forwards with no merger.
- No source file changed. Both gaps were coverage holes over behaviour already on `main`.

## Acceptance
1. `node tests/webui/page.test.ts` — passes (exit 0).
2. `node tests/orchestrator/sweep.test.ts` — passes (exit 0).
3. `node tests/orchestrator/merge.test.ts` — passes (exit 0).
4. Red proof, each mutation reverted before the final run:
   - Dropped `border-right-color: transparent; ` from the `.card.user-hold` rule in `src/webui/page.ts` → page suite exit 1, `AssertionError: the solid right border steps aside for the dashes too`.
   - Commented out the UH2 `updateTask(rootUH2, heldUH2, { blockedBy: "" })` line → sweep suite exit 1, `AssertionError: the released task spawned the live-tester`.
   - Commented out the UH3 `updateTask(rootUH3, heldUH3, { blockedBy: "" })` line → merge suite exit 1, `AssertionError: the released branch rebased onto the moved base and fast-forwarded into it`.
   - After the restore all three suites ran green again. Only the three test files are modified (`git diff --stat`: 3 files, 10 insertions, 1 deletion).

Review of 0d1b91d (first pass):
- `tests/webui/page.test.ts:594` asserts `border-right-color: transparent` beside the top/bottom assertion at `:593`, and `src/webui/page.ts:152` is the only writer of that rule (no `classList` or reset path touches it).
- `tests/orchestrator/sweep.test.ts:431-434` clears `blockedBy` on `heldUH2`, rescans with `cfgUH2`, and asserts `live-testing` plus the pid file, after the hold assertions at `:428-430`.
- `tests/orchestrator/merge.test.ts:618-621` clears the hold on `heldUH3`, rescans with `cfgUH3`, asserts `held-change` on `main` and state `to-live-test`, after the hold assertions at `:613-617`; `updateTask` added to the import at `:6`.
Suites: webui/page, orchestrator/sweep, orchestrator/merge (the three Acceptance commands; test-only diff, no source change).
Tests: webui/page exit=0, orchestrator/sweep exit=0 (`user hold skips the live-tester spawn smoke passed`), orchestrator/merge exit=0 (`user hold skips the merge lane smoke passed`). Red proof taken from `# Notes`: dropping `border-right-color` and each `updateTask(... blockedBy: "")` line failed their suites with the recorded messages.

## Live test (live-tester)

Assumptions:
- The three Acceptance commands run `*.test.ts` files, which this role must not run, and no source can be edited. The live test replays the same behaviour through the production functions (`startHub` + `GET /`, `rescan`, `updateTask`, `parseTask`, `pidPath`) and checks the merged test files' content at the frozen lines.
- The commit is test-only, so the control tree (HEAD^ via `git archive`) carries identical production code: its absent content cells are the new assertions themselves, and its behaviour cells use the same fixtures without the release trigger (hold kept).
- Acceptance 4 red proof for the border: an archived copy of the merged tree has the token `border-right-color: transparent; ` dropped from `src/webui/page.ts` (no repo edit) and the held card's computed right border then reads `rgba(107, 125, 143, 0.12)`, so the new assertion fails. For the two release rows the trigger-absent probe leaves `to-live-test` / `to-merge` with no pid file and no `held-change` on main, so each release assertion fails when the `blockedBy` clear is absent.
- The fixture agent is a node stub that exits 0 at once, so the pid file is sampled right after `rescan`, where the spawn writes it.
- The CSS row is measured from the hub's real `GET /` response, with two probe cards injected into that page in Playwright and the mouse moved to `0, 0` before sampling.

Not exercised: the three test suites (forbidden here), the daemon CLI flags (`rescan` is the deciding path), and the page's client click flow (the change is CSS-only, no behaviour on click).

Driver: `/tmp/lt340/driver.mjs`, wrapper `/tmp/lt340/run.sh`. Merged tree `/home/phamba/repos/se-llm-team/.worktrees/test/340-user-hold-coverage-gaps` at `c4f2e68`; control tree `/tmp/lt340/pre-fix` at `archived (no git metadata)` (HEAD^), created with `git archive`. Merged runs: 3. Control runs: 1.

Changed files in the merged commit: tests/orchestrator/merge.test.ts, tests/orchestrator/sweep.test.ts, tests/webui/page.test.ts. No source or runtime file changed, so the control tree behaves the same and its absent cells are the new assertions themselves.

| id | claim | expected | merged (3 runs) | control |
| --- | --- | --- | --- | --- |
| 1 | merged page.test.ts asserts the held card's right border colour is transparent | assertion present at tests/webui/page.test.ts:594 and after the top/bottom assertion at :593 | present@594, after the top/bottom one | absent |
| 2 | the served page's .card.user-hold rule makes the right border transparent on a held card | computed border-right-color alpha 0 on .card.user-hold, non-zero on .card (src/webui/page.ts:152) | held alpha 0 (rgba(0, 0, 0, 0)), plain alpha 0.12; source hub GET / | hold kept (plain card): alpha 0.12 (rgba(107, 125, 143, 0.12)) |
| 3 | merged sweep.test.ts part UH2 clears the hold, rescans, and asserts live-testing plus the pid file | updateTask blockedBy empty then rescan then state live-testing and pidPath exists at tests/orchestrator/sweep.test.ts:431-434 | present@433-434, after the hold lines | absent |
| 4 | a to-live-test task released from a user hold starts its live test | state live-testing and the live-tester pid file after rescan (src/orchestrator/pipeline.ts rescan spawn) | live-testing, pid yes | hold kept: to-live-test, pid no |
| 5 | merged merge.test.ts part UH3 clears the hold, rescans, and asserts main took held-change and the state left to-merge | updateTask blockedBy empty then rescan then main has held-change and state to-live-test at tests/orchestrator/merge.test.ts:618-621 | present@620-621, after the hold lines | absent |
| 6 | a to-merge task released from a user hold rebases and fast-forwards into main | main log has held-change and state to-live-test after rescan (sweepToMerge fast-forward) | main has held-change, state to-live-test | hold kept: main no held-change, state to-merge |

Red proof (Acceptance 4), no repo edit: the merged tree is archived to `/tmp/lt340/run/<label>-<n>/red`, the token `border-right-color: transparent; ` is dropped from `src/webui/page.ts` in that archive, and the page shell is re-rendered from that archive.

- merged run 1: css source=hub GET / response (status 200 on hub port 34795); dropped=true, held right=rgba(107, 125, 143, 0.12), alpha=0.12; UH2 held-before={"held":"to-live-test","heldPid":false,"next":"live-testing","nextPid":true}; UH3 held-before state=to-merge, main has held-change=false
- merged run 2: css source=hub GET / response (status 200 on hub port 39745); dropped=true, held right=rgba(107, 125, 143, 0.12), alpha=0.12; UH2 held-before={"held":"to-live-test","heldPid":false,"next":"live-testing","nextPid":true}; UH3 held-before state=to-merge, main has held-change=false
- merged run 3: css source=hub GET / response (status 200 on hub port 34191); dropped=true, held right=rgba(107, 125, 143, 0.12), alpha=0.12; UH2 held-before={"held":"to-live-test","heldPid":false,"next":"live-testing","nextPid":true}; UH3 held-before state=to-merge, main has held-change=false

All six rows agree across the 3 merged runs, and every control cell differs in the direction the change pins. No finding.
