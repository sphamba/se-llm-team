---
name: "fix: quiet test-changed probes in degraded git repos"
priority: "low"
state: "doing"
worktree: "fix/150-quiet-test-changed-probes"
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
