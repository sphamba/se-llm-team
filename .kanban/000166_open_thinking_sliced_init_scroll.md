---
name: "fix: open thinking block is sliced on init and scroll-up"
priority: "medium"
state: "done"
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

Review (2026-10-12, commit bb188ae): passed, no fixes. Verified against the Specs and the code: the walk adds one openThink state, checked after inThink and openTool and before the delta branch, so a first thinking_delta with no thinking_end below the tail sets it, all records up to the block's thinking_start are consumed, the start counts ONE line and head lands on it. Init holds the whole open block from its thinking_start in one window as a single open Thinking block; a back-fill from that head cannot re-serve it because the block's deltas all lie below the tail. Traced edge cases: a closed thinking block above an open one counts correctly (inThink and openThink are independent states), an open block at the file start returns head 0 (atStart) and still renders the full delta run, and a large open block makes the window hold more than 100 records, consistent with the tool-block rule. Confirmed the listed assumptions in the diff: the #148 client promotion path (logFixups) is untouched, the thinking_end finalization keeps the data-final span mechanism, back-fill and dedupe semantics are unchanged, and subagent and .gz logs share the same linesBack and agentLogPayload path (all three call sites). The rewritten 000148 init test and the new 000166 block give exact byte-math and negative assertions; the client chain (cont span joins the marked open block, final span replaces its body and unmarks) stays covered by the existing logFixups tests with real DOM stubs. Full suite green (kanban, orchestrator, webui, extension, index). The branch holds exactly one commit over the merge-base with main and touches only src/webui.ts and src/webui.test.ts.

