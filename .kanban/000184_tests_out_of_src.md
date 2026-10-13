---
name: "chore: move tests from src into tests"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "tests-out-of-src"
blockedBy: ""
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
- Done: git mv the four suites to tests/, fixed the ../src/ imports plus the HERE-based paths inside them (daemon spawn paths, the racer/creator eval URLs in kanban.test.ts, realWebui URL, and the .webui-hot- sweep which must keep cleaning src/). index.test.ts's ../index.ts resolution is location-independent, untouched.
- Updated scripts/test-changed.mjs (ALL + RULES suite paths, patterns unchanged) and its mapping test, package.json, README. Also fixed stale suite paths in skills/se-llm-team/SKILL.md and agents/live-tester.md (one-line doc fixes, not in the spec's change list, so no doc points at the old paths). Runtime modules, index.ts and the extension entry untouched.
- All five suites pass from the new paths; scripts/test-changed.mjs maps a modified src/webui.ts to tests/webui.test.ts. Committed e3bfbf6.
- Updated the test command line in .kanban/AGENTS.developer.md (developer guidance) to the new tests/ path.
- Review pass 1 (2026-10-13, no fixes needed): verified commit e3bfbf6 against the Specs. git mv preserved the renames; every moved-suite import now points at ../src/, the HERE-based paths inside them were fixed with it (orchestrator daemon spawns, kanban racer/creator module URLs, webui realWebui URL, and the .webui-hot- sweep now cleans src/). test-changed.mjs ALL/RULES and its mapping test carry the tests/ prefix with the src/*, agents/*, index.ts patterns unchanged; package.json and README updated. index.ts, index.test.ts and the runtime modules are untouched (empty diff). No stale src/<name>.test.ts reference remains outside tests/. Ran all five suites from the new paths: test-changed mapping test, extension, kanban, orchestrator and webui all pass; main had not moved past the branch base, so no re-merge was needed. Also fixed the two stale suite commands left in .kanban/AGENTS.reviewer.md (role guidance, not repo code).
- Merge (2026-10-13): step 1 merged main into chore/184-tests-out-of-src, already up to date (main had not moved past the branch base), no conflicts, so the suites were not re-run. Step 2 merged chore/184-tests-out-of-src into main, fast-forward to e3bfbf6, clean, nothing to resolve. Merged commit e3bfbf6 now on main for the live test.
- Live test (2026-10-13, main e3bfbf6, no unit suite run: the Specs acceptance suites are the developer/reviewer gate per the live-tester role instructions): pass, no issues. Verified through the real interfaces:
  - Layout: `git diff -M --name-status 363325e e3bfbf6` shows the four suites as renames into tests/ and no runtime file changed (besides the renames only README.md, agents/live-tester.md, package.json, scripts/test-changed.mjs, scripts/test-changed.test.mjs and skills/se-llm-team/SKILL.md were touched); src/ holds no test file.
  - Imports: every relative import/URL in the four moved suites resolves on disk (../src/kanban.ts, ../src/hub.ts, ../src/orchestrator.ts, ../src/pid.ts, ../src/webui.ts, ../index.ts); the HERE-based daemon spawns point at ../src/orchestrator.ts, the kanban racer/creator eval URLs at ../src/kanban.ts, webui's realWebui at ../src/webui.ts and its .webui-hot- sweep at src/.
  - test-changed CLI (real end-to-end in a scratch clone of e3bfbf6; spawnSync stubbed via --require so the suites never run while the git execSync calls stay real): src/webui.ts -> tests/webui.test.ts (spawned argv tests/webui.test.ts), src/kanban.ts -> kanban/orchestrator/webui suites, src/pid.ts -> tests/orchestrator.test.ts, index.ts -> tests/extension.test.ts + index.test.ts, tests/kanban.test.ts -> itself, an unknown path (README.md) -> all five, a clean tree -> "no modifications, nothing to run". Old-commit control (363325e) maps src/webui.ts to src/webui.test.ts, so the commit is what moved the mapping.
  - Docs: README's five `node tests/...` lines and package.json's test script all name existing files; SKILL.md, agents/live-tester.md, .kanban/AGENTS.developer.md and .kanban/AGENTS.reviewer.md were updated. No stale src/<name>.test.ts path remains in tracked current docs (only historical .kanban task files).
  - Assumption: the five suites were not executed (role rule); path and import integrity is verified statically plus through the test-changed spawn argv, and the reviewer's Notes report all five green from the new paths. No observed behavior contradicted the task's stated assumptions.

# Open questions
- None.
