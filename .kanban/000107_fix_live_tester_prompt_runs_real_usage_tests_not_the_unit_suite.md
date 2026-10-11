---
name: "fix: live-tester prompt runs real usage tests, not the unit suite"
priority: "medium"
state: "done"
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
- Edited agents/live-tester.md only (commit 0e12f13 in fix/107-live-tester-prompt): the intro now states the rule explicitly (live test runs real usage tests only, never any *.test.ts file, never the three node suites, developer/reviewer own those), and step 2 tells the live tester to exercise the real interface (browser, CLI, daemon/server) and to treat Specs acceptance lines that name the suites as the developer/reviewer gate, not the live test. Rest of the prompt unchanged.
- Suites re-run in the worktree: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass (webui needs >120s; passes within 240s). Prompt-only change, no test edits.
- Review (2026-10-11): pass, no fixes. Checked against the Specs: the intro states the rule (real usage tests only, never any *.test.ts file, never the three node suites, developer/reviewer own those), step 2 routes Specs acceptance lines that name the suites to the developer/reviewer gate, and the diff touches only those two lines of agents/live-tester.md (rest of the prompt intact). Verified nothing asserts the live-tester prompt text, and that spawnAgent resolves all placeholders the prompt uses (no new placeholders needed). Re-ran the three suites in the worktree: all pass. No open questions.
- Live test (2026-10-11): pass, no findings. Ran the real user flow end to end: a throwaway git board with a task in to-live-test and .kanban/se-llm-team.json pointing agent at a stub that records its argv, then the real daemon `node src/orchestrator.ts --root <tmp> --rescan-seconds 1`. The daemon spawned the live-tester (log: `spawned live-tester ...`) and the stub captured the rendered `-p` prompt. The rendered prompt contains the new intro rule (real usage tests only, never any *.test.ts file, never the three node suites, developer/reviewer own those) and the step 2 line (exercise the real interface browser/CLI/daemon, do not run the unit suite, Specs acceptance lines naming the suites are the developer/reviewer gate). The probe task's Specs named node src/kanban.test.ts, so the acceptance-routing line is exercised. No unresolved {{PLACEHOLDER}} tokens: TASK_FILE, WORKTREE, ROOT and NAME all substituted. `git diff main...HEAD --name-only` shows only agents/live-tester.md; developer.md, reviewer.md, merger.md untouched; --unified=0 shows exactly the two intended lines changed. Per the rule under test, the live test did not run the unit suites; the reviewer already re-ran all three green on this branch. No open questions.
- Merge (2026-10-11): complete, both steps. Step 1: merged main into fix/107-live-tester-prompt in the worktree (merge commit fcd8b2e, no conflicts; main had added index.test.ts and src/extension.test.ts). Ran all five suites in the worktree: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts, node index.test.ts, node src/extension.test.ts - all pass. Step 2: root still on main, merged fix/107-live-tester-prompt into main (fast-forward to fcd8b2e, clean). Merged agents/live-tester.md carries the new rule on main.
