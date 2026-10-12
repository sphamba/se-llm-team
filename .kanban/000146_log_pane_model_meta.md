---
name: "feat: log pane shows the model name and thinking level above the log"
priority: "low"
state: "live-testing"
worktree: "feat/146-log-pane-model-meta"
blockedBy: ""
issuer: "user"
complexity: "simple"
shortName: "log-pane-model-meta"
---

# Summary
When an agent card is clicked and its log pane opens, a line above the log shows the model name and thinking level that is/was used, updating live while the run is running, for run logs and subagent transcripts alike.

# Specs
Current facts: #m-log contains only #m-log-text (src/webui.ts:1032; CSS :986-994) with no header; openLog (:1377-1387) writes no header, just unhides, inits logState, pulls the init chunk and starts the 1s pollLog; agentLogPayload (:524-612) returns JSON.stringify({text, head, tail, atStart}) (:611) with the sub=list branch returning [{id, index, tokens, duration}] (:529-533); every poll re-sends the full payload (pullLog :1417-1440) so a payload meta field updates the header live each second; logStats (:231-281) already full-parses exactly the records carrying model/thinkingLevel (rec?.type === "turn_end" || rec?.type === "assistant", guarded on usage at :258) and is memoized per file size (statsCache :245) so a growing live log re-parses; agentLogPayload currently calls logStats only in the sub=list branch; subagent transcripts take the same handler via target = found.path (:539-544).

Changes, src/webui.ts plus src/webui.test.ts only:
- Server: logStats picks up model and thinkingLevel from the LATEST usage-bearing record it already reads (turn_end or assistant), returned alongside its existing tokens/duration; null fields when no such record exists (legacy or quiet logs).
- agentLogPayload includes that meta in the chunked payload (e.g. model, thinkingLevel fields next to text/head/tail/atStart) for run logs and ?sub= transcripts alike, computed per request so pollLog refreshes it live.
- Client: #m-log grows a meta line above #m-log-text (new node, e.g. #m-log-meta) showing the model name and thinking level (e.g. "claude-sonnet-4 · thinking high") in the muted grey style; hidden when no meta is available; openLog/pullLog/pollLog fill it on init and every poll; the sub view gets the same from its payload.
- updateOpenTask keeps the log pane untouched (#121/#130 rules): the meta node updates only from pullLog/pollLog, never from the 5s refresh; the chunk walk-back, offsets, dedupe and the #122/#140 rendering rules stay intact.

Tests (extend the flat assertion script): fake run logs and subagent transcripts whose assistant records carry model/thinkingLevel (existing fakes carry only usage/timestamp, so extend them); the payload includes model/thinkingLevel taken from the latest record; a log without usage-bearing records returns nulls and the meta line stays hidden; the PAGE ships the #m-log-meta node; existing payload/walk-back/gz/subagent assertions stay green. No orchestrator changes.

# Notes
Done in commit 40b4921 on feat/146-log-pane-model-meta (src/webui.ts + src/webui.test.ts only):
- logStats now returns model and thinkingLevel taken off the latest usage-bearing record (turn_end or assistant, the same guard as tokens), null when no such record exists; the memoized cache entry carries the two fields, so a live log re-parses per growth as before.
- agentLogPayload computes logStats(target) per request (run log or ?sub= transcript) and ships model/thinkingLevel next to text/head/tail/atStart; the sub=list branch is unchanged.
- The client ships #m-log-meta above #m-log-text (muted grey, 10px, hidden by default); openLog clears it so a previous view's meta never flashes, pullLog fills it on init, poll and history alike as "model · thinking level" (model only when no thinking level); nulls hide it. updateOpenTask untouched.
- Tests: the 000120 dev1 fake and the out1 subagent fake now carry model/thinkingLevel; new assertions cover the latest-record payload meta for a run log and a sub transcript, nulls for a log without usage-bearing records, the PAGE node/CSS/fill logic, and the updated static-markup assertion. Full suite green (webui, kanban, orchestrator, extension, index).
- Review (no fixes): diff verified against the specs point by point. logStats overwrites model/thinkingLevel top to bottom so the latest usage-bearing record wins, with the same turn_end/assistant + usage guard as tokens; agentLogPayload computes logStats(target) after target is resolved and the sub=list early return is untouched; pullLog fills the meta on every mode and both pollLog and the scroll handler route through it, so the line updates live each second; openLog clears the node synchronously with the pane unhide, so no previous view's meta can paint; updateOpenTask has zero diff mentions. Record shape checked against pi docs (message-types.md, json.md): turn_end.message is an AssistantMessage with required model and optional thinkingLevel, so the extraction path is correct; responseModel vs model is the open question below, answered when the user confirms. All five suites re-run green in the worktree.

# Open questions
Assumptions (confirm or correct):
- The meta line lives inside the scrollable #m-log pane (per the spec's "#m-log grows a meta line above #m-log-text"), so it scrolls away when reading history; a sticky header above the pane would be a different change.
- A thinkingLevel of "off" still renders as "model · thinking off"; suppressing the suffix for off/omitted levels was not requested.
- The model shown is the pi-requested model string (message.model), not responseModel when the provider answers with a different concrete model.
- The middle-dot separator format "claude-sonnet-4 · thinking high" is exact as specced; a thinkingLevel without a model still hides the line.
