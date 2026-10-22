---
name: "test: assert the integration task's done state in the mirror, not its commit label"
priority: "medium"
state: "done"
worktree: "test/336-assert-the-integration"
issuer: "user"
complexity: "moderate"
---

# Summary
tests/orchestrator/spawn.test.ts has been red since 0b2a816: part A waits for a commit subject kanban: done <integration file> that can never exist, because commitKanban rebuilds the whole board tree and the integration task's done state lands folded inside the live-tester's commit. The mirror holds the correct state. Assert the mirror state instead, which also unblocks part BA (#331's root real-file guard), which never ran.</summary>
<complexity>simple</complexity>
<priority>high</priority>
<issuer>#334</issuer>
<specs>## Root cause (verified)

`tests/orchestrator/spawn.test.ts` part A waits at lines 43-49 for a commit subject `kanban: done <integration file>`. That subject never exists.

`commitKanban` rebuilds the whole board tree (src/webui/board.ts) and no-ops when the tree equals the tip. `pipeline.ts:580` gates the done commit on a `code` value read from the sweep-start `boardStatus` snapshot (pipeline.ts:461). Within one sweep, the live-tester task's done commit already folds the integration task's done state into its own tree, so the integration task's labelled commit is skipped, and no later sweep retries it because the snapshot then reads clean.

The mirror itself is correct: `.kanban/<integration file>` inside the mirror already carries `state: "done"`, committed under the live-tester's label.

Timeline: green at `cb717dd` and at the parent of `0b2a816`, red from `0b2a816` ("create the integration task at the merge fast-forward"). Not caused by #331 or #332; both were confirmed against it.

Consequence beyond the red suite: part A's timeout ends the file, so part BA (#331's `refusing to replace the real file` assertions, around line 618) has never run on the merged base.

## Decision

The contract is the mirror state, not one labelled commit per done task. The fold is legitimate: a whole-board tree commit legitimately carries a sibling's state change.

## Specs

1. Replace the wait predicate at lines 43-49 with a mirror-state assertion: find the auto-issued task file, read that file from the mirror, and assert it contains `state: "done"`. `mirrorSubjects` in tests/helpers.ts only returns commit subjects, so if no helper reads a mirror file, add one small helper next to it in the same file. Do not spawn a second daemon or a second wait.

2. Keep the create-label assertion unchanged (`integrationCreates.length === 1` for `kanban: create <file>`), and keep the marker list at lines 52-53 unchanged.

3. Update the comments above the wait (lines 40-42) so they say the done state may land folded into a sibling's commit, and why.

4. Do not change `src/`. This is a test-contract fix.

5. If a later part of the file turns out red once part A completes, do not weaken it. Report the part name and the failing assertion in `# Notes` and leave the task in progress. A red part BA means #331 has a real defect and #331 has to be reopened.

## Acceptance

1. `node tests/orchestrator/spawn.test.ts` passes and prints the final part line containing `root real-file symlink guard passed` (part BA). Today the file dies at part A.
2. No `kanban: done <integration file>` subject assertion remains in the file.
3. `node tests/orchestrator/split.test.ts` is untouched by this change (it is red for another cause, tracked separately).</specs>
<shortName>mirror-state-done-assert</shortName>

# Specs


# Notes
- Splitter (no split): the task changes one test file and verifies it with one sequential command. The only possible follow-up, a red part BA that reopens #331, is a diagnosis, not parallel work. The review, merge, and live-test cost per subtask would exceed the time saved.
- Splitter: reuse `showTip(root, file)` in `tests/helpers.ts`. It already reads a file at the mirror tip. Do not add a second helper.
- Splitter: this task body has stray `<complexity>`, `<priority>`, `<issuer>`, `<specs>`, and `<shortName>` tags inside `# Summary`, so `kanban_get` reports an empty `specs` field. The real specs are the `<specs>` block inside the summary. Read this file directly.

## What changed
- `tests/orchestrator/spawn.test.ts` part A: the integration wait now reads the auto-issued task file from the mirror with the existing `showTip(root, file)` helper and waits for `state: "done"`. One explicit `assert.match` on the same mirror content states the contract after the wait.
- The comment above the wait names the fold and its cause: `commitKanban` rebuilds the whole board tree and no-ops on an unchanged tree, so the live-tester's done commit carries the integration task's done state and the task's own done label is skipped.
- The create-label assertion (`integrationCreates.length === 1`) and the marker list are unchanged. No `src/` change. No new helper: `showTip` already read a mirror file at the tip.

## Acceptance
1. `node tests/orchestrator/spawn.test.ts` -> exit 0, 8 part lines, and the line `orchestrator.test.ts: ... + root real-file symlink guard passed` (part BA) is present. Output at `/tmp/spawn.green.out`.
2. `grep -n 'kanban: done ${f}' tests/orchestrator/spawn.test.ts` -> no match. The only done-subject assertion left is `taskClean()` for the covered task A.
3. `git diff --stat` -> `tests/orchestrator/spawn.test.ts | 11 +++++++----`, one file. `tests/orchestrator/split.test.ts` is untouched.

## Notes
- Red baseline before the edit, same suite, output at `/tmp/spawn.red.out`: exit 1, `timeout waiting for the integration task runs to done and folds into the mirror`. The daemon log in that output contains `agent exited 0, integration-testing -> done`, so the integration task reached done while no done label ever landed: the Specs root cause holds.
- The task reached done on both runs with no residual `stub-agent.cjs` child process.
- Part BA passed on the merged base after the fix. #331 has no defect and is not reopened.
- The one extra `assert.match` line after the wait is deliberate: the wait exits 1 with a timeout message, and the explicit assert names the mirror value in the failure. Remove it if the timeout message is enough.

