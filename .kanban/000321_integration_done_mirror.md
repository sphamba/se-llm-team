---
name: "fix: assert the integration done state on the mirror tip, not a done commit"
priority: "high"
state: "done"
worktree: ""
issuer: "#315"
complexity: "simple"
shortName: "integration-done-mirror"
---

# Summary
`tests/orchestrator/spawn.test.ts` waits for a `kanban: done <integration file>` mirror subject. A higher-priority done fold in the same sweep can commit the same whole-board tree first, so the identical-tree guard skips the integration task's done commit. Wait for the integration file's done state at the mirror tip instead.

# Specs
## Problem

`tests/orchestrator/spawn.test.ts:44-52` waits for `mirrorSubjects(rootA).includes("kanban: done " + f)`. The wait times out in 3 of 3 runs, and `pnpm test` stops at this file.

The mirror is a whole-board snapshot. `commitKanban` rebuilds the tree from every board file at commit time and skips the commit when the tree equals the parent tree (`src/orchestrator/board.ts:32-67`). The rescan takes one `files` snapshot (`src/orchestrator/pipeline.ts:447`) and walks tasks by priority (`src/orchestrator/pipeline.ts:461`). The covered task's done fold (`src/orchestrator/pipeline.ts:555-562`) can commit the whole board after the integration file is already done on disk. The integration task's own done branch then calls `commitKanban` with the same tree, the identical-tree guard skips the commit, and no `kanban: done <integration file>` subject exists. The mirror still holds the correct final state. Only the per-task label is absent.

Reproduce: `node tests/orchestrator/spawn.test.ts` exits 1.

## Decision

The user declined to choose between a snapshot assertion and a per-done commit guarantee. The PM default is: the mirror is a snapshot, not an event log. Keep production code unchanged and assert content.

## Change

- In `tests/orchestrator/spawn.test.ts`, replace the integration wait's subject check with a content check on the mirror tip: `showTip(rootA, f)?.includes('state: "done"')`.
- Import `showTip` from `../helpers.ts`. It is already exported at `tests/helpers.ts:44`.
- Keep the covered task's `taskClean()` wait on `kanban: done <taskA.file>`. That commit exists.
- Add one comment above the integration wait: the mirror is a snapshot, a higher-priority done fold in the same sweep can absorb this file, so assert its content and not its done commit.
- Do not change `commitKanban`, the rescan, or any other test.

## Acceptance criteria

Run from the repo root in the worktree:

- `node tests/orchestrator/spawn.test.ts` exits 0 in 3 consecutive runs.
- `pnpm test` exits 0.
- `git diff --stat` shows only `tests/orchestrator/spawn.test.ts`.

# Notes

## Live test (2026-10-21)

Lane: no process for the test file content, plus a mirror probe through the production `commitKanban` at `src/orchestrator/board.ts:32`. Driver `/tmp/321-lt/driver.mjs`, runs `/tmp/321-lt/run-merged.log` and `/tmp/321-lt/run-control.log`. Merged tree `84a0c8c`, control `HEAD^` = `edf27f2`, extracted with `git archive HEAD^`.

The merged tree does not contain the change. The branch `fix/321-integration-done-mirror` has 0 commits above `main` (`git log main..fix/321-integration-done-mirror` is empty), `tests/orchestrator/spawn.test.ts` is identical to `main`, and the task file records no `Commit` bullet. Line 46 still reads `return !!f && mirrorSubjects(rootA).includes(\`kanban: done ${f}\`);`. The merge commit `84a0c8c` is the #313 root-prompt change, which also touches `src/orchestrator/spawn.ts`. The control fails in the same way as the merged tree, so the merged tree has no change to test.

| Check | Claim (Specs line) | Printed proof, merged `84a0c8c` | Control `edf27f2` |
| --- | --- | --- | --- |
| C1 | Change 1: the integration wait checks the mirror tip content | `actual=no showTip(rootA, f) line in the integration wait`, FAIL | same output, FAIL |
| C2 | Change 1: the old integration done-subject check is gone | `actual=1 mirrorSubjects(...) checks in the integration wait expected=0`, FAIL | same output, FAIL |
| C3 | Change 4: one comment above the wait names the snapshot and the absorbed fold | `actual=// the integration stage opens its own task after the live test: let that task reach done and its // fold-in commit land too, so the board mirror settles before its commit log is compared`, FAIL | same output, FAIL |
| C4 | Change 3: keep the covered task `taskClean()` wait on its done subject | `const taskClean = () => mirrorSubjects(rootA).includes(\`kanban: done ${taskA.file}\`);`, PASS | PASS |
| C5 | Change 2: import `showTip` from `../helpers.ts` | `import { HERE, fixture, mirrorSubjects, showTip, roleStub, argvStub, llmArgs, runDaemon, waitFor, cleanupAll, daemons, cleaned } from "../helpers.ts";`, PASS | PASS |
| C6 | Acceptance 3: the merge diff shows only the spawn test | `files=["src/orchestrator/spawn.ts","tests/orchestrator/spawn.test.ts"] production="src/orchestrator/spawn.ts"`, FAIL | no git metadata, SKIP |
| C7 | Problem: a higher-priority fold absorbs the integration done commit and the tip still holds done | `fold=true subjects=1 intDoneSubject=false tipHasDone=true second=true`, PASS | PASS |
| C8 | Change 1 predicate: `showTip` returns the file content, and null for a missing file | `landed=true intDoneSubject=true tipHasDone=true missing=null`, PASS | PASS |

Findings:

- The Specs change is absent from the merged tree. C1, C2, C3 and C6 fail. The integration wait is still the subject check that the Problem section says times out.
- The acceptance criteria cannot pass while the change is absent. The wait at line 46 is unchanged.
- The mirror premise holds. C7 shows `commitKanban` skip a same-tree done commit, and `showTip` return `state: "done"` at the tip. The predicate named in Change 1 is correct.

Not exercised: `node tests/orchestrator/spawn.test.ts` in 3 consecutive runs, and `pnpm test`. The live tester must not run a `*.test.ts` file or the test suite, so the acceptance criteria are measured through the file content and the mirror probe only.

Assumptions that shaped the checks:

- The mirrored scenario used two `createTask` tasks in a temporary git root, `setState` to done in one snapshot, then `commitKanban` with the whole board file list, like `src/orchestrator/pipeline.ts:562`.
- The control is `HEAD^`, not `main`.
- The merged worktree holds the merged commit. It holds `84a0c8c`, which is the tree before this task's change.

Contradiction with the task's stated assumptions: the worktree does not hold the merged #321 change, and the branch carries no commit of its own.
