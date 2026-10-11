---
name: "fix: renderLogChunk drops blank lines from legacy passthrough text"
priority: "low"
state: "done"
worktree: "fix/68-renderlogchunk-drops-blank"
---

# Summary
renderLogChunk skips empty lines (if (!line) continue) before the JSON.parse passthrough check, so a legacy print-mode final text loses its blank paragraph lines (2 of 7 lines in a real pre-change log fixture). The spec says lines that fail JSON.parse pass through unchanged; an empty line fails JSON.parse, so blank lines must pass through too.

# Specs
Found in live test of 000054 (worktree fix/agent-logs-carry-only-the-final-output-stream-the-full-jsonl-event-log).

Evidence:
- src/webui.ts renderLogChunk (on the 000054 branch, defined at line 114) skips empty lines at line 127 (`if (!line) continue;`) before the JSON.parse passthrough check (lines 128-133, where a non-JSON line is pushed unchanged).
- A legacy print-mode final text loses its blank paragraph lines: 2 of 7 lines dropped in a real pre-change log fixture.
- The 000054 spec says lines that fail JSON.parse pass through unchanged; an empty line fails JSON.parse.

Fix: move/remove the empty-line skip so blank lines fall through to the passthrough branch unchanged. Mind the trailing-partial-line pop at lines 123-124 (a trailing "" from split means the last record was complete, not content) so the fix does not introduce stray blank lines at chunk edges.

# Notes
- [2026-10-11 11:19] Implemented on fix/68-renderlogchunk-drops-blank (commit 4d716a2).
- src/webui.ts renderLogChunk: removed the `if (!line) continue;` skip and made the trailing split-element pop unconditional (`lines.pop()`), because that element is either the empty sentinel of a newline-terminated chunk or a byte-split partial record, never content. Blank lines now fall through to the JSON.parse passthrough branch and render unchanged; empty input, chunk-head partial drops and the no-stray-blank-at-chunk-edge behavior are unchanged.
- src/webui.test.ts: added a legacy print-mode text round-trip assert (3 paragraphs, 2 blank lines, exact equality) and a mixed JSONL + blank line assert (a blank line must flush buffered text_delta output). Both fail against the unfixed renderer with exactly the 2 blank lines lost, and pass with the fix. Existing exact-equality chunk-head test still passes, so no stray edge blank lines.
- Checks: node src/kanban.test.ts, node src/webui.test.ts (3 runs), node src/orchestrator.test.ts all pass in the worktree.
- [Review 2026-10-11 11:25] No fixes needed. The unconditional pop is correct. split's last element is either the trailing-newline sentinel or an unterminated partial record, never content, so it equals the old conditional pop plus the removed empty-line skip, apart from the blank lines this task wants back. No stray blank line at a chunk edge.
- Verified against the pre-fix code (4d716a2^): the legacy text lost both blank lines and the mixed case returned "paragraph\nlegacy line\n". Both new asserts fail there and pass on HEAD.
- Edge cases checked by hand on the fixed module: "" -> "", "\n" -> "\n", "a\n\nb\n" unchanged, "a\n\n" unchanged, "a" -> "" (partial dropped), "\npartial" -> "\n", "a\npartial" -> "a\n", "\n\n\n" unchanged, JSONL + "\n\n" -> rendered text plus one blank line. The existing exact-equality chunk-head assert still passes.
- Checks re-run in the worktree: node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts all pass.
- Merge check: main moved to e4c0358 (hub backend) and rewrote parts of src/webui.ts, but not renderLogChunk. git merge-tree HEAD main exits clean and the merged renderLogChunk keeps the fix.
- Contract: the 000054 Specs say lines that fail JSON.parse pass through unchanged, so an empty line must render. The fix honors that.
- Non-blocking: a JSONL record split across two poll windows is still dropped on both sides. The previous window drops the record head and the next window's head guard strips the continuation. Pre-existing and unchanged by this diff.
- [Live test 2026-10-11 11:40] PASS. Ran from the worktree and from the pre-merge merge-tree result (clean merge of HEAD and main).
- Suites: node src/kanban.test.ts PASS, node src/webui.test.ts PASS in the worktree and in the merged tree, node src/orchestrator.test.ts PASS (3 runs: 1 failure then 2 passes, see finding 1).
- HTTP end-to-end (real /api/agent-log the dashboard uses, via startWebUi): legacy text "first paragraph\n\nsecond paragraph\n\nthird paragraph\n" round-trips byte-exact; JSONL text_delta + blank line renders "paragraph\n\nlegacy line\n"; offset poll keeps "after\n\nblank\n"; a trailing record without newline is still dropped; a 24KB under-chunk legacy text with 4000 blank lines round-trips exact.
- Chunk edges: a 81920-byte tail window built to start and end at blank lines renders byte-exact (no dropped or added edge blank line); history chunks plus the tail reproduce the whole 82048-byte legacy log. No stray blank line at a chunk head.
- Browser (Playwright/Chromium, the real dashboard): opened the task card, clicked the live developer button, the pane text equals the legacy text exactly with its two blank lines (screenshot reviewed).
- Merged tree: git merge-tree HEAD main exits clean, the merged src/webui.ts keeps `lines.pop()` and no empty-line skip, merged src/webui.test.ts keeps both new asserts and passes; the HTTP end-to-end also passes against the merged tree.
- No regressions found in the main flow.
- [Live test finding 1] Flaky test, test-only: node src/orchestrator.test.ts failed once of three runs in the worktree, exit 1, "timeout waiting for late task create commit" in the late create-event smoke after "worktree-cwd board-feed wait" passed; the other two runs passed. Orchestrator code is untouched by this diff. Not the same flake as the done 000049 (that was the worktree git-status assertion). Reported to the PM for a task.
- [Live test finding 2] Pre-existing, not caused by this diff: a JSONL record split across two 1s poll windows is lost on both sides. Reproduced: write half a record, poll 1 returns "" (partial dropped, correct alone); write the rest plus newline, poll 2 returns "" because the head guard strips the continuation. Reported to the PM for a task.
