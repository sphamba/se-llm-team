---
name: "chore: split the test suite into area subdirs"
priority: "medium"
state: "done"
worktree: ""
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

## Verification pass (2026-10-17)

- Blocker cleared: main holds #257 (82160ef), #255 (5b3e980) and #256 (9673b45). The worktree fast-forwarded from a582b65 to 9673b45. All three area splits and tests/helpers.ts are present. The four monoliths are gone from tests/ root.
- pnpm test: the glob loop resolved 36 suites (index.test.ts, 4 root test files, 13 orchestrator files, 5 webui files, 7 efficiency-analysis files and 6 kanban files). All 36 suites ran green. Exit code 0 (run log /tmp/254-pnpm-test4.log). A pnpm pre-run dependency check warns about the read-only store (ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK). The check continues and does not affect the result.
- Standalone spot-check per area: node tests/orchestrator/singleton.test.ts, tests/webui/logpane.test.ts, tests/efficiency-analysis/commands.test.ts and tests/kanban/git.test.ts all exit 0.
- Assertion parity (old file at its split parent against the area sum): orchestrator 562=562 (f53e4c5 to 5b3e980), webui 797=797 (35e56b6 to 9673b45), efficiency-analysis 203=203 and kanban 179=179 (23a83ee to 82160ef). The Specs figures 558 and 739 are the 2026-10-16 measurement. #255 and #256 Notes record the same growth (562 at task start, webui 739 carved plus 58 migrated).
- Scenario refs: no 000NNN identifier from an old file is missing in its area (orchestrator 21 of 21, kanban 9 of 9, efficiency-analysis none, webui all 76 plus the 000260 split-source header comment).
- Helpers: tests/helpers.ts carries the shared HERE, fixture, runDaemon, wait helpers, the stubs, freePort, runIdx, cleanupAll, killAll, daemons, cleaned, the XDG_CONFIG_HOME deletion and the exit and signal handlers. The 13 orchestrator files and the 6 efficiency test files import the helpers that they need. No shared helper definition is copied into an area test file. The two webui HERE anchors must point at tests/webui, so they stay local. tests/efficiency-analysis/helpers.ts is the per-area helper file. The webui group files boot standalone by #256 design.
- docs/development.md: the five-suite list is replaced with the glob-loop layout (index.test.ts, the four root test files and one line per area dir) plus the standalone command. No monolith name remains in docs/.
- Race found and fixed during verification (pre-existing, not caused by the split): tests/orchestrator/spawn.test.ts asserted the role notes on refs/heads/meta/kanban immediately after the task file showed done. sweepToMerge writes done and worktree "" in one rescan. The done fold-in commit lands in the next rescan. Two full runs failed at spawn.test.ts:287 under load and one passed. The fix gates the mirror read with the existing waitFor (15 s) before the same four asserts. The assert count did not change (spawn 76, orchestrator area 562). The full pnpm test exits 0 after the fix.
- Console labels in the orchestrator area files still say "orchestrator.test.ts: ...". The #255 live test recorded them as deliberately unchanged. They stay.
- Commits: cf30f2e (test gate fix), 9b5922e (docs listing).
- Re-review at 9b5922e (claim walk, no fixes): parity re-printed old-at-split-parent vs new-sum at HEAD (orchestrator f53e4c5 562=562, webui 35e56b6 797=797, efficiency-analysis 82160ef^=23a83ee 203=203, kanban 179=179); no 000NNN ref missing in any area; no shared-helper definition copied into an area file (the two tests/webui HERE locals stay local as recorded); docs name no monolith; tests/ root holds helpers.ts plus the four root suites. Green pnpm run is recorded at the commit under review (spawn fix cf30f2e included; 9b5922e is docs-only), so zero re-runs.

## Live test (2026-10-17)

- Method: the suite did not run. A generator copied each of the 31 split files into a probe and changed one binding only: the `node:assert/strict` import became a tally assert shim (`ok`, `equal` and `notEqual` with Object.is, `deepEqual` with isDeepStrictEqual, `match`, `throws`, `rejects`, `doesNotThrow`). The scenario text stayed byte for byte. Each probe ran standalone in the merged checkout. The runner removed the probe files afterwards.
- All 31 probes passed with 0 failed assertions: orchestrator 13 files with 677 executed asserts, webui 5 files with 855, efficiency-analysis 7 files with 223, kanban 6 files with 179. Total 1,934 executed asserts. `node --check` parsed all 31 files.
- Assertion parity against the monolith at its own split parent: orchestrator 562=562 (f53e4c5), webui 797=797 (35e56b6), efficiency-analysis 203=203 (23a83ee), kanban 179=179. No assert line is missing. Only 6 assert lines differ and each one has a replacement of the same shape: the 3 `join(HERE, "..")` to `join(HERE, "..", "..")` path asserts from the one-level-deeper home, and the 3 selected-card CSS asserts from the later merged 20% accent fix (0fe10f9).
- Full-line multiset diff: all remaining differences are runner scaffolding (per-file imports and preludes, cleanup handlers, `export` helper definitions that moved to tests/helpers.ts or the area helper, blank lines, per-file console labels) and the documented spawn.test.ts waitFor gate (346c471). No scenario line is lost.
- Scenario refs: no 000NNN identifier from an old monolith is missing in its area. The webui area adds one ref, 000260, in its board group header comment.
- Import probe: 108 checks, 0 failed. It read the named imports of all 31 files, imported every specifier and confirmed every named export in the merged source.
- Split-range commits: 23a83ee, 82160ef, 9673b45 and 346c471 touch tests/ only. 5b3e980 also changes package.json (the test glob loop) and scripts/test-changed.mjs with its self-test. 35e56b6 changes the same map files. 2550074 changes docs/development.md. No product file is in the split range.
- Layout: tests/ root holds helpers.ts and the four root suites (extension, plugin, mcp, context-symlinks). The glob loop resolves 36 suites (index.test.ts, 4 root, 13 orchestrator, 5 webui, 7 efficiency-analysis, 6 kanban). docs/development.md lists the same layout and the standalone command. The worktree is clean, and no probe file or temp root is left.
- Specs baseline contradiction: the Specs facts say 558 orchestrator and 739 webui asserts. The measured counts at the split parents are 562 and 797. The #255 and #256 notes explain the growth (the webui carve added 58 asserts after the 739 carve). The acceptance "assertion counts match the baseline exactly" holds against the split-parent measurement, not against the stale Specs numbers.
- Finding (flag only): scripts/test-changed.test.mjs is stale after the webui carve. Line 19 expects the deleted tests/webui.test.ts and line 27 expects the deleted tests/kanban.test.ts. The file throws ERR_ASSERTION at line 19, and `mapToTests(["tests/kanban.test.ts"])` returns `[]`. No runner executes the file (the test glob matches `index.test.ts`, `tests/*.test.ts` and `tests/*/*.test.ts`, and no other file refers to it). scripts/test-changed.mjs itself maps correctly: a src/hub.ts change returns the 13 orchestrator files plus the 5 webui files. The .kanban grep puts the webui split tasks (#259 to #262) on this stale self-test.
- Assumption: the pre-split reference for each area is the monolith at its own split parent, because the webui monolith at 35e56b6 already lived beside the older area dirs. The webui parity therefore compares the 797-assert monolith with the 797-assert area union at HEAD.
- Assumption: the probes preserve the scenario text and swap only the assert binding, so the tallies measure the same checks as the suites.
- Assumption: `pnpm test` did not run (role rule). The recorded green 36-suite run in the Notes, the 36-suite glob count and the 31 standalone probes cover the acceptance.

