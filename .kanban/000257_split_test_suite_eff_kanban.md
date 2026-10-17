---
name: "chore: split-test-suite efficiency-analysis and kanban areas"
priority: "medium"
state: "to-review"
worktree: "chore/257-split-test-suite-eff-kanban"
issuer: "#254"
complexity: "simple"
shortName: "split-test-suite-eff-kanban"
---

# Summary
Split tests/efficiency-analysis.test.ts (987 lines, 203 assertions) into tests/efficiency-analysis/*.test.ts and tests/kanban.test.ts (510 lines, 179 assertions) into tests/kanban/*.test.ts. This task owns only those two files and their new subdirs; the shared files (package.json, scripts/test-changed.mjs, tests/helpers.ts) belong to the orchestrator split task #255.

# Specs
Facts (measured by the PM on 2026-10-16): tests/efficiency-analysis.test.ts is 987 lines / 203 assertions (grep -c "assert\."), with fixtureDir() (line 30) and a dirs[] cleanup; tests/kanban.test.ts is 510 lines / 179 assertions and patches fs.writeFileSync at the top. Both are plain top-level scripts (node:assert/strict, top-level awaits, no test framework) runnable with node tests/<file>.ts, importing from "../src/*.ts" with explicit .ts extensions.

Requirements:
1. Split tests/efficiency-analysis.test.ts into tests/efficiency-analysis/*.test.ts and tests/kanban.test.ts into tests/kanban/*.test.ts files by scenario group; the seams are the developer's judgment. The small root files (plugin, mcp, extension, context-symlinks) stay at tests/ root unchanged.
2. Per-area helpers shared between one area's split files stay in that area's subdir (for example tests/kanban/helpers.ts). Do not create or edit the root tests/helpers.ts: the orchestrator split task #255 owns it.
3. src imports become "../../src/*.ts" from the subdir files. Scenario comments carrying 000NNN task references move with their scenarios.
4. Each split file stays a standalone node script: node:assert/strict, top-level awaits, runnable with node tests/<area>/<file>.test.ts.
5. No test skipped or dropped: every one of the 203 efficiency-analysis and 179 kanban assertions lands in a split file.
6. Ownership: this task owns tests/efficiency-analysis.test.ts, tests/kanban.test.ts and their new subdirs only. Do not touch package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts or tests/webui.test.ts.
7. Live check note: pnpm test can fail in the worktree while the old package.json script still names the old single files (the glob loop lands with task #255). That is expected, do not fix it: the check for this task is running each split file standalone.
8. State the big assumptions affecting the feature.

Acceptance:
- node tests/<area>/<file>.test.ts works standalone and passes for each split file.
- No assertion count regression: all 203 + 179 assertions land in the new files (compare the old files from git history with the new area dirs).

# Notes
- Split tests/efficiency-analysis.test.ts (987 lines, 203 assertions) into tests/efficiency-analysis/: parse, claude, commands, pipeline, merge, doctor, prompts, plus helpers.ts for the shared synthetic fixture and record stubs.
- Split tests/kanban.test.ts (510 lines, 179 assertions) into tests/kanban/: naming, taskfile, attributes, blockedby, locking, git.
- The split copies the original test bodies line for line. src imports use ../../src/*.ts. The two import.meta.dirname path joins in tests/kanban/locking.test.ts use ../.. to reach src from the subdir.
- Assertion parity: grep -c 'assert\.' gives 203 and 179 on the new area dirs, the same counts as the old single files from git history.
- All 13 split files pass standalone with node tests/<area>/<file>.test.ts. The two old single files are deleted. No change to package.json, scripts/test-changed.mjs, tests/helpers.ts, tests/orchestrator.test.ts or tests/webui.test.ts.
- pnpm test still names the old single files and fails until task #255 lands the glob, as Spec 7 expects.
- Updated one stale path in .kanban/AGENTS.developer.md: the prompt byte pin now points to tests/efficiency-analysis/doctor.test.ts.

# Open questions
- Assumption: the kanban split needs no tests/kanban/helpers.ts because the six groups share no helper code. Each file makes and removes its own fixture root. Confirm if a shared helper is wanted anyway.
