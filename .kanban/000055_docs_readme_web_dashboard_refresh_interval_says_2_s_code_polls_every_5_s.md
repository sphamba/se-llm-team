---
name: "docs: README web dashboard refresh interval says 2 s, code polls every 5 s"
priority: "low"
state: "done"
worktree: ""
---

# Summary
README.md Web dashboard section states the page refreshes every 2 s; since 000022 the webui client polls every 5 s (setInterval(refresh, 5000) in src/webui.ts). Update the README line to say 5 s.

# Specs
Fix README documentation staleness found by the 000036 live test (30/30 checks passed; the change itself has no issues).

- File: README.md, Web dashboard section (present in both the main checkout and the worktree; fix in the main checkout).
- Sentence to fix: "The board is re-read on every request and the page refreshes itself every 2 s."
- Change: "2 s" to "5 s" in that sentence.
- Source of truth: setInterval(refresh, 5000) in src/webui.ts — task 000022 (perf: webui board polling every 5s instead of 2s, done) moved the client polling from 2 s to 5 s; the README was never updated.
- Docs-only one-line fix; no code changes needed.

# Notes
- Fixed README.md Web dashboard section: "refreshes itself every 2 s" -> "every 5 s" (matches setInterval(refresh, 5000) in src/webui.ts). Committed 153d31c on docs/readme-web-dashboard-refresh-interval-says-2-s-code-polls-every-5-s. Docs-only, no code changes.
- Review (000055): pass, no fixes. Diff main...HEAD is exactly the one-line README change (1 insertion, 1 deletion, no other files); worktree clean; commit 153d31c verified. Worktree README says "every 5 s"; source of truth confirmed at src/webui.ts:441 setInterval(refresh, 5000) (setInterval(pollLog, 1000) at line 377 is the unrelated log poller). Main checkout README still says 2 s as expected before the done merge; the orchestrator merges the branch on done.
- Live test (000055): pass, no issues. 1) Worktree README line 53 says "the page refreshes itself every 5 s"; diff main...HEAD is the one-line fix only. 2) Ran the daemon from the worktree (node src/orchestrator.ts --root scratch) with a project-level webUi override on port 4243; it started and logged "web ui on http://127.0.0.1:4243" (config override and failed-start-free path both worked). 3) Dashboard at / returned HTTP 200 and the served client JS contains setInterval(refresh, 5000) at src/webui.ts:441, matching the README claim. 4) /api/tasks re-read the board live: it reflected the daemon's auto state move (doing -> to-do) between two fetches. 5) Real-browser check (headless Chrome over CDP) against the worktree daemon: the page rendered 2 task cards and the #updated timestamp advanced at ~5 s and ~10 s after load (2 changes in 12 s of sampling = 5 s poll; a 2 s poll would give ~5, no poll would give 1). Scratch daemon and temp files cleaned up; the real orchestrator (pid 2274165) was untouched.
