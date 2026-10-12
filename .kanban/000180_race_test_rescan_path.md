---
name: "fix: race unit test does not exercise the post-write rescan path"
priority: "low"
state: "doing"
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
