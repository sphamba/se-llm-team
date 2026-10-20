# Development

## Package manager

pnpm is the package manager. `package.json` pins the version through the `packageManager` field. Corepack resolves and runs exactly that version:

```sh
corepack enable
corepack prepare pnpm@12.11.2 --activate
```

The project has no dependencies and no committed lockfile. pnpm writes a lockfile that git ignores. The checks run with `node` directly. See [Checks](#checks).

## Extension load path

The Developer, Reviewer, Merger, and Live-tester run in the task worktree. The Splitter runs at the project root. pi loads the extension from the global symlink `~/.pi/agent/extensions/se-llm-team/`, which resolves to the main checkout. A tool added on an unmerged branch is invisible to role agents until the branch merges. Until then, a Live-tester of a new tool checks it with fixtures and code inspection.

## Checks

```sh
npm test
npm run test:changed
```

`npm test` runs every suite: `index.test.ts`, `tests/*.test.ts`, and `tests/*/*.test.ts`.

Shared helpers live in `tests/helpers.ts`. The efficiency-analysis suites use `tests/efficiency-analysis/helpers.ts`. A suite also runs alone: `node tests/<area>/<file>.test.ts`.

`npm run test:changed` runs only the suites affected by the current changes. It maps the working tree changes and the branch commits against main to the test files. It runs everything when a changed path is not in the mapping. The orchestrator suite uses a fast delay profile, so the full check stays quick.

Sidecar files are gitignored. They live in `.kanban/.logs/`, `.kanban/.pids/`, and `.kanban/.orchestrator.lock`.
