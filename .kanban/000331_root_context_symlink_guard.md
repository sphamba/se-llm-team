---
name: "fix: the root context symlink never replaces a real file"
priority: "medium"
state: "backlog"
worktree: ""
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

1. The comparison is raw string equality. A caller that passes `root + "/"`, `join(root, ".")`, or a symlinked spelling of the root falls through to the destructive branch.
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

5. Add a regression part to `tests/orchestrator/spawn.test.ts`, after the existing part AZ (the splitter root guard, around line 518-585). Name it `// --- part BA: a real file at the project root is never replaced by a context symlink ---`. Cover all of these:
   - A fixture whose root holds a real `AGENTS.md` (`# project guidance`) and a real `SPECS.md` (`# my real specs`).
   - `ensureContextSymlinks(root, root + "/", "000313_root_specs_pointer.md", "integration-tester")`: both files are still regular files and their content is unchanged.
   - The same call with `join(root, ".")` as the cwd: the same result.
   - The same call with the plain `root` as the cwd: the same result.
   - A real subdirectory cwd (`.worktrees/feat-x`): both names become symlinks, so the guard does not leak into the worktree flow.
   - One log line per refusal in `.kanban/.logs/orchestrator.log`, naming `refusing to replace the real file`.

6. Do not change `clearContextSymlinks`, `ensureInfoExclude`, `cleanContextPaths`, or `stripContextSymlinks`. Another task owns the root `SPECS.md` cleanup.

7. If any existing assertion in `tests/orchestrator/spawn.test.ts` breaks because the root `SPECS.md` is no longer replaced by a symlink in that part's fixture, fix the fixture rather than weakening the new assertions.

## Acceptance

Run from the task worktree. Every command must exit 0.

1. `node tests/orchestrator/spawn.test.ts`. Part BA must be in the output.
2. `node tests/context-symlinks.test.ts`, the worktree and merge context-symlink coverage.
3. `node tests/orchestrator/merge.test.ts`, the merge lane that consumes these symlinks.
4. Manual repro of the old defect, with the guard removed in a scratch copy only if you need to see it fail: `node -e` calling `ensureContextSymlinks` with a trailing-slash root must leave a real `AGENTS.md` byte-identical (`sha256sum` before and after).
5. `grep -n "cwd === root" src/orchestrator/spawn.ts` returns nothing, and `grep -c "realpathOrSelf" src/orchestrator/spawn.ts` is 4

# Notes
