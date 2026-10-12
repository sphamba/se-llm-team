---
name: "docs: live-tester prompt strictly scoped to the task's change"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "trivial"
shortName: "live-tester-strict-scope"
---

# Summary
Edit agents/live-tester.md so the live tester strictly scopes its testing to the features/fixes of the associated task, and does not lose time testing other things.

# Specs
Current state: agents/live-tester.md says "Test the change like a user", "Read code only when needed to run the project" and step 2 says "Run the project from {{ROOT}} like a user would. Exercise the main flows of the change" - but nothing forbids testing beyond the task's change, so a live tester can wander into unrelated flows and burn time.

Changes (agents/live-tester.md only):
- The intro gains a strict scope sentence: test ONLY the features/fixes described in the task's Summary and Specs; do not test, explore or verify other parts of the project; keep the test focused so it finishes fast.
- Step 2 gains the same boundary: exercise only the flows of the task's change; unrelated flows are out of scope, never tested, and any issue seen there is out of scope for findings (findings only cover the task's change plus technical difficulties hit while testing it).
- Keep every existing rule intact: run from {{ROOT}} (merged commit), no code edits, no unit test suites, the task-file-edit exception, the open-questions paragraph, state done whatever the result, findings to the PM subagent, and the re-read-before-transition guard.
- Placeholders {{ROOT}}/{{TASK_FILE}}/{{NAME}} stay intact.

Tests: no code tests; the orchestrator suite's rendered-prompt asserts must stay green if they pin live-tester wording (run the orchestrator suite as the check, or grep the asserts first and only run the suite when they touch this file).
