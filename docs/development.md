# Development

## Package manager

pnpm is the package manager, pinned in `package.json` through the `packageManager` field. Corepack resolves and runs exactly that version:

```sh
corepack enable
corepack prepare pnpm@12.11.2 --activate
```

There are no dependencies and no committed lockfile (pnpm writes an env lockfile that is gitignored). The checks still run with `node` directly, see [Checks](#checks).

## Extension load path

Role agents run in the task worktree, but pi loads the extension from the global symlink `~/.pi/agent/extensions/se-llm-team/`, which resolves to the main checkout. Tools added on an unmerged branch are invisible to role agents until the branch merges. Until then, a Live-tester of a new tool verifies it with fixtures and code inspection instead of invoking the tool.

## Checks

```sh
npm test
npm run test:changed
```

`npm test` runs every suite in the glob loop over `index.test.ts`, `tests/*.test.ts` and `tests/*/*.test.ts`:

```sh
index.test.ts
tests/extension.test.ts
tests/plugin.test.ts
tests/mcp.test.ts
tests/context-symlinks.test.ts
tests/kanban/*.test.ts
tests/orchestrator/*.test.ts
tests/webui/*.test.ts
tests/efficiency-analysis/*.test.ts
```

Shared helpers live in `tests/helpers.ts`, per-area helpers in their area dir. Any suite also runs standalone: `node tests/<area>/<file>.test.ts`.

`npm run test:changed` runs only the suites that the current modifications affect. It maps the working tree changes and the branch commits against main to the test files, and runs everything when a changed path is not in the mapping. The orchestrator suite runs its daemons with a fast delay profile (600 ms poll, 1 s rescan, faked cooldowns and hub timers), so the full check stays quick.

Sidecar files (`.kanban/.logs/`, `.kanban/.pids/`, `.kanban/.orchestrator.lock`) are gitignored.
