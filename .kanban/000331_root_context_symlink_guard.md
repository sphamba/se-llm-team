---
name: "fix: the root context symlink never replaces a real file"
priority: "medium"
state: "reviewing"
worktree: "fix/331-root-context-symlink-guard"
issuer: "user"
complexity: "simple"
shortName: "root-context-symlink-guard"
---

# Summary
The root guard in ensureContextSymlinks is raw string equality, and repointContextSymlink deletes a real file with no restore path. Compare resolved paths, and refuse to replace a real AGENTS.md or SPECS.md at the root checkout. Add the missing regression test, which no task has ever covered.

# Specs
## Need

`ensureContextSymlinks` (`src/orchestrator/spawn.ts:53-65`) repoints `<cwd>/SPECS.md` at every spawn, then returns early on `if (cwd === root)` before it repoints `<cwd>/AGENTS.md`. The root is where the splitter and the integration-tester run, and a role-notes symlink there would shadow the project's own `AGENTS.md` and poison the `projectAgentsPrompt` read of every later spawn.

Two defects make that guard unsafe:

1. The comparison is raw string equality. A caller that passes `root + "/"`, or a symlinked spelling of the root, falls through to the destructive branch.
2. `repointContextSymlink` (`spawn.ts:104-124`) does `rmSync` and then `symlinkSync`. It refuses only a directory. A real file is deleted and nothing restores it: `clearContextSymlinks` restores nothing, and `stripContextSymlinks` (`pipeline.ts:199-212`) only removes entries that `git ls-tree HEAD` reports as mode `120000`. `AGENTS.md` and `SPECS.md` are both in `.gitignore`, so a deleted real file is unrecoverable.

Today no `AGENTS.md` exists at this repo's root, so the defect is latent, not live. The user decided: close it with a resolved-path comparison and a refusal at the root. Do not add a backup file.

## Specs

1. Add a helper in `src/orchestrator/spawn.ts`, next to `isRealFile`:
   ```ts
   function realpathOrSelf(path: string): string {
   	try {
   		return realpathSync(path);
   	} catch {
   		return path;
   	}
   }
   ```
   Add `realpathSync` to the existing `node:fs` import on line 2. `dirname` is already imported on line 3.

2. `ensureContextSymlinks`: replace `if (cwd === root) return;` with `if (realpathOrSelf(cwd) === realpathOrSelf(root)) return;`. Keep both surrounding comments verbatim.

3. `repointContextSymlink`: after the existing directory refusal and before `rmSync`, add:
   ```ts
   if (isRealFile(link) && realpathOrSelf(dirname(link)) === realpathOrSelf(root)) {
   	log(root, `refusing to replace the real file ${link} at the project root`);
   	return;
   }
   ```
   Do not change the rest of the function: the `readlinkSync` idempotence check, the directory refusal, the `rmSync`, and the `symlinkSync` stay as they are. This refusal must fire for both names at the root.

4. The worktree flow must keep working unchanged: when `cwd` is `.worktrees/<branch>`, `dirname(link)` is not the root, so no refusal fires, and the existing `update-index --skip-worktree` plus replace path stays in force.

5. Add a regression part to `tests/orchestrator/spawn.test.ts`, after the existing part AZ (the splitter root guard, around line 518-585). Name it `// --- part BA: a real file at the project root is never replaced by a context symlink ---`. Use a fixture whose root holds a real `AGENTS.md` (`# project guidance`) and a real `SPECS.md` (`# my real specs`), task file name `000313_root_specs_pointer.md`, role `integration-tester`. Assert these cases:
   - cwd `root + "/"` (a trailing slash): both files are still regular files, content unchanged.
   - cwd is a symlink alias that points at the root (create it with `symlinkSync(root, alias)`): same result. This is the case that raw string equality misses.
   - cwd is the plain `root`: same result.
   - cwd is a real subdirectory `<root>/.worktrees/feat-x`: both names become symlinks, so the guard does not leak into the worktree flow.
   - One line in `.kanban/.logs/orchestrator.log` per refusal, containing `refusing to replace the real file`.
   Beware: `join(root, ".")` is not a divergent spelling, `join` normalizes it. Use the symlink alias for that case.

6. Do not change `clearContextSymlinks`, `ensureInfoExclude`, `cleanContextPaths`, or `stripContextSymlinks`. Another task owns the root `SPECS.md` cleanup.

7. If an existing assertion in `tests/orchestrator/spawn.test.ts` breaks because the root `SPECS.md` is no longer replaced by a symlink in that part's fixture, fix the fixture rather than weaken the new assertions.

## Acceptance

Run from the task worktree. Every command must exit 0.

