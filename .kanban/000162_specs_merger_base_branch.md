---
name: "docs: SPECS Merger text hardcodes main and always runs the tests"
priority: "low"
state: "doing"
worktree: "docs/162-specs-merger-base-branch"
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

# Open questions

