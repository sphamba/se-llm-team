---
name: "fix: race unit test does not exercise the post-write rescan path"
priority: "low"
state: "done"
worktree: ""
issuer: "#174"
complexity: "simple"
shortName: "race-test-rescan-path"
---

# Summary
In src/kanban.test.ts the race block that writes 000006_other_creator.md after five creates computes 000007 before any write, so the unlink-and-retry net added by #174 never runs there. Only the four-process concurrency block exercises the duplicate-number path. Strengthen the case to open the scan/write window, or state clearly that the net is exercised only by the concurrency block.

# Specs
# Summary
In `src/kanban.test.ts` the race block named in the #174 Specs writes `000006_other_creator.md` after five creates and asserts the next task is `000007_racer.md`. The max scan already sees `000006`, so allocation computes `000007` before any write and the post-write rescan (unlink-and-retry) net never runs. Only the four-process concurrency block exercises the duplicate-number path.

# Specs

## Problem
- `src/kanban.test.ts`: the race block creates five tasks, writes `000006_other_creator.md`, then asserts the next created task is `000007_racer.md`.
- The max scan already sees `000006`, so `000007` is allocated before any write. The unlink-and-retry net introduced by #174 is therefore not exercised by this case.
- Live evidence: strace on that exact fixture showed no unlink of the new file (only the `.create.lock` unlink).
- Only the four-process concurrency block exercises the duplicate-number path.

## Fix
Choose one:
- Strengthen this case to genuinely open the scan/write window (e.g. hold the create lock, or hook/intercept the write) so the duplicate-number rescan actually runs and the case's assertion proves the retry, or
- State clearly (in the test and/or the Specs) that the net is exercised only by the concurrency block, so the named case is not misread as covering it.

## Acceptance criteria
- `node src/kanban.test.ts` passes.
- Evidence of which path the named case exercises: either a strace/instrumented run showing the unlink-and-retry runs in it, or an explicit statement (with the case's comment/spec updated) that the concurrency block is the sole exerciser.

# Notes
- Filed from the #174 live-test report (merged commit e33bf83). Test-only change, confined to `src/kanban.test.ts`.

# Notes
- Chose the strengthen option: the race case now genuinely opens the scan/write window. A `--require` preload in a child process patches `fs.writeFileSync` and injects `000006_other_creator.md` at the racer's own `000006_racer.md` write, which is after the max scan and before the post-write rescan. The child reports the outcome as JSON; the parent asserts `injected` true, final file `000007_racer.md`, no `000006_racer.md` leftover and the rival intact. `src/kanban.ts` is unchanged.
- Interception must run in a child: patching `require("node:fs")` before the first ESM import propagates to ESM named imports (verified), but the test process's bindings are already resolved, so an in-process patch has no effect (verified).
- Evidence, from an instrumented copy in /tmp (not committed): the net fired exactly once (`NET-FIRED 000006_racer.md`) in the strengthened case; a negative control with the net removed from `kanban.ts` fails the case at the racer assertion (`000006_racer.md` vs `000007_racer.md`).
- The task premise on the concurrency block was off: a probe shows 0 net fires there. The #174 lock serializes scan+write and every concurrent slug differs, so no duplicate number can arise under it. Its comment now states it proves unique numbers under contention, not the net, so the strengthened race case is the net's sole exerciser.
- `node src/kanban.test.ts` and `npm test` pass (exit 0).
- Review of f8a4806 (merger candidate): re-verified the developer's claims independently on the merged HEAD with my own instrumented copy in /tmp, logging fires to a file because the parent discards the racer child's stderr on success. Exactly one net fire (`000006_racer.md`) and 0 in the concurrency block. The negative control with the net removed fails the case at the racer assertion (`000006_racer.md` vs `000007_racer.md`), matching the Notes above.
- main had moved past the branch's merge base (966ce04 -> 8521d5b, carrying #178, #179 and #181): merged main into the branch per convention, no conflicts, `npm test` green (merge commit f8a4806).
- `node src/kanban.test.ts` passed 3/3 before and 3/3 after the merge.
- Cleared the open questions: the Specs' "Choose one" authorizes the strengthen option, the Specs' fix option itself names interception (so no production seam is required), the child-spawn pattern is established by the concurrency block, and the coverage premise is verified above. None need user input.
- Merging (final pass): main had moved past the branch's merge base again (8521d5b -> 83c758f, carrying #182). Merged main into the branch in the worktree, clean (only src/webui.ts and src/webui.test.ts touched, unrelated to this task's file), so suites skipped per convention (merge commit b2566ae). Merged the branch into main in the project root, fast-forward 83c758f..b2566ae, no conflicts.
- No open questions from merging.

## 2026-10-12, live-tester

- Live test on merged commit b2566ae in the project root. The change is test-only, so the unit suite is the developer/reviewer gate and was not run (live-test rules). Instead the named race case's scenario was reproduced on the merged production `createTask` from `src/kanban.ts` (the function behind the `kanban_create` tool) in a scratch root, with the same `--require` preload interception in a child process that the case uses.
- Results:

| # | Scenario | Result |
|---|---|---|
| 1 | Merged code: 5 sequential creates, then a racer whose `000006_racer.md` write injects `000006_other_creator.md` | rival injected inside the scan/write window, net fired exactly once (`unlink 000006_racer.md`), final `000007_racer.md`, no `000006_racer.md` left, rival intact, all numbers unique |
| 2 | Negative control: pre-net code 2411704~1, same scenario | racer file `000006_racer.md`, no unlink, duplicate number 000006, so the harness detects a missing net |
| 3 | Merged code: 4 processes x 20 creates under contention | 80 tasks, numbers 000001-000080 unique, 0 net fires |

- Scenario 1 fs event order, logged by the preload: `write .create.lock`, `write 000006_other_creator.md`, `write 000006_racer.md`, `unlink 000006_racer.md`, `write 000007_racer.md`, `unlink .create.lock`. This is the post-scan injection and the post-write rescan the case claims.
- Scenario 3 confirms the Notes' coverage correction: under contention the lock serializes scan+write and every slug differs, so no duplicate number can arise and the net never fires. The race case is the net's sole exerciser, and the concurrency comment now states that.
- Assumptions of the usage tests: (a) `createTask` is the real production interface for task creation, so driving it directly is a valid stand-in for the case under test; (b) the `--require` preload interception reaches the ESM named import under Node v24, verified by `injected: true` in the child.
- Technical difficulty, not a finding: my first harness preload logged through `fs.appendFileSync`, which internally calls the patched `writeFileSync` and recursed. Logging through a file descriptor fixed it. This is a harness artifact, not a defect of the change.
- Findings: none. The production code is unchanged, and both claims of the strengthened case (the net runs in the race case, the concurrency block has 0 net fires) hold on the merged commit. The literal test file was not executed, per the live-test rules.

# Open questions
