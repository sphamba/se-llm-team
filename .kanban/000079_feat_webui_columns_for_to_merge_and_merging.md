---
name: "feat: webui columns for to-merge and merging"
priority: "high"
state: "done"
worktree: ""
---

# Summary
Add the to-merge and merging columns to the webui board in pipeline order, with accent classes, a spinner while merging, and merger logs viewable in the task detail card.

# Specs
Webui part of the to-merge/merging feature (the states and orchestrator flow are a separate task).

Facts (verified at HEAD e4c0358):
- Board columns render straight from STATES injected from src/kanban.ts (`const STATES = ${JSON.stringify(STATES)}` src/webui.ts:408; board.innerHTML = STATES.map(...) :469-476), so the two new columns appear automatically once the states land.
- WORKING = ["doing", "reviewing", "live-testing"] (:409) drives the spinner .spin (:346, used :473); accent classes .c-{state} :386-394, one per column in pipeline order.
- src/webui.test.ts STATE_NAMES :11 duplicates the 8 states; :253 loops it asserting each column heading is served.
- Modal log allowlist regex :81 ^(.+)\.(developer|reviewer|live-tester)$ - merger logs are not viewable in the detail card.

Changes:
1. WORKING gains "merging" (spinner while a merge is in progress); to-merge stays spinner-free (nothing runs while queued for the merger).
2. Accent classes .c-to-merge and .c-merging in pipeline order, visually consistent with the existing accents in both themes.
3. Tests: extend src/webui.test.ts STATE_NAMES to the 10 states; the column-heading loop asserts to-merge and merging served; assert the spinner for merging. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- 10 columns in pipeline order; merging shows the spinner; accents in both themes.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- The allowlist-regex slice (merger logs viewable) moved to task #88, which rewrites the same serve region and lands first; this task keeps only the states/WORKING/accent work.
- HOLD behind 000078 (the column-heading test loop needs the states to exist), behind 000088 (same serve region, one webui rewrite at a time), and behind the webui queue 000047 (reviewing, high), 000077 (high), 000076 (doing, medium).

# Notes

- #47 (landed) already did part of this task: src/webui.test.ts STATE_NAMES holds the 10 states, the column-heading loop asserts to-merge and merging, and pairLayout/LAYOUT render the four pairs in pipeline order. This task kept the states/WORKING/accent slice only.
- Spinner: spinnerHtml now includes "merging". The older WORKING constant no longer exists (the client ships spinnerHtml as source), so the change is in that function. to-merge stays spinner-free.
- Accents: .c-to-merge { --ac: #d946ef; } (fuchsia 500) and .c-merging { --ac: #c026d3; } (fuchsia 600) after .c-live-testing and before .c-done. They match the existing Tailwind light-shade/dark-shade pair pattern and sit in the shared style block, so both themes use them. The stale #47 CSS comment ("six middle columns ... three pairs") now says "the middle columns stack as pairs".
- Tests added to src/webui.test.ts: merging carries the spinner and to-merge does not; one --ac per state declared in pipeline order with 10 distinct colors.
- Checks: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass. Independent headless Chromium check (temp root, startWebUi port 0, no daemon): 10 columns in pipeline order, the merging card has .spin and the to-merge card has none, and both accents compute to rgb(217,70,239) / rgb(192,38,211) in light and dark. The only console message is the documented single-project /api/projects 404.
- Merger logs in the detail card stay out per the Specs (task #88 owns the allowlist and serve region).
- Commit: 2e0bcb2.

- [2026-10-11 16:36] Review pass, one fix. Diff scope is correct: only src/webui.ts and src/webui.test.ts change, and the allowlist/serve region stays for #88. Verified against the Specs: spinnerHtml adds "merging" and keeps to-merge spinner-free, accents .c-to-merge #d946ef and .c-merging #c026d3 sit after .c-live-testing and before .c-done in the theme-independent style block, and they follow the existing 500/600 shade pair pattern. LAYOUT/pairLayout render the 10 columns in pipeline order. Tests: STATE_NAMES holds the 10 states, the heading loop asserts each state, and the new accent and spinner assertions pass. All three test files pass.
- Typecheck: no runnable command exists in this repo (no tsconfig, no package.json scripts, the tsc on PATH is the npm stub, per the b31fae3 skill rule), so the acceptance line cannot run as written. Ad hoc strict tsc (typescript 5.9.3 plus @types/node from a local checkout) gives the same 37 errors on the branch and on main, so this change adds no type error.
- Fix: src/webui.test.ts:116 still said "six middle states render as three .pair wrappers" while the assertion below expects four pairs. Corrected to the eight middle states and the four pairs (commit a503750).
- Observation, no fix: the spinner test covers doing, live-testing and merging, but not reviewing. The reviewing spinner is unchanged behavior from before, so no regression.
- No open questions.

- [2026-10-11 16:43] Second review pass, no fix. Re-read the diff main...HEAD (two commits, only src/webui.ts and src/webui.test.ts) and re-ran the full suite: kanban, orchestrator and webui tests pass. Re-ran an independent headless Chromium check on a temp root (startWebUi, port 0, a task in to-merge and a task in merging): the board renders the 10 columns in pipeline order, the merging card carries .spin, the to-merge card does not, and both accents compute to rgb(217,70,239) and rgb(192,38,211) in light and dark. The acceptance holds.
- The fix a503750 only corrects the stale pair comment. No other change was needed.
- Observation, no fix: the Specs hold behind #88, which is still in to-merge on the board. This diff does not touch the serve region or the log allowlist, so the two changes cannot conflict. Merger logs stay out of the detail card until #88 lands, as the Specs state.
- No open questions.

- [2026-10-11 16:48] Live test, no issues. Ran the worktree code like a user against the real main board (/home/phamba/repos/se-llm-team), which holds 5 to-merge tasks and 1 merging task. startWebUi on port 0, then headless Chromium (Google Chrome) loaded the page. Results: 10 columns in pipeline order (backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, to-merge, merging, done); the DOM layout is backlog, [to-do/doing], [to-review/reviewing], [to-live-test/live-testing], [to-merge/merging], done. The merging card (task #88) carries an animating .spin (animation spin 0.9s); the 5 to-merge cards carry none. Accents: .c-to-merge #d946ef and .c-merging #c026d3 in light and dark. Clicking a to-merge card opens the detail card (task #101). The only console error is the documented single-project /api/projects 404. Full suite green: kanban, orchestrator, webui. No open questions.

- [2026-10-11 16:5x] Merge, no conflicts. Step 1: merged main (bc9705f, 5 commits: #88 agent history and subagent logs, run-button binding fix, auto-schedule open-questions guard) into the branch with git merge main; git auto-merged src/webui.ts and src/webui.test.ts with no conflicts. Both sides kept their intent: the branch's spinnerHtml "merging", .c-to-merge/.c-merging accents and the 10-state STATE_NAMES sit alongside #88's agent history, agent-log endpoints and run-button fix, and the allowlist still rejects an unknown role and allows the merger handle. Full suite green in the worktree: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts. No fixes needed. Step 2: merged the branch into main in the project root; fast-forward, no conflicts. Main and the branch both sit at the merge commit b4914bf, the exact tree the suite passed against.

# Open questions
