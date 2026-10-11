---
name: "docs: README Checks section lists only one of three test files"
priority: "low"
state: "backlog"
worktree: ""
---

# Summary
Pre-existing, found during the live test of #86: the README "Checks" section lists only `node src/kanban.test.ts`, while the full suite is three files (`node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts`). List all three so the documented check matches what the pipeline runs.

# Specs
Genuine finding from the live test of #86, pre-existing and not caused by #86 (priority low).

Facts (verified on current tree):
- README.md "## Checks" (line ~89) shows a single command: `node src/kanban.test.ts`.
- The full suite is three files: `node src/kanban.test.ts`, `node src/orchestrator.test.ts`, `node src/webui.test.ts` (also the acceptance suite named in #86's specs and run by the pipeline).
- Other README lines already say "the checks still run via node directly" without listing the three files, so only the Checks code block needs the full list.

Change:
- Update the README "Checks" section to list all three suites, e.g. a code block with the three `node src/...test.ts` commands in order.

Acceptance:
- The README Checks block names all three test files.
- All three listed commands pass when run.
- No other README section changes.

Constraints:
- Files: README.md only.

# Notes
