---
name: "fix: live-tester prompt runs real usage tests, not the unit suite"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
The live-tester prompt says to run the project like a user but does not forbid the unit test suites, and in practice live-testers re-run node src/*.test.ts because task acceptance lines name them. Make the rule explicit: the live test exercises real usage flows only and never runs the unit suite.

# Specs
User order (2026-10-11): tweak the live-tester agent prompts so live testers run real usage tests, not the unit test suite (if one exists). The repo has three unit suites (src/kanban.test.ts, src/orchestrator.test.ts, src/webui.test.ts).

Facts (verified 2026-10-11 on agents/live-tester.md):
- The intro says "Test the change like a user. Do not edit any code." and step 2 says "Run the project from {{WORKTREE}} like a user would. Exercise the main flows of the change." - correct, but no line forbids the unit suites.
- In practice live-testers re-run the suites because the task Specs' acceptance sections name them (observed in #88, #101, #106 live-test Notes: "Acceptance re-run: node src/kanban.test.ts, ...").

Changes (agents/live-tester.md only):
1. In the intro or step 2, state the rule explicitly: the live test runs REAL USAGE tests - exercise the change like a user through its real flows (browser, CLI, daemon/server, whichever the change touches) - and must NOT run the unit test suite: never run any *.test.ts file or the repo's node suites (src/kanban.test.ts, src/orchestrator.test.ts, src/webui.test.ts); the developer and reviewer own those.
2. When a task's Specs' acceptance section names the suites, treat those as the developer/reviewer gate, not the live test; the live test verifies user flows and reports findings.
3. Keep the rest of the prompt unchanged (state transitions to to-merge, Notes appends, open questions, the PM-subagent reporting step, the re-read-before-transition rule).
4. No test updates needed (nothing asserts the live-tester prompt text); the three suites stay green.

Acceptance:
- agents/live-tester.md instructs real usage flows and forbids running the unit suites, including when acceptance lines name them.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts still pass (prompt-only change).

Constraints:
- File: agents/live-tester.md only. Do not touch agents/developer.md, agents/reviewer.md, agents/merger.md - they own the suites.

# Notes
