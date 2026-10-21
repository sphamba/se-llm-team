---
name: "refactor: the merger runs no test suite"
priority: "medium"
state: "done"
worktree: ""
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

## Live test
Usage tests only, on the merged tip `2273595` against the pre-fix control `c7a71d3` (the feature's parent, archived with `git archive` to `/tmp/merger-no-suite/pre-fix`). Driver `/tmp/merger-no-suite/driver.mjs` with `/tmp/merger-no-suite/run.sh`, result JSON `/tmp/merger-no-suite/result.json`, run log `/tmp/merger-no-suite/run.log`. No test suite was run.

The prompt lane is one real daemon per tree: a git fixture whose branch edits `README.md` the way `main` does, so the daemon stops the rebase and spawns the merger in the task worktree. A recorder fake agent writes the `-p` argv prompt into the worktree, so C3 and C4 sample the prompt the merger actually receives, not only the file on disk.

| id | claim | actual | expected | control | result |
| --- | --- | --- | --- | --- | --- |
| C1 | agents/merger.md drops the full-suite clause and names the no-suite rule once | merged: "You run no test suite: the integration stage tests the merged base." x1, "run the full test suite" x0, "full test suite" x0 | new sentence x1, no full-suite text at all | pre-fix: "You run no test suite" x0, "run the full test suite in your worktree" x1 | PASS |
| C2 | agents/merger.md has five numbered steps, no test step, and step 5 is the old step 6 | merged: steps 1,2,3,4,5; test steps 0; step 5 equals pre-fix step 6: true | steps 1,2,3,4,5, no test step, step 5 is the old step 6 | pre-fix: steps 1,2,3,4,5,6; step 5 = "When tests fail, finish normally anyway and report the failu" | PASS |
| C3 | the merger prompt the daemon spawns carries the no-suite rule and no full-suite run | captured merger prompt: "You run no test suite" x1, "full test suite" x0, len 2437 | spawned prompt has the no-suite sentence, no "full test suite" | pre-fix prompt: "You run no test suite" x0, "run the full test suite in your worktree" x1 | PASS |
| C4 | the spawned merger prompt keeps the rest of the conflict-only contract | missing tokens []; leaks []; len 2437 | all contract tokens present, no absolute path and no placeholder | pre-fix prompt has the same tokens | PASS |
| C5 | docs/agents-and-tools.md and docs/architecture.md name the new contract | agents-and-tools: new x1, old x0; architecture: new x1, old x0 | both new sentences x1, both old sentences x0 | pre-fix: agents-and-tools old x1, architecture old x1 | PASS |
| C6 | "full test suite" survives only in the Developer, Reviewer and Integration-tester lines | merged hits 3: agents/developer.md, agents/integration-tester.md, agents/reviewer.md; off-list [] | every hit is in the Developer, Reviewer or Integration-tester prompt | pre-fix hits 5: agents/developer.md, agents/integration-tester.md, agents/merger.md, agents/reviewer.md, docs/agents-and-tools.md | PASS |
| C7 | the part AL assertions carry the two Specs lines verbatim, messages included | line 1 verbatim false; line 2 verbatim false; old positive line gone true; found: assert.ok(promptAL.includes("You run no test suite"), "the merger runs no test suite"); \|\| assert.ok(!promptAL.includes("run the full test suite"), "the merger prompt names no full suite run"); | both Specs lines present verbatim, old positive line gone | (empty) | FAIL |
| C8 | the change set is exactly the four Specs files and touches no src/ | files ["agents/merger.md","docs/agents-and-tools.md","docs/architecture.md","tests/orchestrator/merge.test.ts"]; src files 0 | exactly ["agents/merger.md","docs/agents-and-tools.md","docs/architecture.md","tests/orchestrator/merge.test.ts"], no src/ | (archived control has no git metadata) | PASS |

Assumptions:
- C7 compares the assertion messages, because Specs item 2 says "exactly these two lines" and those lines carry messages. If only the two predicates are meant, C7 is cosmetic.
- The control is the feature's parent `c7a71d3`. An archived tree has no git metadata, so the C8 control cell is empty.
- The recorder agent exits without resolving, so each tree spawns one merger and no second rebase round exists. The merger cooldown and cap are not part of this change.
- `.kanban/AGENTS.merger.md` is gitignored and Specs item 5 forbids this task from editing it, so it was not checked.

Contradiction with the task's stated assumptions: none observed. The change set holds exactly the four Specs files and no `src/` file (C8).

Not exercised: `node tests/orchestrator/merge.test.ts` and `node tests/orchestrator/spawn.test.ts` (acceptance 1 and 2), because live tests never run a test suite. The part AL scenario was replayed through the production spawn path instead (C3, C4) and the test file content was read (C7).

Finding, non-blocking: the two replacement assertions in part AL carry the messages `the merger runs no test suite` and `the merger prompt names no full suite run`, not the Specs messages `the merger runs no suite: the integration stage owns the test gate` and `the old full-suite requirement is gone`. The predicates match the Specs and the old positive assertion is gone, so no claim flips.

# Open questions
- Assumption: the new sentence sits right after the `git rebase --continue` sentence, at the point the deleted clause held.
