---
name: "docs: SPECS Merger text hardcodes main and always runs the tests"
priority: "low"
state: "done"
worktree: ""
issuer: "#156"
complexity: "simple"
shortName: "specs-merger-base-branch"
---

# Summary
SPECS.md still describes the Merger as merging a hardcoded "main" and running the test suites unconditionally. Since #102 and #113 the Merger resolves the project root's current branch at the start of each step (agents/merger.md:11,:14) and runs the suites only when it had to resolve conflicts (:13). README.md:78 has the base-branch part right but still says it runs the tests there unconditionally.

# Specs
Docs-only: SPECS.md's Merger text and one clause of README.md. Found by the #156 live test.

Two inaccuracies, both settled by the #102 and #113 fixes (agents/merger.md is the source of truth):

(a) The base branch is not a hardcoded main. agents/merger.md:11 and :14 (repeated at the start of both merge steps): "Resolve the base branch of the project root checkout (git -C {{ROOT}} branch --show-current)... Never merge a hardcoded main." A detached root checkout refuses the merge with a Note and requeues the task to to-merge.

(b) The suites are conditional. agents/merger.md:13: "If the merge was clean (no conflicts), skip the test suites entirely and go straight to step 2 ... Only when you had to resolve conflicts (semantic-merge risk) run the project's test suites in the worktree and fix what they expose."

Exact spots:
- SPECS.md:41-43 (to-merge bullet): "the Merger merges main into the task worktree, resolves conflicts and runs the tests there, then merges the branch into main and sets \"to-live-test\"" -> the project root's current branch, resolved at the start of each step; suites only on conflict resolution.
- SPECS.md:74-75 (the Merger section): :74 "Merges main into the task worktree, resolves conflicts, and runs the tests there. When the two sides disagree, main wins unless the task Specs say otherwise." and :75 "Merges the task branch into main, then moves the task to \"to-live-test\"". Same corrections; "main wins" becomes "the base branch wins".
- README.md:78 (merging bullet, edited by #156): already says "resolves the project root's current branch at the start of each merge" but still says "resolves conflicts and runs the tests there" unconditionally -> make the suite run conditional on resolved conflicts.

Do not change the neighbouring statements that are already correct: "aborts any merge left dirty" (SPECS.md:76), "sets to-live-test", the done bullet.

Repro: sed -n '41,43p;73,77p' SPECS.md; sed -n '78p' README.md; sed -n '11,14p' agents/merger.md

Acceptance:
- No Merger step in SPECS.md or README.md merges a hardcoded main; SPECS.md:41-43 and :74-75 name the project root's current branch, resolved per step, and the suites only when conflicts had to be resolved.
- sed -n '78p' README.md no longer claims an unconditional test run.
- node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts pass (docs-only; no code change and no new test).

# Notes
- Edited SPECS.md:42 (to-merge bullet) and SPECS.md:74-75 (Merger section): base branch is the project root's current branch, resolved at the start of each step; suites run only when conflicts had to be resolved; "main wins" became "the base branch wins".
- Edited README.md:78 (merging bullet): made the suite run conditional on resolved conflicts; the base-branch wording from #156 was already correct and stays.
- Left the neighbouring statements untouched: the "main never sits mid-merge" abort clauses (SPECS.md:43,:76), "sets to-live-test", the done bullet, and README.md:120 (test:changed maps against main, not a merger step).
- Committed as fa8ec2e on docs/162-specs-merger-base-branch. Acceptance checks pass: no Merger step in SPECS.md or README.md merges a hardcoded main; node src/kanban.test.ts && node src/orchestrator.test.ts && node src/webui.test.ts all pass.
- Review of fa8ec2e: diff covers exactly the three spots the Specs name, wording matches agents/merger.md (base branch resolved per step, suites only on conflict resolution, "the base branch wins"). Remaining "main" mentions are the "so main never sits mid-merge" abort clauses the Specs say to leave. Acceptance suites all pass (webui.test.ts re-run alone after the combined run hit the review timeout; it passes in 6s). No fixes, no unvoiced assumptions. State set to to-merge.
- Merged by the Merger. Step 1: root checkout was on main; merged main into docs/162-specs-merger-base-branch in the task worktree, clean (only agents/live-tester.md came over), merge commit 6a5666a. Clean merge, so the suites were skipped per the task rules. Step 2: root still on main; merged the branch into main, fast-forward a51081d -> 6a5666a, clean. No conflicts, no fixes. Open questions: none.
- Live test (docs-only change; root checkout at dc5ee61 on main, branch docs/162-specs-merger-base-branch is an ancestor of HEAD). Ran the Specs repro as a user: `sed -n '41,43p;73,77p' SPECS.md; sed -n '78p' README.md; sed -n '11,14p' agents/merger.md`, then checked every line against agents/merger.md, the source of truth. All acceptance items pass: SPECS.md:42 and :74 name the project root's current branch resolved at the start of each step (SPECS.md:75 likewise for step 2); the suite run is conditional ("only when it had to resolve conflicts") at SPECS.md:42, SPECS.md:74 and README.md:78; SPECS.md:74 says "the base branch wins"; README.md:78 no longer claims an unconditional test run. Repo-wide grep for "merges main into", "hardcoded main" and "main wins" finds no remaining Merger step: the only "main" mentions in SPECS.md are the untouched "so main never sits mid-merge" abort clauses (SPECS.md:43,:76) the Specs say to leave, plus README.md:89 and :120 which are unrelated to a Merger step. Neighbouring statements untouched as required: "aborts any merge left dirty", "sets to-live-test", the done bullet. Assumptions: (1) a docs-only task's user interface is the docs text, so the live test compares SPECS.md/README.md against agents/merger.md plus the Specs repro, instead of running a real Merger flow; (2) the Merger's branch resolution and conditional suites are prompt directives, so there is no code path to exercise outside the developer/reviewer suites, which the live test must not run. Technical difficulties: none. Observed behaviour contradicting the task's stated assumptions: none. No findings, so no Project manager report. The only stale wording left is a code comment (src/orchestrator.ts:800, "a Merger merges main into the branch"); it is outside this task's scope (SPECS.md/README.md Merger steps) and already recorded as a known out-of-scope item by #102, so no task was raised.

# Open questions

