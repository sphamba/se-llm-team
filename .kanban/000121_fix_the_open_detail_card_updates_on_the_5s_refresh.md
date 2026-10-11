---
name: "fix: the open detail card updates on the 5s refresh"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#120"
---

# Summary
The open detail modal never re-derives on the 5s refresh (openTask runs only from clicks), so state changes and agent assignments need close/reopen. Fix client-only: refresh() updates the open modal in place — title/attrs freely, body html-gated, buttons without touching #m-log/logState/pollLog — reusing the existing fresh-task lookup.

# Specs
Per investigation: the task detail modal is written exclusively by openTask (src/webui.ts:951 — title :956, #m-attrs :957-966, renderAgent :968, body :969), reachable only from card/num-link clicks, so the open modal never re-derives when a task changes state or gets an agent; the user must close and reopen. Fix, client-only: after mergeBoards/render in refresh() (src/webui.ts:1127, :478, :915), when modalFile is set and #modal is visible, look up the fresh task with activeBoard().tasks.find(x => x.file === modalFile) (the exact lookup openTask/pollLog already use, :952, :1076); if the task is gone, close the modal; else update IN PLACE: title and #m-attrs freely (stateless, rebind .num-link handlers); #m-body only when its html changed (compare against the last html, __html-style like syncBoard :659, to preserve user scroll); agent run/sub buttons re-rendered WITHOUT touching the log pane — the buttons row must be split from #m-log's lifetime (update buttons in place or preserve the #m-log/#m-log-text node across the renderAgent rebuild so accumulated text and scroll survive; do NOT call closeLog), then markActiveAgent(). Leave #m-log, logState {handle,sub,head,tail,atStart,busy,idle} (:1054-1056, keyed by handle, still valid when the run set changes), logTimer and pollLog's stale-check (:1100) untouched; skip fetchSubs unless the open handle changed. Coordination: #120 (in doing) rewrites the same renderAgent region (tokens/duration cards, subs always visible) — sequence with it, expect a merge conflict in src/webui.ts for the later landing and resolve keeping both. Extend src/webui.test.ts: source asserts that refresh updates the open modal in place without clearing #m-log/logState, and that body rewrite is html-gated. Full suite green: node src/webui.test.ts. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes.

# Notes
