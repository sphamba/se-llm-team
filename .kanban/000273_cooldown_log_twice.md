---
name: "fix: poll.test.ts cooldown log fires twice on main"
priority: "high"
state: "done"
worktree: ""
issuer: "#270"
complexity: "moderate"
shortName: "cooldown-log-twice"
---

# Summary
node tests/orchestrator/poll.test.ts fails on a clean main checkout: the "respawn waits for the idle cooldown" log fires twice within the 30 s window but the test asserts exactly once (actual 2, expected 1). The log site is designed to fire exactly once per death streak (bumpCounter === RESPAWN_CAP + 1), so either the streak cleared and re-reached the cap, or a bounce/counter change after the test split broke the exactly-once property.

# Specs
Goal: find the root cause of the double cooldown log on main and fix the behavior (or the test, if the behavior is intended); the full suite must be green on main again.

Facts (verified 2026-10-17 on a clean main checkout, only an untracked TODO.md):
- node tests/orchestrator/poll.test.ts fails: tests/orchestrator/poll.test.ts:46 assert.equal(..., 1, "cooldown log fired exactly once") — actual 2, expected 1. The preceding waitFor (line 45, 30 s window) waits for the FIRST occurrence, so both occurrences land inside that window.
- The log site: bounceDead in src/orchestrator/liveness.ts:88-92. The line `${slug}: agent died ${RESPAWN_CAP}+ times; respawn waits for the idle cooldown (state ${next})` fires ONLY when bumpCounter(root, `${slug}.dead`) === RESPAWN_CAP + 1 (RESPAWN_CAP default 5, config.ts defaults) — exactly once per death streak by design ("logged once at cap+1, like the old give-up line").
- The streak clears in clearDeadStreak (liveness.ts:95-99): a completed run (exit-0 handling) resets the dead counter to 0 and logs "run completed, cleared the dead-agent counter". A cleared streak that re-reaches RESPAWN_CAP + 1 logs the cooldown line a second time.
- The bounce is unconditional past RESPAWN_CAP ("a frozen mid-flight task is worse than a bounced one, only the respawn backs off"); under the cap each respawn is immediate (the test: 600 ms poll, six deaths = six bounces).
- The test scenario (poll.test.ts, scenario B, taskB/rootB): six deaths, six bounces, each carrying a per-run death marker, then the cooldown log expected exactly once at cap+1, then the task file is aged past the idle interval (utimesSync) to release the deferred respawn.
- tests/orchestrator/poll.test.ts was only touched by the test-split chore (commit 5b3e980); the regression came from a src/ change after that split.
- The Reviewer of task #270 found this in its union run (2026-10-17, base cfb11c2): poll.test.ts "cooldown log fired exactly once" fails twice on that tree, judged pre-existing relative to #270's diff and not verdict-changing. It fails on plain main too (verified).

Hunt:
1. git log the cooldown/bounce/streak area (src/orchestrator/liveness.ts, the poll exit-0 path, and anything touching `${slug}.dead` counters) since 5b3e980 to find the change that made the log fire twice.
2. Decide whether the double log is a real behavior defect (a cleared streak legitimately re-reaching the cap and logging again, or a double-bounce corrupting the death counter) or a test artifact (the fixture now triggers two streaks within the window). Fix the root cause: if the behavior is intended (a new streak may log again), make the assert match the intent and say so; if not, fix the code.
3. Check the interaction with task #266's review-counter reset (pipeline.ts rescan to-do branch) and any in-flight task touching liveness.ts (#269/#271/#272 are doing in worktrees — do not wait for them, but note if their areas overlap).
4. Keep every existing poll.test.ts assert unless the intended behavior changed; a dropped assert needs a reason.

Acceptance: node tests/orchestrator/poll.test.ts passes on main, pnpm test passes, and the exactly-once (or intended) cooldown-log property is asserted.

Out of scope: the respawn-cap semantics themselves, the webui, and the marker/scope work of #269.

