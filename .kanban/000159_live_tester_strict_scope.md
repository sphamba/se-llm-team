---
name: "docs: live-tester prompt strictly scoped to the task's change"
priority: "medium"
state: "done"
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

# Notes
- Grep of src/orchestrator.test.ts and src/webui.test.ts: no rendered-prompt assert pins live-tester body wording (stub agents only match the greeting "Live-tester"), so the suite stays green without a run. The suite is long-running (daemon smokes) and was skipped for this reason.
- Edit applied to agents/live-tester.md in worktree docs/159-live-tester-strict-scope: intro gained the strict scope sentence (test only the task's Summary and Specs, no other parts, keep it fast). Step 2 gained the boundary (exercise only the task's flows, unrelated flows out of scope, findings cover only the change plus technical difficulties).
- All existing rules verified intact after the edit: {{ROOT}} run, no code edits, no unit suites, task-file exception, open-questions paragraph, state done whatever the result, findings to PM, re-read guard. Placeholders {{ROOT}}/{{TASK_FILE}}/{{NAME}} all still present (8 hits).
- Commit a51081d on branch docs/159-live-tester-strict-scope.
- Merge step 1 (worktree docs/159-live-tester-strict-scope): base branch main resolved as main. Merge was a no-op, main was already fully contained in the branch (merge-base 42b6e50, only the task commit a51081d ahead). No conflicts, so test suites were skipped per the merge procedure.
- Merge step 2 (project root on main): merged docs/159-live-tester-strict-scope into main. Clean fast-forward 42b6e50..a51081d, one file changed (agents/live-tester.md, 2 insertions, 2 deletions). No conflicts, nothing to commit extra.

## Live test report
- Scope: only the task's change (agents/live-tester.md prompt wording). No other flow tested. Unit suites not run.
- Interface exercised: the real prompt-render path of the change, renderPrompt() in src/orchestrator.ts (reads agents/live-tester.md and substitutes the placeholders), mirrored in a one-off node script from the merged project root (main, HEAD a51081d, clean tree). The daemon spawn site (spawnAgent with role "live-tester", src/orchestrator.ts:984) uses this same render path.
- Result: PASS, all 18 render checks:
  - Intro scope: "Test only the features and fixes described in the task's Summary and Specs.", "Do not test, explore or verify other parts of the project.", "Keep the test focused so it finishes fast." all present.
  - Step 2 boundary: "Exercise only the flows of the task's change through its real interface", "Unrelated flows are out of scope: never test them, and any issue you see there is out of scope for findings.", "Findings cover only the task's change plus technical difficulties you hit while testing it." all present.
  - Existing rules intact: run from {{ROOT}} (merged commit), no code edits, read code only when needed, no unit suites (the three node suites named), task-file-edit exception, open-questions paragraph, state done whatever the result, findings to the PM subagent, re-read-before-transition guard.
  - Placeholders: 8 hits in the file ({{NAME}} 2, {{ROOT}} 3, {{TASK_FILE}} 3); after render, no {{...}} remains and {{ROOT}}/{{TASK_FILE}}/{{NAME}} all resolve to the real root, task path and task name.
- Specs test condition verified by grep: src/orchestrator.test.ts and src/webui.test.ts contain no assert pinning the live-tester body wording. The stub-agent matcher (src/orchestrator.test.ts:1306) keys off the unchanged greeting "Live-tester", so the orchestrator suite stays green. Suite not run, per Specs.
- No findings, so no PM subagent for new tasks.
- Assumptions made while designing the usage test:
  - For a prompt/docs-only change, the user-facing "real interface" is the rendered agent prompt the orchestrator hands to the spawned live tester; testing that render (plus the file content in the merged checkout) covers the change end to end. Spawning a real LLM live tester would only re-verify the wording by running it, at high cost, so it was skipped.
  - Rendering was mirrored in a one-off script rather than imported, because renderPrompt is a module-local function with no exported entry point. The mirror copies lines 197-205 verbatim; a divergence there would be a change in the orchestrator, out of this task's scope.
  - No task-file edit besides this report and the state change was needed.

# Open questions

Assumptions (confirm or correct):
- The scope sentence goes in the intro and step 2 only, no other sections of the file change.
- "Keep the test focused so it finishes fast" is guidance, not a timeout or hard limit.
- Findings already include technical difficulties hit while testing, so the step 2 sentence only re-states that existing scope, it does not add a new reporting channel.
- The orchestrator suite does not need a run because no assert pins the live-tester body wording (verified by grep).
