---
name: "docs: README Checks section lists only one of three test files"
priority: "low"
state: "live-testing"
worktree: "docs/90-readme-checks-section"
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
- Developer: verified src/kanban.test.ts, src/orchestrator.test.ts and src/webui.test.ts all exist on the worktree tree.
- Updated README.md "## Checks" code block to list the three suites in order. No other section changed (git diff: README.md only, +2 lines).
- Ran all three listed commands: kanban.test.ts all assertions passed, orchestrator.test.ts all smoke parts passed, webui.test.ts all assertions passed.
- Commit 92da32a on branch docs/90-readme-checks-section.
- Reviewer: diff main...HEAD is README.md only, +2 lines inside the "## Checks" code block; no other section touched. Order matches the Specs (kanban, orchestrator, webui). Re-ran all three files independently: exit 0 each (kanban all assertions passed, orchestrator smoke suite passed, webui all assertions passed). Line 49's "see [Checks](#checks)" anchor still resolves to the updated block, so no second edit needed. No findings, change accepted as-is.
