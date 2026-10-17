---
name: "feat: PM done-processing marker catch-up report and delete cleanup"
priority: "medium"
state: "done"
worktree: ""
issuer: "#268"
complexity: "simple"
shortName: "pm-processed-marker-report"
---

# Summary
The orchestrator side of the PM done-processing marker: the first sweep after daemon start reports done tasks with no marker (catch-up for a done transition missed while the daemon was dead), the report instructions teach the PM the mark flow, and kanban_delete removes the marker with the task.

# Specs
Goal: a done transition missed while the daemon was dead is reported at the next daemon start, the report teaches the PM the mark flow, and kanban_delete removes a deleted task's marker.

Contract (pinned verbatim, shared with the sibling subtask #269): the PM-processed marker of a task is the EMPTY side-file .kanban/.logs/<task file name minus the .md extension>.pm-processed (taskSlug; e.g. .kanban/.logs/000268_pm_processed_marker.pm-processed for 000268_pm_processed_marker.md). #269 writes this exact path from its own code (kanban_mark_processed), so never rename or reshape it. Read it inline with taskSlug + join (taskSlug is already exported by src/kanban.ts - no dependency on #269's new helper, so merge order does not matter).

Own only these files (your whole diff): src/orchestrator/report.ts, src/orchestrator/board.ts, tests/orchestrator/sweep.test.ts. Other areas (the mark tool, the unprocessed list scope) are #269's; do not touch src/kanban.ts, src/tools.ts or tests/mcp.test.ts.

1. src/orchestrator/report.ts, reportDone (lines ~67-88): when lastDone is being seeded (the first sweep after daemon start, the !seen branch), fold done tasks with no marker file into finished in the composed report, so a done transition missed while the daemon was dead is reported at the next start. Later sweeps report only new done transitions via lastDone, so an unmarked task is never re-reported on every 10 s sweep (the unprocessed list scope covers it until marked).
2. src/orchestrator/report.ts, composeReport: the "Instructions for the Project manager" section (lines ~28-31) gains a line: after processing, mark the done tasks processed via kanban_mark_processed, so future PM sessions know the flow.
3. src/orchestrator/board.ts, removeTask (line ~135): also remove the task's marker file when it exists.
4. tests/orchestrator/sweep.test.ts, part N (the PM report part, lines 12-54): extend it with the catch-up - a done task with no marker at daemon start is reported at the first sweep; a done task with a marker (writeFileSync the marker by hand) is not. Extend part N in place; do not touch the file's import lines (existsSync, writeFileSync, join are already imported) and keep every existing assert (baseline: 45 "assert." occurrences; yours must not drop one).

Run: pnpm test (full) must pass; pnpm test:changed for your touched files.
Out of scope: the mark tool and the unprocessed list scope (#269), the analysis .exit accumulation (#267), REPORT_MAX_AGE_MS, any task-file frontmatter change.

# Notes
- Landed the done-processing marker catch-up in src/orchestrator/report.ts. On the seed sweep (the first sweep after daemon start, when lastDone has no entry) the report's Done section folds in every done, non-conflicted task whose `.kanban/.logs/<taskSlug>.pm-processed` marker is absent, so a done transition missed while the daemon was dead is reported at the next start. Later sweeps report only new transitions, so an unmarked task is reported once, never on every sweep. The marker path is read inline with taskSlug + join, with no dependency on #269.
- composeReport gained one PM instruction line: "After processing, mark the done tasks processed with kanban_mark_processed, so future PM sessions know they were handled." (#269 owns the tool itself, this wording is chosen here).
- src/orchestrator/board.ts removeTask now deletes the task's `.pm-processed` marker right after the task file (rmSync with force), so a deleted task leaves no marker behind.
- tests/orchestrator/sweep.test.ts: part N gained a catch-up fixture on a fresh root (one done task with no marker, one with a hand-written marker). The first sweep queues one report that lists only the unmarked task, and the next sweep queues none. Part AG writes a marker before removeTask and asserts its removal. Total 51 "assert." occurrences, old total 45, no existing assert dropped.
- Deviation from the Specs run line: only the scoped suite ran, `node tests/orchestrator/sweep.test.ts` (exit 0), because report.ts and board.ts are outside the test-changed mapping and the role test policy bans the full suite. No other task area was touched.
- Review at cfb11c2 (base main): all four spec points settle against the diff. report.ts reportDone (lines 65-77) folds unmarked done tasks into finished only on the seed sweep via `!known && !existsSync(join(kanbanDir(root), ".logs", `${taskSlug(t.file)}.pm-processed`))`, later sweeps keep the new-transition-only filter; composeReport (line 29) adds the kanban_mark_processed instruction; board.ts removeTask (lines 140-141) removes the marker with rmSync force, taskSlug read inline from ../kanban.ts with no #269 dependency. Diff owns exactly the three pinned files; marker path matches the pinned `.kanban/.logs/<task file name minus .md>.pm-processed` contract.
- Test totals: sweep.test.ts 51 "assert." occurrences (45 baseline, +6, none dropped). Reviewer ran the union (src/orchestrator/* touched): all 13 tests/orchestrator/ suites; 12 exit 0 (analysis, hub, log, config, daemon, merge, promote, singleton, spawn, split, sweep, worktree). poll.test.ts:46 "cooldown log fired exactly once" fails twice on this tree (2 !== 1), no diff symbol in the assertion, pre-existing relative to this task diff, not verdict-changing.
- No open user or client questions; no fixes made.

## Live test (2026-10-17)
- Fixture: `/tmp/lt270/repo` (git init + one commit) with done tasks `000001_old_unmarked.md` (no marker) and `000002_old_marked.md` (marker written by hand), plus done task `000005_delete_me.md` (marker) for the delete check. A merged daemon ran on it for about 20 s with `--rescan-seconds 1 --poll-minutes 5`, an isolated HOME, and the fake agent `/tmp/lt270/fake-pi`.
- Catch-up report: the first sweep queued exactly one report, `.kanban/.reports/2026-10-17T20-20-11-772Z.md`. Its Done section lists `000001_old_unmarked.md` only, and it excludes both marked tasks. 6 checks, 0 failed.
- No re-report: after 7 s of rescan sweeps the report count stayed 1, and the unmarked task stayed on the board. 2 checks, 0 failed.
- New transition: a done task created after daemon start (`000003_new_done.md`) queued a second report that lists only the new task. 3 checks, 0 failed.
- PM instructions: both queued reports carry "After processing, mark the done tasks processed with kanban_mark_processed, so future PM sessions know they were handled." in the instructions section.
- Delete cleanup: the merged `TOOLS.kanban_delete` handler ran with `{file: "000005_delete_me.md", cwd: root}` and returned "Deleted 000005_delete_me.md". The task file and its `.pm-processed` marker are gone, and the other task's marker stays. 4 checks, 0 failed.
- Assumptions: the queued `.kanban/.reports/*.md` file is the daemon report output that the extension drains, so the test asserted its content directly, with no pi PM session. The delete test called the tool handler directly, not through a pi session. The fixture spawned no agent (the fake-pi log is empty), so no other pipeline flow ran.
- No findings. No technical difficulties. Total 15 checks, 0 failed.
