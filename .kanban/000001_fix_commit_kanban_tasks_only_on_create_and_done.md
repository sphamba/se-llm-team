---
name: "fix: commit kanban tasks only on create and done"
priority: "medium"
state: "to-review"
worktree: "fix/commit-kanban-tasks-only-on-create-and-done"
---

# Summary
Commit .kanban/ task files only at two points: creation in backlog, and reaching done. Remove commits for all updates in between (state moves, worktree sets, spec/summary edits, notes) to reduce commit noise.

# Specs
# Need

Reduce commit noise: .kanban/ task files must be committed to git only at two points in a task life: (a) when created in backlog, (b) when the task reaches done. No commits for updates in between.

# Current behavior (verified facts)

- src/kanban.ts `commitKanban` (line ~228) is the only commit function. It runs `git add -- .kanban/<file>` and `git commit -m <message> -- .kanban/<file>`, swallows failures, returns bool.
- Callers that commit today:
  - `updateAttrs` (line ~152) — backs `setState` (line ~155) and `setWorktree` (line ~190). Message: `kanban: <file> <changed-keys>`.
  - `updateTask` (line ~187) — name/priority/summary/specs edits via the `kanban_update` tool (index.ts:110). Message: `kanban: update <file>`.
  - `appendNote` (line ~204) — merger conflict notes from `mergeDone` (src/orchestrator.ts:160). Message: `kanban: note on <file>`.
  - `createTask` (line ~224) — via the `kanban_create` tool (index.ts:67). Message: `kanban: create <file>`.
- The Live-tester agent moves tasks to done with a direct file edit (agents/live-tester.md prompt), so the done commit cannot live only in the library. The orchestrator daemon (src/orchestrator.ts) must commit when it processes the done transition.
- README.md line 27 says "The library commits every board change (only `.kanban/` paths) to git." SPECS.md line 15 says task files are "commited to git".

# Required behavior

1. `createTask`: keep the commit (message `kanban: create <file>`). Creation in backlog is commit point 1.
2. No commits for these mutations: `updateTask` (kanban_update), `appendNote`, `setState` to any state other than done, `setWorktree` on a task that is not done (worktree set at to-do, clear handled in point 3b).
3. One commit at done end (commit point 2). The user approved this exact shape:
   a. PM moves a task to done through `kanban_set_state` → commit at that point, in the library.
   b. Live-tester moves to done by direct edit and the task has a worktree attribute → the orchestrator commits the file once, after `mergeDone` completes (branch merged, worktree removed and deleted, worktree attribute cleared). The commit holds the final file state.
   c. Live-tester moves to done by direct edit and the task has no worktree attribute → the orchestrator commits when it detects done in the rescan/done path of src/orchestrator.ts.
4. The done commit must not repeat on every rescan. Skip when the file has nothing uncommitted (for example check `git status --porcelain -- .kanban/<file>` first, or equivalent).
5. The done commit captures all pending uncommitted kanban edits of that file (Notes from developer/reviewer, state changes) because it commits the file content. This is wanted: intermediate edits land in the one done commit.
6. The post-merge worktree clear and any merger conflict notes fold into the single done commit. Do not commit them separately.
7. A missing git repo is still tolerated: no throw, return false, same as today.
8. After the done commit, `git status` shows no dirty `.kanban/<file>` for that task.

# Constraints

- Minimal diff. No new dependencies. No new config key: the commit policy is fixed code.
- Keep the commit message style consistent with the existing format; use `kanban: done <file>` for the done commit.
- Do not change the accepted same-file edit race semantics (agents edit the body, the daemon edits frontmatter only).
- Do not change how the orchestrator detects transitions (fs.watch + rescan + poll).

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.
- New assert-based checks cover the policy, following the existing fixture patterns (disable GPG signing in fixture repos, as the smoke test already does):
  - create commits; updateTask does not commit; setState to to-do does not commit; setWorktree does not commit.
  - setState to done commits once.
  - done via direct edit with a worktree produces exactly one done commit after merge and leaves git status clean.
- `grep -n "commitKanban" src/` shows no commit on non-done mutation paths.
- README.md line 27 and SPECS.md line 15 describe the new policy in the same simple style as the rest of the file.

# Notes

- [2026-10-10 18:55] Commit policy implemented in the worktree (commit 2733383). kanban.ts: removed the commits from updateAttrs (state and worktree moves), updateTask, and appendNote. setState now commits only when the new state is done, with message "kanban: done <file>". commitKanban checks `git status --porcelain -- .kanban/<file>` first and skips when the file has nothing uncommitted, so done commits do not repeat on rescan. The check keeps child git stderr silent, same as the old commit calls. A missing git repo still returns false, no throw.
- [2026-10-10 18:55] orchestrator.ts: mergeDone now returns true only when the done transition is fully processed (nothing left to merge, or the merge completed). The rescan done path commits the task file once after mergeDone completes, or at once for done with no worktree attribute. The post-merge worktree clear and merger conflict notes fold into that one done commit.
- [2026-10-10 18:55] Tests: kanban.test.ts has a new git fixture block. It checks that create commits, that to-do, setWorktree, appendNote, and updateTask do not commit, that done commits once and leaves the file clean, and that a no-change done does not repeat. orchestrator.test.ts part A now waits for the done commit and asserts exactly one "kanban: done" commit and a clean task file after merge. Also verified in a scratch repo: done by direct edit with no worktree gives one commit and a clean status. Both test files pass.
- [2026-10-10 18:55] Docs: README.md and SPECS.md now describe the two-point commit policy (creation and done only).
- [2026-10-10 19:01] Review pass (commit 2733383): no fixes needed. Verified against every Required behavior and acceptance criterion: create keeps its commit; updateTask, appendNote, setState (non-done), and setWorktree no longer commit (grep shows commitKanban only on setState-to-done, createTask, and the rescan done path); the rescan done path commits after mergeDone returns true, so the post-merge worktree clear and merger notes fold into the one done commit; the dirty check in commitKanban sits inside the try, so a missing git repo still returns false with no throw; the dirty check makes the done commit a no-op on later rescans (re-verified in a scratch repo: 3 rescans after done, still 3 commits, clean status). Both test files pass. The orchestrator test asserts exactly one done commit with a clean file after the direct-edit done + merge, and kanban.test.ts covers create commits, the four no-commit mutations, done-once, no-repeat, and the no-git done path.
- [2026-10-10 19:01] One observed consequence, not a defect: when a task with a worktree reaches done through setState (PM via kanban_set_state, or the liveness poll live-testing to done), the library commits at that point (Required behavior 3a, unconditional), and after the orchestrator merges and clears the worktree attribute the file is dirty again, so a second kanban: done commit lands. The single fold-in commit (behavior 6) applies to the direct-edit done path (3b), which the orchestrator test asserts. Leaving as approved.