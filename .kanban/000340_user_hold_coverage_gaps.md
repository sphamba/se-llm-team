---
name: "test: pin the user-hold right border and the two unpinned release gates"
priority: "low"
state: "to-do"
worktree: "test/340-user-hold-coverage-gaps"
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