Review of ab33afc (first pass):
- `tests/orchestrator/spawn.test.ts:48` part A now waits on the mirror tip: `!!f && (showTip(rootA, f) ?? "").includes('state: "done"')`, with `showTip` = `git show refs/heads/meta/kanban:.kanban/<file>` (`tests/helpers.ts:44`); no second daemon, no second wait.
- `tests/orchestrator/spawn.test.ts:54` keeps one explicit `assert.match(..., /^state: "done"$/m, ...)` on the same mirror content, so a regression names the mirror value, not only the wait timeout.
- `tests/orchestrator/spawn.test.ts:56-57` the create-label assertion is byte-identical to base line 53-54, and `rg -n 'kanban: done \$\{integration' tests` returns nothing; `git diff --stat main...HEAD` is one file with no `src/` hunk.
- `tests/orchestrator/spawn.test.ts:40-43` the comment names the fold and its cause (`commitKanban` rebuilds the whole board tree and no-ops on an unchanged tree), as Specs 3 asks.
- `node tests/orchestrator/spawn.test.ts` -> exit=0 (`/tmp/rv-spawn.log`), 8 part lines, log line 26 is `orchestrator.test.ts: ... + root real-file symlink guard passed` (part BA ran and is green; #331 needs no reopening).

## Live test (live-tester role)

Test lane: test-file change. No test suite was run, because the role contract forbids running a `*.test.ts` file. The driver replays the scenario through the production functions instead.

- Driver, fixture roots, logs, and the JSON per check: `/tmp/lt336/` (`report.md`, `run-merged-{1,2,3}.log`, `run-control-1.log`).
- Replay of part A's integration lane: a git fixture root, a fast role stub (developer commits, reviewer sets to-merge, live-tester and integration-tester exit 0), and the real `src/orchestrator.ts` from the merged tree, with `--rescan-seconds 1 --poll-minutes 0.01`. The covered task `feat: smoke test` is `complexity: simple`. The mirror is read exactly as the helper reads it: `git show refs/heads/meta/kanban:.kanban/<file>`.
- Replay of part BA: `ensureContextSymlinks(root, cwd, taskFile, "integration-tester")` from the merged tree, on a root with a real `AGENTS.md` and a real `SPECS.md`, for the three cwd spellings and one worktree cwd.
- Control: `HEAD^` (`9d7fc83`) extracted with `git archive`, same driver, same fixture.

| id | claim | expected | merged actual (3 runs) | control (pre-fix) | pass |
| --- | --- | --- | --- | --- | --- |
| C1 | Part A waits on the integration task's mirror state, not on a done label | showTip-wait=1 old-done-label-wait=0 fold-comment=1 | showTip-wait=1 old-done-label-wait=0 fold-comment=1 | showTip-wait=0 old-done-label-wait=1 fold-comment=0 | PASS |
| C2 | The auto-issued integration task reaches the mirror tip as done | `state: "done"` at the mirror tip | done=1 file=`000002_integration_of_1.md` | done=1 | PASS |
| C3 | Its own done label is skipped, the covered task's done commit folds it in, one create label | int done labels=0 int create labels=1 covered done labels=1 newest int commit=`kanban: done <covered file>` | int done labels=0 int create labels=1 covered done labels=1 newest int commit=`kanban: done 000001_smoke_test.md`, `integration-testing -> done` logged once | same | PASS |
| C4 | Part BA: a real root file is never replaced by a context symlink | 0 root-file failures, 3 refusal lines, all naming SPECS.md, both worktree links made | 0 failures, 3 refusal lines, 3 naming SPECS.md, worktree SPECS=1 worktree AGENTS=1 | same | PASS |
| C5 | No `kanban: done <integration file>` subject assertion remains | 0 occurrences of `kanban: done ${f}` | 0 | 1 | PASS |
| C6 | Scope: one test file, no `src/` hunk, `split.test.ts` untouched | changed=[`tests/orchestrator/spawn.test.ts`] src-changed=0 split-changed=0 | changed=[`tests/orchestrator/spawn.test.ts`] src-changed=0 split-changed=0 | n/a, archived tree has no git metadata | PASS |

Result: 6 of 6 rows pass in each of the 3 merged runs, with identical values in all runs. The control run fails only C1 and C5, so the merged edit is the change that moves part A from a done-label wait to a mirror-state wait.

The Specs assumption holds in 3 of 3 runs: the newest commit that touches the integration task's file is the covered task's `kanban: done` commit, and no `kanban: done <integration file>` subject ever lands. Part BA runs green through the production function. #331 has no observed defect and is not reopened.

### Assumptions
- `complexity: simple` on the covered task skips the splitter run that part A takes at the default complexity. The splitter is not part of this change.
- The replay uses a reduced role stub (no JSONL developer log). The developer-log, gzip, and auto-push assertions of part A are outside this change.
- The control tree is a `git archive` of `HEAD^`, so its git-metadata row (C6) is not comparable and says so.

### Not exercised
- `node tests/orchestrator/spawn.test.ts` itself, and the final `root real-file symlink guard passed` line: the role contract forbids running a test file. The equivalent production calls were replayed instead.
- `tests/orchestrator/split.test.ts`: untouched by the change and red for another cause, per the Specs.

### Findings
- None. No technical difficulty blocked the runs.
