---
name: "refactor: the merger runs no test suite"
priority: "medium"
state: "backlog"
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

2. `tests/orchestrator/merge.test.ts` part AL (the merger-prompt assertion block, around line 429-437)
   - Replace line 434's positive assertion `promptAL.includes("run the full test suite in your worktree")` with two assertions: the prompt includes `You run no test suite`, and the prompt does not include `run the full test suite`.
   - Keep every other assertion in that block unchanged.
   - Update the part AL comment at line 394 only if its wording now lies.

3. `docs/agents-and-tools.md:21`: the sentence `The Merger runs the full test suite after it concludes the rebase.` becomes `The Merger resolves rebase conflicts only and runs no test suite.` Keep the Integration-tester sentence that follows, unchanged.

4. `docs/architecture.md:25`: replace `It reports test failures in # Notes and moves no state.` with `It runs no test suite and moves no state.` Keep the rest of the paragraph.

5. Do not edit `.kanban/AGENTS.merger.md`. It is gitignored and the doctor rewrites it in full from a merger run log. Its `## Tests` section still says `npm test`, so the new clause in `agents/merger.md` is the override until the next doctor pass prunes it. Do not commit that file, and do not add a note about it to the repo.

6. No other file changes. No new dependency. No behaviour change in `src/`.

## Acceptance

Run from the task worktree. Every command must exit 0.

1. `node tests/orchestrator/merge.test.ts`
2. `node tests/orchestrator/spawn.test.ts`
3. `! grep -q "run the full test suite" agents/merger.md`
4. `grep -qx ".*You run no test suite: the integration stage tests the merged base.*" agents/merger.md` (`grep -c "You run no test suite" agents/merger.md` returns 1)
5. `grep -n "^[0-9]\\. " agents/merger.md` prints exactly five steps, numbered 1 to 5, with no gap and no test step
6. `! grep -rn "full test suite" agents/merger.md docs/architecture.md` and `grep -rn "full test suite" agents/ docs/ README.md` returns only lines about the Integration-tester, the Developer, the Reviewer, and the integration stage
7. `git status --short` shows exactly four modified files: `agents/merger.md`, `tests/orchestrator/merge.test.ts`, `docs/agents-and-tools.md`, `docs/architecture.md`

# Notes
