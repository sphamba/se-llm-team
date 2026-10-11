---
name: "chore: configure the project to use pnpm"
priority: "critical"
state: "live-testing"
worktree: "chore/86-configure-the-project"
---

# Summary
Configure the se-llm-team project to use pnpm as its package manager: a corepack packageManager pin in package.json and pnpm usage documented in README.md.

# Specs
Configure the project to use pnpm (user request, critical priority).

Facts (verified on current main):
- package.json holds only { name, private: true, type: "module" }: no scripts, no dependencies, no packageManager field, no engines.
- pnpm is not installed on this machine; there is no lockfile and no .npmrc.
- README.md has no install or package-manager section at all.
- The suites run via node directly (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts); the repo ships no tsconfig or node_modules.
- Active lanes touch src/webui.ts(+test) (#39 reviewing, #47 doing), agents/*.md/kanban.ts/index.ts/SKILL.md (#74 reviewing) - package.json and README.md are free.

Changes:
1. package.json: add "packageManager": "pnpm@<version>" with the current latest stable pnpm version resolved from the npm registry at implementation time (the field is the corepack pin; corepack uses it to fetch and run exactly that pnpm).
2. package.json: add an "engines" entry for pnpm if it does not conflict with the corepack pin (developer's judgment; keep the diff minimal).
3. README.md: a short section documenting pnpm usage - corepack enables the pinned pnpm (corepack enable; corepack prepare), and the suites still run via node directly. Keep it minimal; no invented workflows.
4. Do not add dependencies, scripts, or lockfiles that nothing produces yet; do not run pnpm install into the repo.

Acceptance:
- package.json pins pnpm via packageManager with a real registry version.
- README.md documents how pnpm is selected and used.
- Typecheck and the full test suite pass: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Constraints:
- Files: package.json, README.md.
- package.json and README.md are untouched by every active lane, so this task is clean to run in parallel; a minor merge is still expected if other tasks grow.

# Notes

- Commit 56aad4a on chore/86-configure-the-project: `packageManager: "pnpm@12.11.2"` (npm `latest` at implementation time, resolved with `npm view pnpm version`) plus `engines.pnpm: ">=12.11.2"`, consistent with the pin. README.md has a new "Package manager" section (`corepack enable`, `corepack prepare pnpm@12.11.2 --activate`) noting there are no dependencies and that the checks still run via node.
- Verified `corepack pnpm --version` reports 12.11.2 in the worktree, so corepack resolves the pin. pnpm 12 writes an env lockfile (`pnpm-lock.yaml`, `packageManagerDependencies`) on any invocation because of the `packageManager` pin; it is untracked and was deleted, no lockfile is committed (per spec item 4).
- Ran node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts: all pass. The repo has no tsconfig and no real tsc (the global `tsc` is the npm placeholder), so typecheck is covered by Node 24 loading the TS sources directly.

Reviewer 2026-10-11: no fixes needed.
- Reviewed commit 56aad4a (`git diff main...HEAD`): only package.json and README.md change, matching the Constraints. No dependencies, scripts, or lockfile added.
- Pin verified against the registry independently: `npm view pnpm version` and `npm view pnpm dist-tags.latest` both return 12.11.2, so the pin is the current latest stable.
- Corepack verified in the worktree: `corepack pnpm --version` returns 12.11.2; `corepack prepare pnpm@12.11.2 --activate` exits 0 in an isolated COREPACK_HOME.
- All three suites re-run by the reviewer and pass: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.
- Worktree left clean; the pnpm-generated pnpm-lock.yaml created during review was removed.
- Observations, not fixed (out of scope): the README Checks section predates this task and lists only node src/kanban.test.ts, while the full suite has three files; any pnpm invocation generates the pnpm 12 env lockfile (packageManagerDependencies) as a side effect of the pin.
- Verdict: acceptance criteria met. No code change by the reviewer, state -> to-live-test.