1. `node tests/orchestrator/spawn.test.ts`. Part BA must appear in the output.
2. `node tests/context-symlinks.test.ts`, the worktree and merge context-symlink coverage.
3. `node tests/orchestrator/merge.test.ts`, the merge lane that consumes these symlinks.
4. Manual repro on a scratch root holding a real `AGENTS.md`: `sha256sum` before and after a `node -e` call of `ensureContextSymlinks` with a trailing-slash cwd must be identical.
5. `! grep -q "cwd === root" src/orchestrator/spawn.ts`
6. `grep -q "if (realpathOrSelf(cwd) === realpathOrSelf(root)) return;" src/orchestrator/spawn.ts`
7. `grep -q "refusing to replace the real file" src/orchestrator/spawn.ts`

# Notes
## What changed
- `src/orchestrator/spawn.ts`: new `realpathOrSelf` helper next to `isRealFile`; `realpathSync` added to the `node:fs` import. The root guard in `ensureContextSymlinks` now compares resolved paths, so `root + "/"` and a symlink alias of the root take the early return. `repointContextSymlink` refuses a real file whose `dirname` resolves to the project root, with one `refusing to replace the real file ... at the project root` log line. Both surrounding comments stayed verbatim, and the `readlinkSync` check, directory refusal, `rmSync` and `symlinkSync` are unchanged.
- `src/orchestrator/spawn.ts`: `spawnAgent` computes `rootCwd` from the same resolved comparison and uses it for `piPrompt` and `renderPrompt`. The two remaining raw `cwd === root` expressions were the same defect class: a trailing-slash or alias cwd would have skipped the #313 root-cwd prompt and appended the project `AGENTS.md` as a second system prompt. Acceptance 5 (`! grep -q "cwd === root"`) cannot hold without this. Behavior is identical for every existing caller, since a real root cwd resolves equal.
- `tests/orchestrator/spawn.test.ts`: part BA (after part AZ), `ensureContextSymlinks` imported. Fixture holds a real `AGENTS.md` (`# project guidance`) and a real `SPECS.md` (`# my real specs`), task file `000313_root_specs_pointer.md`, role `integration-tester`. Cases: trailing-slash root, `symlinkSync(root, alias)` alias, plain root (both files stay regular files, content unchanged), real `<root>/.worktrees/feat-x` (both names become symlinks, so the worktree flow does not leak), and three refusal lines in `.kanban/.logs/orchestrator.log` naming the real root `SPECS.md`.

## Acceptance
1. `node tests/orchestrator/spawn.test.ts` - RED AT BASE, pre-existing. Fails at the part A wait `timeout waiting for the integration task runs to done and folds into the mirror`, before part BA runs. Proven read-only with `git archive 2273595 | tar -x -C /tmp/baseBA` and the same suite there: same wait, same timeout, exit 1. HEAD and main were both `2273595` before my first edit. Part BA was never reached, so I did not retry the suite.
2. `node tests/context-symlinks.test.ts` - exit 0, 6 parts passed.
3. `node tests/orchestrator/merge.test.ts` - exit 0, 5 parts passed.
4. Manual repro on a scratch git root with a real `AGENTS.md`: `sha256sum` before and after a `node -e` call of `ensureContextSymlinks(root, root + "/", ...)` is identical for both files, and the run wrote exactly one refusal line.
5. `! grep -q "cwd === root" src/orchestrator/spawn.ts` - exit 0.
6. `grep -q "if (realpathOrSelf(cwd) === realpathOrSelf(root)) return;" src/orchestrator/spawn.ts` - exit 0.
7. `grep -q "refusing to replace the real file" src/orchestrator/spawn.ts` - exit 0.

## Red-first proof of part BA
Part A blocks the suite before part BA, so I proved the pin with the identical block in a throwaway `tests/_scratch.test.ts` (direct `ensureContextSymlinks` calls, no daemon). Before the source edit it failed with `AssertionError: the real root AGENTS.md survives the trailing-slash cwd`. After the edit it passed. The scratch file is deleted. The shipped pin is part BA in `tests/orchestrator/spawn.test.ts`.

## Notes
- `tests/orchestrator/spawn.test.ts` part A is red at `2273595` on this machine, independent of this diff. Both shas `2273595`, pre-existing wait: `timeout waiting for the integration task runs to done and folds into the mirror` (the daemon log stops after `queued board report`, so the `kanban: done ...` mirror commit and the worktree removal never land inside the 60 s window). A new task owns it.
- Not added, per the Specs: no backup file, no restore path, and no change to `clearContextSymlinks`, `ensureInfoExclude`, `cleanContextPaths` or `stripContextSymlinks`.
- Existing part AZ assertion `the splitter cwd still links the task file` still holds, so no fixture change was needed: at a fresh root the `SPECS.md` link is missing, not a real file, so the new refusal does not fire.

# Open questions
- `spawnAgent`'s two other `cwd === root` expressions are now a single resolved `rootCwd`. Confirm that this generalization belongs to this task. Acceptance 5 cannot exit 0 without it.
