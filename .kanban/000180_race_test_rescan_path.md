---
name: "fix: race unit test does not exercise the post-write rescan path"
priority: "low"
state: "reviewing"
worktree: "fix/180-race-test-rescan-path"
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

# Open questions
- Assumption: no user input needed; the Specs offered a choice and the strengthen option was taken. Say if the documentation-only option was preferred instead.
- Assumption: keeping `src/kanban.ts` unchanged (no test seam in production code) is preferred over adding a hook there.
- Assumption: the net's intended coverage is a hand-written or external file landing between the scan and the post-write rescan; the lock-serialized concurrency block cannot produce a duplicate number, so the strengthened race case is its only exerciser.
- Assumption: child-process fs interception (same spawn pattern as the existing concurrency block) is acceptable test machinery; the preload lives in the temp race root and is removed with it.
