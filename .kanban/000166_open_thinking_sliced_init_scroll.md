---
name: "fix: open thinking block is sliced on init and scroll-up"
priority: "medium"
state: "backlog"
worktree: ""
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

# Open questions
Should an open, still-streaming thinking block count as ONE collapsed line on init and scroll-up as well, so a live thinking phase never shows as several open Thinking blocks and never leaves a stale open fragment when thinking_end arrives? Or is the current #148 client-side promotion (orphan cont span promoted to an open block, later joined) the accepted behavior for live blocks, with atomicity guaranteed only for completed thinking_start..thinking_end blocks?
