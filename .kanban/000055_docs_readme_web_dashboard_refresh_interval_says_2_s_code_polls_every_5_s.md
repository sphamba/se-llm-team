---
name: "docs: README web dashboard refresh interval says 2 s, code polls every 5 s"
priority: "low"
state: "doing"
worktree: "docs/readme-web-dashboard-refresh-interval-says-2-s-code-polls-every-5-s"
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
