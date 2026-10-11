---
name: "chore: configure the project to use pnpm"
priority: "critical"
state: "backlog"
worktree: ""
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
