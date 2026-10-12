---
name: "perf: faster orchestrator tests; selective test runner"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "moderate"
shortName: "faster-orchestrator-tests"
---

# Summary
The orchestrator test suite takes ~210s of the ~217s total and slows the development process. Shrink the daemon delays the tests use (the biggest lever, no code changes needed) and add a selective runner that only runs test files affected by the current modifications. Both.

# Specs
Current facts (verified): every orchestrator.test.ts scenario spawns a real `node src/orchestrator.ts` daemon on a temp git fixture with a per-fixture config at .kanban/se-llm-team.json or CLI flags; the shared spawn helper (test:152-157) passes --rescan-seconds 1 --poll-minutes 0.05 (3s poll), and config-writing parts use pollMinutes: 0.05 (test:232, :316, :537, :667, :1313) with part K at autoScheduleMinutes: 0.08; pollMinutes and autoScheduleMinutes have NO validation (orchestrator.ts:130-131, fractional already used, setInterval takes pollMinutes*60*1000), rescan is CLI-only with no validation, cooldowns are already faked (utimesSync backdating test:350-352, injected clock test:1941-1944), hub election waits already shrunk via SE_LLM_TEAM_HUB_HEALTH_MS=500 / SE_LLM_TEAM_HUB_STALE_MS=1500 (test:1174, :1218). The wall clock goes to: bounce-streak waits (6+ deaths x 3s poll cadence, ~18-21s each, at test:330/:343/:369/:476/:620, ~60-75s total), fixed sleeps (~33s total at test:533/:647/:687/:718/:741/:777/:886/:914/:1076/:1605/:1630), and ~25 parts of 1s-rescan/fs.watch waitFor waits (~40-60s). No scripts exist in package.json; README:103-111 lists five bare node test commands.

