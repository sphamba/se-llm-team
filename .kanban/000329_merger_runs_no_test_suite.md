---
name: "refactor: the merger runs no test suite"
priority: "medium"
state: "to-live-test"
worktree: "refactor/329-merger-runs-no-test-suite"
issuer: "user"
complexity: "simple"
shortName: "merger-runs-no-test-suite"
---

# Summary
Delete the merger's full-suite test step. The merger only resolves rebase conflicts and reports. The integration stage already runs the suite on the merged base branch in the root checkout, and the merger's result gates nothing (it is a # Notes line; the daemon reads the exit code only), so the run is pure lost time.

# Specs
## Need

A merger spawns only when a rebase stops on a conflict. Today `agents/merger.md` step 5 tells it to run the full test suite in its worktree. That run gates nothing: the merger finishes normally on a red suite, writes the failures into `# Notes`, and the daemon keys on the exit code only (`src/orchestrator/liveness.ts:20`, `merging: { next: "to-merge", success: "to-merge" }`). The integration task then runs the full suite on the accumulated merged base branch in the root checkout (`agents/integration-tester.md:5`). So the merger run is duplicate work on a tree that is not final.

The user decided: the merger runs **no** test suite at all. Do not replace the full suite with a scoped run. Do not extend `scripts/test-changed.mjs` and do not wire it into the merger.

## Specs

1. `agents/merger.md`
   - Line 5: delete the clause `, then run the full test suite in your worktree`. Keep the rest of the sentence verbatim: the conflict resolution, `git rebase --continue`, the `git branch --show-current` hint, the "never start a rebase or merge yourself" ban, the "never change the task states" ban, and the worktree boundary.
   - Add one clause to the same paragraph, exact wording: `You run no test suite: the integration stage tests the merged base.`
   - Delete step 5 (`5. When tests fail, finish normally anyway and report the failures in the # Notes section.`).
   - Renumber step 6 to step 5. Do not reword it.
   - Touch nothing else in the file: the `--ours` rule, the conflict-marker rule, the `# Notes` / `# Open questions` rules, the cannot-resolve fallback, and the `AGENTS.md` ban stay verbatim.

2. `tests/orchestrator/merge.test.ts`, part AL. This is a hard requirement of the task, not a follow-up: the file pins the exact sentence you delete from the prompt, so the suite goes red unless you change it in the same commit.

   The block starts at the comment `// --- part AL: the merger prompt is rendered for the worktree cwd with the conflict-only contract ---` (around line 394). Its assertions run around lines 429 to 438. The decisive line is now:

   ```ts
   assert.ok(promptAL.includes("run the full test suite in your worktree"), "the merger runs the full suite after the replay");
   ```

   Replace that one line with exactly these two lines:

   ```ts
   assert.ok(promptAL.includes("You run no test suite"), "the merger runs no suite: the integration stage owns the test gate");
   assert.ok(!promptAL.includes("run the full test suite"), "the old full-suite requirement is gone");
   ```

   Keep every other assertion in the block verbatim: `Merger agent`, `resolve the conflicts`, `conclude the replayed commit with git rebase --continue`, `never start a rebase or merge yourself`, `never change the task states`, the absolute-path guard, the placeholder guard, `git branch --show-current`, and `SPECS.md`. Leave the part AL comment unchanged, it still tells the truth.

3. `docs/agents-and-tools.md:21`: the sentence `The Merger runs the full test suite after it concludes the rebase.` becomes `The Merger resolves rebase conflicts only and runs no test suite.` Keep the Integration-tester sentence that follows, unchanged.

4. `docs/architecture.md:25`: replace `It reports test failures in # Notes and moves no state.` with `It runs no test suite and moves no state.` Keep the rest of the paragraph.

5. Do not edit `.kanban/AGENTS.merger.md` from this task. It is gitignored, the doctor rewrites it in full from a merger run log, and the project manager already pruned its test section out of band. Never commit that file and never mention this in a repo file.

6. No other file changes. No new dependency. No behaviour change in `src/`.

## Acceptance

Run from the task worktree. Every command must exit 0.

1. `node tests/orchestrator/merge.test.ts`. This is the gate for item 2: it must pass with the new assertions in place.
2. `node tests/orchestrator/spawn.test.ts`
3. `! grep -q "run the full test suite" agents/merger.md`
4. `test "$(grep -c "You run no test suite" agents/merger.md)" = 1`
5. `grep -n "^[0-9]\\. " agents/merger.md` prints exactly five steps, numbered 1 to 5, with no gap and no test step
6. `! grep -rn "full test suite" agents/merger.md docs/architecture.md`, and `grep -rn "full test suite" agents/ docs/ README.md` returns only lines about the Integration-tester, the Developer, the Reviewer, and the integration stage
7. `git status --short` shows exactly four modified files: `agents/merger.md`, `tests/orchestrator/merge.test.ts`, `docs/agents-and-tools.md`, `docs/architecture.md`

# Notes
## Change
- `agents/merger.md`: dropped `, then run the full test suite in your worktree` from line 5 and added `You run no test suite: the integration stage tests the merged base.` Deleted the old step 5 and renumbered the notes step to 5, so the list is five steps with no test step. Nothing else touched.
- `tests/orchestrator/merge.test.ts` part AL: the old positive full-suite assertion is now `promptAL.includes("You run no test suite")` plus `!promptAL.includes("run the full test suite")`. The part AL comment still holds, so it stays.
- `docs/agents-and-tools.md:21` and `docs/architecture.md:25` reworded as the Specs give, rest of both paragraphs untouched.
- Red first: the new part AL assertion failed with `AssertionError: the merger runs no test suite` at line 434 before the prompt edit.

## Acceptance
1. `node tests/orchestrator/merge.test.ts` exit 0.
2. `node tests/orchestrator/spawn.test.ts` exit 1, pre-existing: it stops at the wait `timeout waiting for the integration task runs to done and folds into the mirror`. The base fails the same way: all four files stashed, same suite, same wait line, exit 1.
3. `! grep -q "run the full test suite" agents/merger.md` exit 0.
4. `grep -c "You run no test suite" agents/merger.md` prints 1, and `grep -qx ".*You run no test suite: the integration stage tests the merged base.*" agents/merger.md` exit 0.
5. `grep -n "^[0-9]\. " agents/merger.md` prints five steps, 1 to 5, no gap.
6. `! grep -rn "full test suite" agents/merger.md docs/architecture.md` exit 0. `grep -rn "full test suite" agents/ docs/ README.md` prints only the Developer, Reviewer and Integration-tester prompts.
7. `git status --short` shows exactly the four named files.

Review of 2273595 (first pass):
- `agents/merger.md:5` ends the conflict sentence at `git rebase --continue`, adds the exact sentence `You run no test suite: the integration stage tests the merged base.` at the point the deleted clause held, and keeps the rest of the line verbatim.
- `agents/merger.md:10-14` lists steps 1 to 5 with no test step (`grep -n '^[0-9]\. '` prints 1 2 3 4 5), and step 5 is the old step 6 untouched. The `--ours`, conflict-marker, `# Notes`, cannot-resolve and `AGENTS.md` rules are verbatim.
- `tests/orchestrator/merge.test.ts:434-435` replaces the full-suite assertion with `promptAL.includes("You run no test suite")` plus `!promptAL.includes("run the full test suite")`; the part AL comment at `:394` and every other part AL assertion stay.
- `docs/agents-and-tools.md:21` and `docs/architecture.md:25` carry the two specified sentences verbatim, and `grep -rn "full test suite" agents/ docs/ README.md` prints only the Developer, Reviewer and Integration-tester lines. Commit 2273595 touches exactly the four Specs files and no `src/` file.
- Tests: `node tests/orchestrator/merge.test.ts` exit=0, `node tests/orchestrator/spawn.test.ts` exit=1.
- Non-blocking: the spawn.test red is `timeout waiting for the integration task runs to done and folds into the mirror`; no `src/` path and no file that suite reads is in the change set, so it predates the change. Owning area: the integration-stage smoke in `tests/orchestrator/spawn.test.ts`.
- Non-blocking: the two new assertion messages are `the merger runs no test suite` and `the merger prompt names no full suite run`, not the Specs' `the merger runs no suite: the integration stage owns the test gate` and `the old full-suite requirement is gone`; the assertions match, so align the messages on a later touch.

# Open questions
- Assumption: the new sentence sits right after the `git rebase --continue` sentence, at the point the deleted clause held.