# Notes
- 2026-10-17 Splitter: no split. This is a one-root-cause debug, not parallel work. The log site (src/orchestrator/liveness.ts, bumpCounter === RESPAWN_CAP + 1) and the test scenario (tests/orchestrator/poll.test.ts part B) form one coupled pair. The two fix outcomes (fix the code vs make the assert match the intent) are alternatives, not parallel pieces, and the diagnosis must come first. Every candidate change touches both files, so no cut avoids a shared source file. One developer runs: git log the area, decide behavior vs test artifact, fix at the root, run the suite. Steps 1-3 of the Hunt are sequential and share one context; step 3 (#266/#269/#271/#272 overlap check) is a read-only note, not a work item.
- 2026-10-17 Developer: root cause found; the fix already sits on main, no new commit needed. The part B cooldown-count asserts tallied the bare substring "respawn waits for the idle cooldown" over the whole daemon output, but part B runs two dying fixture tasks: the dead developer (taskB) and the dead live-tester (taskB2), which keeps respawning once the orchestrator merges its branch and also reaches RESPAWN_CAP + 1 inside the same window. Each streak fires the log exactly once (bounceDead logs only at bumpCounter === RESPAWN_CAP + 1, src/orchestrator/liveness.ts:90), so the second line is the live-tester's own streak, not a double fire of one streak. The behavior is correct; the assert was wrong.
- Fix: commit 747ab05 on main ("test(orchestrator): scope the cooldown log counts to the dead-agent task", 2026-10-17 22:28), slug-scoped counts via a cooldownB helper that filters lines on "<slug>: agent died" plus the cooldown text. It matches the recipe recorded in the developer role notes (Project facts). Code untouched, every existing assert kept.
- This worktree branched at cfb11c2, before the fix; fast-forwarded fix/273-cooldown-log-twice to main's tip 747ab05 and verified node tests/orchestrator/poll.test.ts green (exit 0, 6 smoke parts, no error lines). A pre-ff run at cfb11c2 also passed (exit 0): the race is timing-dependent (poll and rescan cadence alignment), which matches the flake reports from #270's union run.
- Deviation: pnpm test (full suite) not run, per the project rule that the scoped suite is the whole test scope; 747ab05's commit message records "Full suite passes" on main.
- 2026-10-17 Reviewer: re-review at 747ab05 (worktree HEAD == main tip, clean tree, diff main...HEAD empty). git show 747ab05 confirms the fix shape: the three count asserts and the second-streak waitFor now use the slug-scoped cooldownB helper (tests/orchestrator/poll.test.ts:32-35, :50, :62, :80-81); assert messages and every other assert kept, src untouched. The diagnosis holds: taskB2 (the dead live-tester) reaches its own RESPAWN_CAP + 1 streak inside the window, and the filter on "<slugB>: agent died" excludes its lines, so the counts are deterministic and each streak still logs exactly once (src/orchestrator/liveness.ts:90, cap+1 by design per the spec Facts).
- Tests: poll.test.ts green at 747ab05 recorded above (exit 0, 6 smoke parts); zero re-runs per the green-run-at-reviewed-sha rule. Scoped union = tests/orchestrator/poll.test.ts only (the diff touches no other file); pnpm test stays unrun per the project rule.
- Hunt 3 overlap: none. The diff touches only tests/orchestrator/poll.test.ts, so #269 (markers/scope) and #271/#272 (src worktrees) share no file with it; #266's review-counter reset lives in pipeline.ts, also untouched.
- Cosmetic: 747ab05 was committed on main rather than the task branch (the branch was ff'd to it afterward, so the merge is a no-op ff), and its commit message over-claims ("a probe at HEAD ... so the race predates the marker task" — a probe at a commit that already includes c19fc2c cannot prove predation; the Notes' timing-dependent record is the accurate one). Neither changes the verdict.

## Live test (2026-10-17)
- Scope: tests-only fix; HEAD is the merge 747ab05 (only tests/orchestrator/poll.test.ts, +8/-4). The named suites were not run (suite ban); the live test exercised the production surface poll.test.ts pins: the daemon cooldown log over the part-B fixture (dead developer + dead live-tester).
- Static checks: `git diff --name-status 747ab05^ HEAD` = M tests/orchestrator/poll.test.ts only; assert count 62 == 62 and the sorted assert-line diff is exactly the three cooldown counts, messages unchanged. The helper at tests/orchestrator/poll.test.ts:33-35 filters on `<slug>: agent died` plus the cooldown text.
- Live daemon (real src, isolated HOME, SE_LLM_TEAM_NO_WEBUI=1, poll 0.01 min, rescan 1 s, deadStub exit 1): 20 checks, 0 failed. Both fixture tasks reached cap+1 and logged their first cooldown line 2 ms apart (000001_dead_agent 20:51:19.782Z, 000002_dead_merger 20:51:19.784Z). At the moment the test's bare-substring wait returns, the bare count is 2 (the old assert's actual 2) while the slug-scoped counts are 1 and 1 (the new assert's values).
- Exactly-once held: each slug-scoped count stayed 1 through the aged release and the 7th bounce; the death counter stayed 6 during the cooldown wait; all six developer runs carried their own `.dead` marker with a numeric pid; no run 6 log before aging and a run 6 log after. The deliberate second streak (done + stale pid, counter clear, back to to-do) took the task to exactly 2 scoped lines, the other task's count stayed 1.
- Assumptions: the daemon fixture mirrors part B (deadStub agent, `feat/dead-merger` branch, backlogIdleMinutes 0); the real global config (agent `pi`, webui 4242) is bypassed by the isolated HOME and `--no-webui`, so no production daemon or hub was touched.
- Not verified here: `node tests/orchestrator/poll.test.ts` and `pnpm test` (suite ban). Their green record is the developer/reviewer Notes at 747ab05; the live daemon behavior above is the independent evidence for the fix's property.

