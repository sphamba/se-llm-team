---
name: "chore: split the test suite into area subdirs"
priority: "medium"
state: "doing"
worktree: "chore/254-split-test-suite"
issuer: "user"
complexity: "simple"
shortName: "split-test-suite"
blockedBy: ""
---

# Summary
Verify the three area splits of the test suite landed: npm test runs the glob loop over tests/**/*.test.ts and passes, every split file works standalone, assertion counts match the pre-split baseline, helpers live in tests/helpers.ts without copy-pasted blocks, and the docs suite listing matches the new layout.

# Specs
Facts (baseline, pre-split): orchestrator.test.ts 558 assertions, webui.test.ts 739, efficiency-analysis.test.ts 203, kanban.test.ts 179 (grep -c "assert\.").

Blocking (settled 2026-10-17): this verification checks the merged result of #255, #256 and #257 on main. #257 is already done, so no extra blocker ref is needed; the task stays blocked by #255 and #256 and runs once those two clear.

Verification steps:
1. pnpm test passes: the glob loop over tests/**/*.test.ts picks up the orchestrator/, webui/, efficiency-analysis/ and kanban/ area dirs plus the root files (plugin, mcp, extension, context-symlinks, index).
2. node tests/<area>/<file>.test.ts works standalone for each split file (spot-check at least one per area).
3. No assertion count regression: compare the old files from git history (git show main:tests/orchestrator.test.ts etc) with the new area dirs, per-file grep -c "assert\." old vs sum over the area dir.
4. The four old files are gone from tests/ root and the 000NNN scenario comments moved with their scenarios into the split files.
5. Shared helpers (fixture, runDaemon, temp-dir setup, daemon-run helpers) live in tests/helpers.ts with no copy-pasted helper blocks in the split files; per-area helpers stay in their area subdirs.
6. docs/development.md's suite listing still names the old single files: update it to the new layout once the areas have landed.

Acceptance:
- pnpm test passes end to end.
- Assertion counts match the baseline exactly.
- docs/development.md matches the new layout.

# Notes
- Blocked, verification cannot run. The three prerequisite splits have not landed at branch base a582b65 (= main): tests/ still holds kanban.test.ts, orchestrator.test.ts, webui.test.ts and efficiency-analysis.test.ts. tests/orchestrator/, tests/webui/, tests/efficiency-analysis/, tests/kanban/ and tests/helpers.ts do not exist. package.json "test" is still an explicit file list, not the tests/**/*.test.ts glob loop. docs/development.md still lists the old single files. Task #255 is to-do, #256 is to-do, #257 is doing on a branch with no commits.
- No code change and no commit in this worktree. Re-run this task after #255, #256 and #257 merge.

# Open questions

