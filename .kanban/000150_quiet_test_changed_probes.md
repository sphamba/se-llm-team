---
name: "fix: quiet test-changed probes in degraded git repos"
priority: "low"
state: "done"
worktree: ""
issuer: "#149"
complexity: "simple"
shortName: "quiet-test-changed-probes"
blockedBy: ""
---

# Summary
The selective test runner still works when git state is degraded, but the git probes it wraps in try/catch leak the child processes' stderr to the user's console. Suppress stderr on those advisory probes so a degraded-git run prints only the runner's own messages, keeping the existing try/catch and fallback behavior.

# Specs
Found in the live test of #149 (otherwise passed: runner mappings, npm test / npm run test:changed wiring, exit-code propagation and the 600 ms daemon poll all verified). Low priority, cosmetic, reproduced repeatedly with real runs of `node scripts/test-changed.mjs`.

# Evidence

- Repo with no main branch (`git branch -m main trunk`) and src/webui.ts modified: prints `fatal: Not a valid object name main` before the correct `test-changed: 1 changed file(s) -> src/webui.test.ts`; exit 0.
- Repo with no commits at all (fresh `git init`) and untracked src/orchestrator.ts + src/webui.test.ts: prints `fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.` plus the git hint lines and `fatal: Not a valid object name main`; then still runs src/webui.test.ts and exits 0.
- Non-git directory holding only the runner: prints `fatal: not a git repository ...` twice and the entire `git diff` usage/help text; then prints `test-changed: no modifications, nothing to run`; exit 0.

# Cause and suggested minimal fix

The code path is changedPaths() in scripts/test-changed.mjs: the `tryAdd("git diff --name-only HEAD")` and `tryAdd("git merge-base main HEAD >/dev/null && git diff --name-only $(git merge-base main HEAD) HEAD")` calls swallow the error but not the child's stderr. The other advisory probes leak the same way (`git ls-files --others --exclude-standard`, and `git rev-parse --show-toplevel` in main()).

Minimal fix: suppress stderr on the advisory git probes with an execSync stdio option, e.g. `stdio: ["ignore", "pipe", "pipe"]`, keeping the existing try/catch and fallback behavior unchanged. Healthy-repo output must be byte-for-byte the same.

# Acceptance check

In each of the three degraded sandboxes above (repo without a main branch; repo with no commits; non-git directory holding only the runner), `node scripts/test-changed.mjs` prints only the runner's own `test-changed: ...` line(s) on stdout and stderr — no `fatal:`, git hint or usage text — and exits 0. A normal run in the repo still detects the same changed paths as before, and `node scripts/test-changed.test.mjs` still passes its mapping table.

# Informational follow-up candidate (out of scope here; not part of the acceptance above)

The live-tester recorded this as an observation rather than a defect, so it should not expand this task: scripts/test-changed.test.mjs (the 12-assertion mapping self-check added by #149) is not wired into `npm test` (five suites) and is not selected by the runner when scripts/test-changed.mjs itself changes (that path has no RULES entry, so mapToTests falls back to all five suites), leaving future mapping changes ungated. If that should be gated automatically later, either add a RULES entry for scripts/test-changed.mjs selecting scripts/test-changed.test.mjs or add the self-check to npm test.

# Notes

- Added `stdio: ["ignore", "pipe", "pipe"]` to the two `execSync` call sites in scripts/test-changed.mjs (the shared `add()` used by all four advisory probes, and the `git rev-parse --show-toplevel` chdir probe in main()). This covers every probe named in the spec; try/catch and fallback behavior unchanged. Commit 9eb7f40 in fix/150-quiet-test-changed-probes.
- Acceptance verified: sandbox A (branch renamed to trunk, src/webui.ts modified) and sandbox C (fresh git init, no commits, untracked files) each print only `test-changed: ...` lines plus the trivial suite output, exit 0; sandbox D (non-git directory) prints exactly `test-changed: no modifications, nothing to run`, exit 0. No `fatal:`, hint or usage text anywhere.
- Healthy-repo check: old runner (git show HEAD) vs new runner in a healthy sandbox with identical modifications produced byte-for-byte identical output. `node scripts/test-changed.test.mjs` passes its mapping table in the worktree.
- Review pass: independently reproduced all three degraded sandboxes with commit 9eb7f40. Old runner leaks (fatal: Not a valid object name main; fatal: ambiguous argument 'HEAD'; 4 fatal/usage lines in the non-git directory). New runner prints only its own test-changed lines, exit 0, no fatal, hint or usage text. Healthy-repo output with old and new runner is byte-for-byte identical, and node scripts/test-changed.test.mjs passes in the worktree. Both listed assumptions confirmed in the code: stdout stays piped so probe values are unchanged, and the catch blocks never read error.stderr. Diff touches only the two execSync call sites in scripts/test-changed.mjs. No fixes needed.

## Live test (2026-10-12)

Tested the runner through its real CLI interface in throwaway sandboxes under /tmp. Old runner is commit 9eb7f40^ (b5e07c0), new runner is commit 9eb7f40.

Assumption: the live test must not run the repo unit suites. Each sandbox therefore uses a trivial stub `*.test.ts` suite that prints one line and exits 0. The test checks the runner's selection message, stderr cleanliness and exit code, not the real suite contents. Each runner is committed in the sandbox base, so the runner file itself is not a changed path.

| Sandbox | Old runner stderr | New runner stderr | New exit |
|---|---|---|---|
| No main branch (renamed to trunk), src/webui.ts modified | `fatal: Not a valid object name main` | empty | 0 |
| Fresh git init, no commits, untracked src/orchestrator.ts + src/webui.test.ts | `fatal: ambiguous argument 'HEAD'` + git hint + `fatal: Not a valid object name main` | empty | 0 |
| Non-git directory holding only the runner | 2 x `fatal: not a git repository` + full `git diff` usage text | empty | 0 |
| Healthy repo, src/webui.ts modified + untracked src/orchestrator.ts | empty | empty | 0 |

- New runner stdout is byte-for-byte identical to old runner stdout in the healthy sandbox (both report `2 changed file(s) -> src/orchestrator.test.ts, src/webui.test.ts`). In the degraded sandboxes the stdout is also identical, and the new stderr is empty in all three.
- `npm run test:changed` in the no-main sandbox works, exit 0. Stderr holds only npm's own `npm notice run ...` lines, no git text.
- Failure propagation: a stub suite that exits 3 makes the runner exit 3. New stderr holds only `test-changed: src/webui.test.ts failed`. The old runner leaked `fatal: Not a valid object name main` before that line.
- Running from a subdirectory (cd src; node ../scripts/test-changed.mjs) works in a healthy repo and in the no-main repo. This exercises the `git rev-parse --show-toplevel` probe. Output matches the root run and stderr is empty.

No defects found. The acceptance check holds in all three degraded sandboxes and the healthy-repo output is unchanged. The informational follow-up in the Specs remains true (`scripts/test-changed.test.mjs` is not in `npm test`, and `scripts/test-changed.mjs` has no RULES entry). It stays out of scope, per the Specs.

# Open questions

None. Assumptions made:
- Suppressing stderr only (stdout stays piped) is enough; probe stdout values are unchanged so healthy-repo output is byte-for-byte identical.
- Discarding stderr captured in the execSync error object is fine, since the catch blocks never used it.
- The informational follow-up (RULES entry for scripts/test-changed.mjs, or wiring the mapping self-check into npm test) stays out of scope for this task.
