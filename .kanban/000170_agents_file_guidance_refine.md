---
name: "docs: refine the per-role AGENTS file guidance (concise, rewrite allowed)"
priority: "medium"
state: "done"
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

- Replaced the closing sentences of the project-guidance paragraph with "Keep it as detailed as necessary but as concise as possible. You may rewrite or compact existing sections." in all four agent prompts (agents/developer.md, agents/reviewer.md, agents/merger.md, agents/live-tester.md), commit ec5d1eb.
- The rest of each paragraph (the {{ROOT}}/.kanban/AGENTS.<role>.md path, the modify-it instruction, the examples) is unchanged. No code or test change.
- Merge step 1 (main into branch in the worktree): already up to date, no conflicts, test suites skipped per the clean-merge rule.
- Merge step 2 (branch into main at the project root): fast-forward c7c1150..ec5d1eb, no conflicts. Verified the new wording in all four agent prompts on main at ec5d1eb.

# Open questions
