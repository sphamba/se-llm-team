---
name: "fix: open thinking block is sliced on init and scroll-up"
priority: "medium"
state: "live-testing"
worktree: "fix/166-open-thinking-sliced-init-scroll"
issuer: "#158"
complexity: "moderate"
shortName: "open-thinking-sliced-init-scroll"
---

# Summary
After #158 (merged 9964580), the backward line grouping in src/webui.ts opens a thinking block on thinking_end, so an open, still-streaming block at the live tail has no end record and each thinking_delta counts as its own collapsed line. On the real hub that makes init promote an orphan lg-cont span to an open Thinking block and a scroll-up back-fill of the same open block produce a second open Thinking block, whose stale fragment the eventual thinking_end poll never closes.

# Specs
Context: task #158 (merged commit 9964580) replaced the fixed byte-chunk log load with a fixed number of collapsed lines (LOG_LINES = 100). In src/webui.ts, the backward walk (linesBack) opens a thinking block on thinking_end and closes it on thinking_start. A thinking block that is still open at the live tail has no thinking_end yet, so its thinking_delta records each count as their own collapsed line.

Observed live on the real hub (http://localhost:4242, port 4242, merged webui.ts), with an agent mid-thinking and its open block holding more than 100 deltas:
- Init (no offset) serves a window that contains no thinking_start and no thinking_end; the payload is a single <span class="lg-cont"> orphan span. The client's logFixups promotes it to an open Thinking block (the documented #148 behavior).
- A scroll-up back-fill from that head serves the earlier part of the same open block. Replaying the two exact server payloads through the real client code (logFixups in Chromium): after init 1 open Thinking block, after one scroll-up 2 open Thinking blocks (7 total), i.e. one live thinking phase is displayed as two separate open Thinking blocks.
- The eventual thinking_end poll appends a data-final cont span and logFixups replaces only the nearest open block's content (the newest one), leaving the older fragment open and stale forever.

This contradicts the #158 Specs sentence "A chunk boundary then always falls BETWEEN blocks, never inside one, so no block is ever broken on load or back-fill" for a block that has no thinking_end yet. It may be intended behavior, because the #158 Specs define a thinking block as thinking_start..thinking_end and say the live delta streaming path stays exactly as #148 shipped. The reviewer already saw the init-mid-thinking case and called it sane, but did not examine the scroll-up fragmentation.

Direction (gated by the open question):
- If an open, still-streaming block must count as ONE collapsed line: make the init/scroll-up grouping treat a still-open thinking block as a single line, so a live thinking phase renders as one open Thinking block that the thinking_end poll finalizes in place, with no stale fragment and no split. Content of a block that never receives a thinking_end (abandoned run) must still render, never be dropped.
- If the current #148 client-side promotion is ratified as accepted behavior for live blocks: the code may need no change; corroborate that decision (atomicity guaranteed only for completed thinking_start..thinking_end blocks) and correct the #158 Specs sentence, which is out of the code's scope.

Evidence and reproduction: deterministic against a live agent log. The #158 live test used .kanban/.logs/000158_collapsed_lines_log_load.live-tester.0.log while the live-tester agent was streaming; a Python sampler waited until the current open block had >=120 deltas, then requested init and one back-fill. Captured windows: init [9505686, 9531119) held no thinking_start/thinking_end, back-fill [6746232, 9505686) held the block's start. The reproduction can be repeated the same way on the merged main after any fix.

Tests: src/webui.test.ts covers whichever resolution is chosen (open block counted as one line, or documented promotion) and the suite stays green. Keep the #122/#140/#141/#146/#147/#152 rendering rules, atStart handling, offsets/dedupe and the live delta path otherwise unchanged.

# Notes

Review (2026-10-12, commit bb188ae): passed, no fixes. Verified against the Specs and the code: the walk adds one openThink state, checked after inThink and openTool and before the delta branch, so a first thinking_delta with no thinking_end below the tail sets it, all records up to the block's thinking_start are consumed, the start counts ONE line and head lands on it. Init holds the whole open block from its thinking_start in one window as a single open Thinking block; a back-fill from that head cannot re-serve it because the block's deltas all lie below the tail. Traced edge cases: a closed thinking block above an open one counts correctly (inThink and openThink are independent states), an open block at the file start returns head 0 (atStart) and still renders the full delta run, and a large open block makes the window hold more than 100 records, consistent with the tool-block rule. Confirmed the listed assumptions in the diff: the #148 client promotion path (logFixups) is untouched, the thinking_end finalization keeps the data-final span mechanism, back-fill and dedupe semantics are unchanged, and subagent and .gz logs share the same linesBack and agentLogPayload path (all three call sites). The rewritten 000148 init test and the new 000166 block give exact byte-math and negative assertions; the client chain (cont span joins the marked open block, final span replaces its body and unmarks) stays covered by the existing logFixups tests with real DOM stubs. Full suite green (kanban, orchestrator, webui, extension, index). The branch holds exactly one commit over the merge-base with main and touches only src/webui.ts and src/webui.test.ts.

# Decision
Atomic live blocks (user's answer, 2026-10-12): an open, still-streaming thinking block counts as ONE collapsed line on init and scroll-up as well, so a live thinking phase renders as one open Thinking block that the thinking_end poll finalizes in place - no stale fragment, no split. Content of a block that never receives a thinking_end (abandoned run) must still render, never be dropped. The #148 client-side promotion stays only for genuinely orphaned artifacts; the #158 Specs sentence now holds for open blocks too.

Should an open, still-streaming thinking block count as ONE collapsed line on init and scroll-up as well, so a live thinking phase never shows as several open Thinking blocks and never leaves a stale open fragment when thinking_end arrives? Or is the current #148 client-side promotion (orphan cont span promoted to an open block, later joined) the accepted behavior for live blocks, with atomicity guaranteed only for completed thinking_start..thinking_end blocks?

Implemented in the worktree, commit bb188ae. Server-side fix in linesBack (src/webui.ts): a new openThink state consumes a still-open thinking block backward - deltas with no thinking_end below the tail set it, and the walk skips everything up to the block's thinking_start, where it counts the block as ONE line and head lands at the start record. So init holds the whole open block from its thinking_start in one window as a single open block (thinkHtml(true)), a scroll-up back-fill from that head never re-serves any part of it (heads never land mid-block), and the eventual thinking_end poll's data-final span finalizes the block in place through the unchanged #148 client path. A block that never receives thinking_end (abandoned run) still renders its full delta run - when the walk reaches the file start first, linesBack returns 0 (atStart), never dropping content. The #148 client-side promotion (orphan lg-cont to an open block) stays untouched for the live delta-streaming path and genuinely orphaned artifacts. Comments on LOG_LINES, linesBack and the init path updated.

Tests: the 000148 init test rewritten (init of a mid-thinking log now asserts the open block loads whole from its thinking_start, no lg-cont orphan; the delta-poll and cross-window thinking_end assertions kept). New 000166 block: an open block at the tail with 150 deltas loads as one open Thinking block with the full delta run, head counts it as one line, and the back-fill from that head carries no lg-think/lg-cont/data-open at all. Full suite green (kanban, orchestrator, webui, extension, index). Throwaway end-to-end check (not committed): init + back-fill + delta poll + thinking_end payloads replayed through renderLogChunk and the real logFixups - final pane holds exactly one closed Thinking block with the authoritative text, no stale fragment, no split.

Merge (2026-10-12, 7ecec18): step 1 merged main (4 new commits: per-role notes in .kanban, webui hot reload module graph, role-notes filter) into fix/166-open-thinking-sliced-init-scroll in the worktree; only src/webui.test.ts overlapped and auto-merged with the 'ort' strategy, no conflicts, so test suites were skipped per the clean-merge rule. Step 2 fast-forwarded main in the project root to 7ecec18, root clean. Merged main carries the full fix (src/webui.ts linesBack openThink state) and both test blocks.

# Open questions

None for the user. The direction question was answered (see Decision): an open, still-streaming block counts as ONE collapsed line.

Assumptions made (confirm or correct before this hardens):
- The fix is server-side only; the #148 client-side promotion path in logFixups stays exactly as shipped for the live delta-streaming path and genuinely orphaned artifacts.
- A still-open block loads whole into one window even when it outgrows the old byte-chunk size: one block is one collapsed line regardless of its record count, so a window may hold far more than 100 records when a large open block is in it.
- The thinking_end finalization keeps using the existing data-final span mechanism (no new client code).
- Scroll-up back-fill semantics stay as #158 shipped: the back-fill tail is the previous window's head, dedupe stays boundary-based, no overlap re-serving.
- The same fix applies to subagent transcripts and .gz logs, which go through the same linesBack and agentLogPayload code.
