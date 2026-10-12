---
name: "docs: refine the per-role AGENTS file guidance (concise, rewrite allowed)"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "agents-file-guidance-refine"
---

# Summary
Refine the AGENTS file guidance in all four agent prompts (agents/developer.md:25, reviewer.md:23, merger.md:28, live-tester.md:22): keep the file as detailed as necessary but as concise as possible, and allow rewriting/compacting existing sections, replacing the current "Keep it concise. Never remove other agents' guidance." wording.

# Specs
- In each of the four prompts, replace the closing sentences of the project-guidance paragraph with: keep it as detailed as necessary but as concise as possible, and you may rewrite or compact existing sections (supersedes "Never remove other agents' guidance", which compacting must be allowed to contradict).
- The rest of each paragraph (the {{ROOT}}/.kanban/AGENTS.<role>.md path, the modify-it instruction, the examples) stays unchanged.
- No code or test change: renderPrompt reads the files verbatim (src/orchestrator.ts:196), and no test asserts this paragraph's wording.

# Notes

# Open questions