# Decision
Atomic live blocks (user's answer, 2026-10-12): an open, still-streaming thinking block counts as ONE collapsed line on init and scroll-up as well, so a live thinking phase renders as one open Thinking block that the thinking_end poll finalizes in place - no stale fragment, no split. Content of a block that never receives a thinking_end (abandoned run) must still render, never be dropped. The #148 client-side promotion stays only for genuinely orphaned artifacts; the #158 Specs sentence now holds for open blocks too.

Should an open, still-streaming thinking block count as ONE collapsed line on init and scroll-up as well, so a live thinking phase never shows as several open Thinking blocks and never leaves a stale open fragment when thinking_end arrives? Or is the current #148 client-side promotion (orphan cont span promoted to an open block, later joined) the accepted behavior for live blocks, with atomicity guaranteed only for completed thinking_start..thinking_end blocks?

Implemented in the worktree, commit bb188ae. Server-side fix in linesBack (src/webui.ts): a new openThink state consumes a still-open thinking block backward - deltas with no thinking_end below the tail set it, and the walk skips everything up to the block's thinking_start, where it counts the block as ONE line and head lands at the start record. So init holds the whole open block from its thinking_start in one window as a single open block (thinkHtml(true)), a scroll-up back-fill from that head never re-serves any part of it (heads never land mid-block), and the eventual thinking_end poll's data-final span finalizes the block in place through the unchanged #148 client path. A block that never receives thinking_end (abandoned run) still renders its full delta run - when the walk reaches the file start first, linesBack returns 0 (atStart), never dropping content. The #148 client-side promotion (orphan lg-cont to an open block) stays untouched for the live delta-streaming path and genuinely orphaned artifacts. Comments on LOG_LINES, linesBack and the init path updated.

Tests: the 000148 init test rewritten (init of a mid-thinking log now asserts the open block loads whole from its thinking_start, no lg-cont orphan; the delta-poll and cross-window thinking_end assertions kept). New 000166 block: an open block at the tail with 150 deltas loads as one open Thinking block with the full delta run, head counts it as one line, and the back-fill from that head carries no lg-think/lg-cont/data-open at all. Full suite green (kanban, orchestrator, webui, extension, index). Throwaway end-to-end check (not committed): init + back-fill + delta poll + thinking_end payloads replayed through renderLogChunk and the real logFixups - final pane holds exactly one closed Thinking block with the authoritative text, no stale fragment, no split.

Merge (2026-10-12, 7ecec18): step 1 merged main (4 new commits: per-role notes in .kanban, webui hot reload module graph, role-notes filter) into fix/166-open-thinking-sliced-init-scroll in the worktree; only src/webui.test.ts overlapped and auto-merged with the 'ort' strategy, no conflicts, so test suites were skipped per the clean-merge rule. Step 2 fast-forwarded main in the project root to 7ecec18, root clean. Merged main carries the full fix (src/webui.ts linesBack openThink state) and both test blocks.

Live test (2026-10-12, merged 7ecec18): passed, no issues. Tested on the real interface: an isolated single-project hub (src/hub.ts startHub, port 4321, HOME redirected to a scratch dir so the real ~/.pi/agent hub registry stays untouched) served the merged src/webui.ts, and Chromium (Playwright) drove the real UI: board card, detail card, agent card, log pane, mouse wheel. The logs were synthetic run logs in the exact real record shapes (message_update/assistantMessageEvent). A pid file naming a live sleep process kept the run live, so the 1 s log poll ran.

- Init, open block of 150 deltas preceded by 130 records: payload head = 2790 = the byte offset of the 31st preceding record, 99 collapsed lines before the block start (the open block counts as ONE line, as decided). atStart false. The window holds the block whole from its thinking_start: exactly one `<details class="lg-think" data-open="think">` with the full run d000..d149 and zero lg-cont spans. The old symptom (init = a single orphan lg-cont span) is gone.
- Scroll-up: with 130 long text records before the block the pane is scrollable; a real mouse wheel to scrollTop 0 fired the onscroll request `&offset=2790&before=1`. That payload carried zero lg-think, zero lg-cont and no delta token of the open block, so no part of the live block was re-served. The DOM stayed on exactly one open Thinking block with the full run. In the first fixture the pane was not scrollable (a Thinking block is a collapsed details), so the poll tick's scrollTop-0 path sent the identical request; same request, same client ingest.
- Finalization: appending a real thinking_end record made the next 1 s poll deliver the data-final span, and logFixups replaced the open block's body in place. Final DOM: exactly one closed details.lg-think, data-open removed, pre text exactly the authoritative content, zero lg-cont, no stale fragment, no second block.
- Abandoned run (open block, no thinking_end, 120 deltas): init returns atStart true and renders the full run as one open Thinking block (g000..g119), no content dropped.
- .gz log through the same endpoint: one open block, no lg-cont; a back-fill from its head carried no deltas.
- Closed blocks (the changed walk must keep them atomic): a closed block at the tail, and a closed block followed by an open block, each render as one block per phase with no orphan span (payload level).

No console or page errors in any scenario. No contradiction with the Decision or the stated assumptions.

Environment notes for future live tests: Playwright is not resolvable from the repo or the global node_modules; the usable copy is /home/phamba/.npm/_npx/e41f203b7505f1fb/node_modules/playwright (1.63.0, browsers cached). The hub's webuiLoader copies the webui module graph into src/.webui-hot-<pid>-<v> and sweeps .webui-hot-* after each import; an isolated hub with a redirected HOME keeps the real registry clean and the port distinct (4242 is the production hub).

# Open questions

None for the user. The direction question was answered (see Decision): an open, still-streaming block counts as ONE collapsed line.

Assumptions made (confirm or correct before this hardens):
- The fix is server-side only; the #148 client-side promotion path in logFixups stays exactly as shipped for the live delta-streaming path and genuinely orphaned artifacts.
- A still-open block loads whole into one window even when it outgrows the old byte-chunk size: one block is one collapsed line regardless of its record count, so a window may hold far more than 100 records when a large open block is in it.
- The thinking_end finalization keeps using the existing data-final span mechanism (no new client code).
- Scroll-up back-fill semantics stay as #158 shipped: the back-fill tail is the previous window's head, dedupe stays boundary-based, no overlap re-serving.
- The same fix applies to subagent transcripts and .gz logs, which go through the same linesBack and agentLogPayload code.

Live-test assumptions (usage tests, 2026-10-12):
- No real agent was spawned. Synthetic run logs in the real record shapes stand in for a mid-thinking live log; the exercised paths are the real HTTP endpoint, the real client ingest/logFixups and the real 1 s poll.
- Aliveness for the finalization flow came from a pid file naming a live sleep process, so the poll timer behaved like a live run.
- .gz logs were exercised against the endpoint; the subagent transcript path (sub=n) shares linesBack and agentLogPayload but was not separately exercised.
- One browser scenario opened the log of a past run and the others a live run; the client code path is the same.

Observed behaviour that contradicts the task's stated assumptions: none. The init window held 249 records when the open block was in it, exactly as the task's assumption anticipates.
