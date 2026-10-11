---
name: "fix: kanban_set_worktree always errors - setWorktree is never imported in index.ts"
priority: "high"
state: "done"
worktree: ""
---

# Summary
The kanban_set_worktree tool always errors at runtime with ReferenceError "setWorktree is not defined" whenever called. index.ts calls setWorktree but never imports it from ./src/kanban.ts, so every call throws before any work happens. One-line import fix in index.ts.

# Specs
## Finding (from live test of #57 / 000057, unrelated to that change)

Every kanban_set_worktree call returns isError: true with ReferenceError "setWorktree is not defined".

## Root cause

- index.ts line 126 calls `setWorktree(ctx.cwd, task, params.worktree)`.
- The import list on index.ts line 8 is: createTask, getTask, kanbanDir, listAll, listTasks, setState, updateTask, STATES, type TaskState — `setWorktree` is missing.
- `setWorktree` is exported from src/kanban.ts and covered by existing unit tests in src/kanban.test.ts (which imports it directly), so only the tool wiring in index.ts is broken.

## Verified

- Pre-existing bug: the main checkout's index.ts has the identical missing import, so the tool has been broken on main too; unrelated to the #NN change that was just live-tested.
- Verified live via `pi -p` with the worktree extension: every kanban_set_worktree call returned isError: true with "setWorktree is not defined".

## Fix

- Add `setWorktree` to the import list on index.ts line 8 (one-line fix).

## Acceptance

- kanban_set_worktree sets the task's worktree attribute successfully at runtime.
- Typecheck and the test suite stay green.

# Notes
- [2026-10-11] Implemented in worktree commit 27dcef2: added `setWorktree` to the import list on index.ts line 8 (one-line fix, exactly as specified). Checks: node kanban.test.ts, orchestrator.test.ts, webui.test.ts all pass (no real tsc installed, as noted in task 000043). Runtime smoke test of the acceptance: temp root with a .kanban board, `pi -p` with this worktree's index.ts via -e, SE_LLM_TEAM_NO_WEBUI=1, kanban_set_worktree with file 000001_feat_smoke.md and worktree feat/smoke-thing. Result: `000001_feat_smoke.md (#1): worktree -> feat/smoke-thing`, frontmatter gained `worktree: "feat/smoke-thing"`, no ReferenceError. (First smoke attempt used --no-tools, which disables extension tools too; --no-builtin-tools keeps them.) Temp dir removed after the test.
- [2026-10-11] Live test of commit 27dcef2: PASS. Temp root with a .kanan board, `pi --no-extensions -e <worktree>/index.ts -p`, SE_LLM_TEAM_NO_WEBUI=1. Exercised the full flow like a user: kanban_set_worktree set worktree feat/smoke-thing (returned `000001_feat_smoke.md (#1): worktree -> feat/smoke-thing`), then cleared it with empty string (returned the tool with trailing empty value, frontmatter key removed), then set fix/my-branch again. Verified on disk: frontmatter gained `worktree: "fix/my-branch"`. No ReferenceError, no error results. No leftover board watcher artifacts in .kanban. Temp dir removed. No issues found.
- [2026-10-11] Review of commit 27dcef2: no fixes needed. Diff is exactly the one-line import fix as specified; setWorktree is exported from src/kanban.ts:227, called at index.ts:126, now imported on line 8. Checks re-run independently: src/kanban.test.ts, src/orchestrator.test.ts, src/webui.test.ts all pass, and `node --experimental-strip-types --check index.ts` parses clean. Independent live smoke test (temp root, `pi --no-extensions -e <worktree>/index.ts -p`, SE_LLM_TEAM_NO_WEBUI=1, kanban_set_worktree on 000001_feat_smoke.md): tool returned `000001_feat_smoke.md (#1): worktree -> feat/smoke-thing`, frontmatter gained `worktree: "feat/smoke-thing"`, no ReferenceError. Environment note: when the global extension ~/.pi/agent/extensions/se-llm-team/index.ts is also loaded, tool-name conflicts block the session, so the smoke test needs --no-extensions; this is a double-load artifact, not a code defect. No real tsc installed (task 000043 ceiling), node test runs used instead.
