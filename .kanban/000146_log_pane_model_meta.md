---
name: "feat: log pane shows the model name and thinking level above the log"
priority: "low"
state: "backlog"
worktree: ""
blockedBy: "#144"
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
