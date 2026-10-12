---
name: "chore: move tests from src into tests"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "tests-out-of-src"
blockedBy: "#183"
---

# Summary
Move the test scripts out of src into a tests/ directory so tests and source separate. Followed by the module splits (#185 webui, #186 orchestrator).

# Specs

## Change
- Create tests/ and git mv the four test scripts out of src: tests/kanban.test.ts, tests/orchestrator.test.ts, tests/webui.test.ts, tests/extension.test.ts. scripts/test-changed.test.mjs stays in scripts.
- Fix the relative imports inside the moved test files: './webui.ts' -> '../src/webui.ts' and the same '../src/' prefix for every other source import.
- Update scripts/test-changed.mjs: the ALL list and every RULES suite path gain the tests/ prefix (the changed-file patterns keep matching src/*, agents/*, index.ts).
- Update README's test commands to `node tests/<file>.test.ts`; the checks stay bare node scripts, no dependencies.
- index.ts, src/*.ts and the extension entry stay untouched; the extension load path is unaffected because no runtime module moves.

## Tests
- All five suites pass from their new paths (`node tests/kanban.test.ts` etc.); scripts/test-changed.mjs still maps a modified src/webui.ts to tests/webui.test.ts.

# Notes
- Filed by the PM (user restructure order, 2026-10-12), hand-written with blockedBy "#182, #183" because the in-flight webui tasks rewrite the test files this move renames. Runs parallel to nothing until they land.
