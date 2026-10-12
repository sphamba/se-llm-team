---
name: "docs: live-tester prompt strictly scoped to the task's change"
priority: "medium"
state: "merging"
worktree: "docs/159-live-tester-strict-scope"
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

# Notes
- Grep of src/orchestrator.test.ts and src/webui.test.ts: no rendered-prompt assert pins live-tester body wording (stub agents only match the greeting "Live-tester"), so the suite stays green without a run. The suite is long-running (daemon smokes) and was skipped for this reason.
- Edit applied to agents/live-tester.md in worktree docs/159-live-tester-strict-scope: intro gained the strict scope sentence (test only the task's Summary and Specs, no other parts, keep it fast). Step 2 gained the boundary (exercise only the task's flows, unrelated flows out of scope, findings cover only the change plus technical difficulties).
- All existing rules verified intact after the edit: {{ROOT}} run, no code edits, no unit suites, task-file exception, open-questions paragraph, state done whatever the result, findings to PM, re-read guard. Placeholders {{ROOT}}/{{TASK_FILE}}/{{NAME}} all still present (8 hits).
- Commit a51081d on branch docs/159-live-tester-strict-scope.

# Open questions

Assumptions (confirm or correct):
- The scope sentence goes in the intro and step 2 only, no other sections of the file change.
- "Keep the test focused so it finishes fast" is guidance, not a timeout or hard limit.
- Findings already include technical difficulties hit while testing, so the step 2 sentence only re-states that existing scope, it does not add a new reporting channel.
- The orchestrator suite does not need a run because no assert pins the live-tester body wording (verified by grep).
