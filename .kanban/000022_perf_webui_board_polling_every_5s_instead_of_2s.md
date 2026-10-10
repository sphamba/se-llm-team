---
name: "perf: webui board polling every 5s instead of 2s"
priority: "low"
state: "done"
worktree: ""
---

# Summary
The web dashboard page refreshes the board every 2 seconds (src/webui.ts:191, setInterval(refresh, 2000)). Set it to 5 seconds to cut request load.

# Specs
Slow the web dashboard refresh rate.

Changes:
- src/webui.ts line 191: setInterval(refresh, 2000) → setInterval(refresh, 5000).

Acceptance:
- The served page polls /api/tasks every 5 seconds.
- Existing tests pass (no test references the interval).

Constraints:
- Only src/webui.ts changes.

# Notes

Changed setInterval(refresh, 2000) to setInterval(refresh, 5000) in src/webui.ts:191 (only change). Ran kanban, orchestrator, and webui tests: all pass.

Review: diff against main is exactly the one-line change (src/webui.ts:191, setInterval(refresh, 2000) -> setInterval(refresh, 5000)), no other files touched. refresh() fetches /api/tasks, so the served page polls every 5 s. No test references the interval (the 5000 in webui.test.ts:90 is an unrelated timeout). Re-ran all three test files: all pass. No fixes needed.

Live test: PASS. Served the worktree's webui with startWebUi against the real board root on 127.0.0.1:4545 (main orchestrator holds port 4242 with old code). Headless Chromium over ~13.5 s: /api/tasks requested at t=0.02s, 5.02s, 10.02s, gaps exactly 5.00s (old 2s interval would give ~7 requests, saw 3). Board renders all 8 state columns and 23 cards; popup opens with title and full rendered body and closes. The "updated" label refreshes, no page or console errors. A task moved doing -> reviewing on the live board between runs and the refreshed page picked it up. Re-ran webui, kanban, and orchestrator tests from the worktree: all pass. No issues found.