Changes:
- Smaller delays, src/orchestrator.test.ts only: shrink the poll cadence from 0.05 to 0.01 (600ms) in the shared spawn helper and every config-writing scenario (pollMinutes: 0.01), cutting the bounce-streak and poll-cadence waits ~5x; keep --rescan-seconds 1 and the already-faked cooldowns and hub MS vars as they are; shrink the largest fixed sleeps only where the assertions tolerate it (leave every cap and every fake-expiry mechanism untouched). Assert nothing about absolute timing that 0.01 would break.
- Selective runner: a small runner script (scripts/test-changed.mjs, node stdlib only) that maps the current modifications (git status/diff vs main, staged or working tree) to the affected test files and runs only those, with the mapping: src/orchestrator.ts|src/pid.ts|agents/*.md -> src/orchestrator.test.ts; src/webui.ts -> src/webui.test.ts; src/kanban.ts -> src/kanban.test.ts + src/orchestrator.test.ts + src/webui.test.ts; src/hub.ts -> src/orchestrator.test.ts + src/webui.test.ts; index.ts -> index.test.ts + src/extension.test.ts; package.json -> all; no modifications -> nothing. Unknown paths fall back to running everything.
- package.json gains scripts.test (all five files) and scripts."test:changed" (the runner) without touching name/private/type/packageManager or adding dependencies; README's Checks section documents both commands and the fast-delay profile.

Tests: the runner maps representative paths correctly (assert its mapping table by import in a small self-check or by running it with a fake git state); the orchestrator suite still passes end to end with the smaller delays (run it once as the check); all other suites stay green.

# Notes
Implemented on the worktree perf/149-faster-orchestrator-tests, commits 5746e4d + 6df4db4.

- src/orchestrator.test.ts: pollMinutes 0.05 -> 0.01 (600 ms) in the shared spawn helper and all 28 config-writing scenarios. Hub CLI spawns (lines 1174/1177/1220/1221) keep 0.05 per the spec; --rescan-seconds 1, the faked cooldowns (utimesSync backdating, injected clock) and the hub MS vars are untouched. Shrank the largest fixed sleeps: part J 4000 -> 2000; the three no-extra-commit sweeps 2500 -> 1500; the recycled-pid confirm 5000 -> 2000; the restart no-twin wait 4500 -> 2500; part G linger stub 5000 -> 3000; part AF linger stub 8000 -> 5000 and its 3000 sleep -> 1500. Updated the two timing comments (3 s poll -> 600 ms poll). No cap and no fake-expiry mechanism touched; part K keeps autoScheduleMinutes 0.08 and its 1.5 s pre-cooldown assert.
- scripts/test-changed.mjs (node stdlib only): collects the changed paths from git (staged + unstaged vs HEAD, untracked files, commits vs main through merge-base; each source degrades alone when main or HEAD is missing), maps them through the spec table, and runs the mapped suites sequentially with node, stopping on the first failure. A changed *.test.ts runs itself; an unknown path runs everything; no modifications runs nothing.
- scripts/test-changed.test.mjs: mapping-table self-check with 12 assertions.
- package.json: scripts.test (the five files in README order) and scripts."test:changed". No other key touched, no dependencies added.
- README: the Checks section documents npm test, npm run test:changed and the fast-delay profile.
- Verified: node src/orchestrator.test.ts passed end to end with the smaller delays in 2m17s (was ~210s); the kanban, webui, extension and index suites and the mapping self-check all pass. The runner was also live-checked against fake git states (fresh repo, repo without main, branch-commit repo): the mappings matched the table.


## Live test report (live-tester, commit 6df4db4)

Result: all live checks passed. The suites stay with the developer and reviewer as instructed, so this report covers the user-facing flows only: the runner CLI, the npm scripts, the README and the daemon delay premise.

Delays:
- Real daemon smoke: `node src/orchestrator.ts` on a temp git fixture with `.kanban/se-llm-team.json` pollMinutes 0.01 and a dead agent. Startup logged `poll=0.01min` and the `doing -> to-do` bounce cadence was ~600 ms (6 bounces in 4.2 s). The smaller delay is honored end to end.
- Static diff check of src/orchestrator.test.ts: 28 `pollMinutes: 0.01`, 0 `pollMinutes: 0.05`; the four hub CLI spawns keep 0.05; all caps and faked cooldowns untouched. Part K keeps autoScheduleMinutes 0.08.

Selective runner: exercised in throwaway sandbox repos built from the real script, package.json and README. The five real suites were replaced by placeholder files that were never executed. A NODE_OPTIONS preload recorded and short-circuited every `node <file>` dispatch, so no repo *.test.ts ran.
- clean repo -> "no modifications, nothing to run", exit 0, nothing dispatched
- unstaged src/webui.ts -> webui only
- staged src/kanban.ts -> kanban, orchestrator, webui (in order)
- untracked agents/live-tester.md -> orchestrator
- index.ts -> extension, index; src/hub.ts + src/pid.ts -> orchestrator, webui
- package.json and unknown README.md -> all five
- a branch commit with a clean worktree, and main ahead of the branch (merge-base) -> correct subsets
- a failing first suite -> run stops, exit 3, also through `npm run test:changed`
- repo without main -> working-tree change still detected and run, exit 0
- repo without commits (HEAD missing) -> untracked src/webui.test.ts ran, exit 0
- only *.test.ts files changed -> those files run themselves
- mapped test file deleted -> "no affected test file exists, nothing to run", exit 0
- non-git directory -> "no modifications, nothing to run", exit 0
- run from a subdirectory -> chdir to toplevel, same result
- `npm test` -> five suites in README order, exit 0; a failing suite propagates its exit code
- real branch mapping (package.json, README.md, scripts/*, src/orchestrator.test.ts) -> all five, per the unknown-path fallback

Finding (low, cosmetic): in degraded git environments the detection commands leak git stderr to the console while the runner still works. A repo without main prints `fatal: Not a valid object name main`. A repo without commits prints `fatal: ambiguous argument 'HEAD'...` and the same main error. A non-git directory dumps git diff's full usage text. All three still exit 0 with the right suites. Reported to the PM as a candidate task.

Assumptions made while designing the tests:
- To honor "never run any *.test.ts file", the sandbox suites are placeholder files and a NODE_OPTIONS preload intercepted every dispatched node command. Real suite results are therefore not re-verified here, by design.
- The daemon smoke used the config pollMinutes path. The suite helper passes `--poll-minutes 0.01` as a CLI flag, which takes precedence and reads the same value.
- This branch changes package.json and README.md, so `npm run test:changed` here maps to all five suites by design (unknown path -> everything). Not a defect.
- `scripts/test-changed.test.mjs` (the mapping self-check) is not wired into npm test or into the runner's mapping. The spec scoped scripts.test to the five suites, so this is an observation, not a finding.
- No observed behavior contradicts the task's stated assumptions.

## Merge (merger, perf/149-faster-orchestrator-tests)

Base branch at both steps: main. Step 1: main merged into perf/149-faster-orchestrator-tests in the worktree, already up to date (main had no new commits since the branch forked), clean, no conflicts, so the test suites were skipped per the merge instructions. Step 2: perf/149-faster-orchestrator-tests merged into main in the project root, fast-forward f33232a..6df4db4, clean, no conflicts. Both merges complete; no fixes needed.

# Open questions
