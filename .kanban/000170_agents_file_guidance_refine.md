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

## Live test (2026-10-12)

PASS, no findings. No PM task created.

Flow exercised (real interface = daemon spawn): scratch bare clone of the merged commit ec5d1eb (meta/kanban ref deleted, isolated HOME), fake-pi recording the real spawn argv, daemon started from the merged code with --rescan-seconds 1. Four probe tasks, one per role trigger state: to-do (developer), to-review (reviewer), to-live-test with a worktree branch that is an ancestor of HEAD (live-tester), to-merge with a worktree branch (merger). All four spawned in one sweep; fake-pi records show the real pi argv.

Checks on each of the four spawn payloads (-p argument):
- Structural equality with the shipped agents/<role>.md: same line count, every {{VAR}} substituted (no leftover placeholder), no other text difference.
- The project-guidance paragraph equals the shipped line with {{ROOT}} rendered to the fixture root, so the path, the modify-it instruction and the examples are unchanged.
- "Keep it as detailed as necessary but as concise as possible. You may rewrite or compact existing sections." present; "Never remove other agents' guidance." absent.
- --append-system-prompt points at {{ROOT}}/.kanban/AGENTS.<role>.md and the file content is non-empty (the daemon created the one-line starter file).
- Merged tree: git grep finds the old wording nowhere tracked, and the new wording exactly once in each of the four files; project root clean at ec5d1eb.

Assumptions made while designing the tests:
- The daemon spawn is the user-facing interface of these prompt files (renderPrompt -> -p, role notes -> --append-system-prompt), and nothing else consumes agents/*.md. Rendering the merged checkout verbatim means the captured argv is exactly what an agent would receive.
- The acceptance note "no test change" means the unit suites are the developer/reviewer gate, so the live test did not run them, per role instructions.

No observed behavior contradicts the task's stated assumptions. One difficulty was in my own harness only: an extensionless Node ESM fake-pi script silently exited without recording anything, so it was renamed fake-pi.mjs. Not a project issue.

# Open questions
