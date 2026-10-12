# se-llm-team

A pi coding agent extension. One skill, `/skill:se-llm-team`, turns the session into the Project manager and starts an orchestrator daemon that runs a kanban pipeline of headless coding agents.

## Setup

Install as a pi package from git:

```sh
pi install git:github.com/sphamba/se-llm-team
```

The https URL form works too: `pi install https://github.com/sphamba/se-llm-team`. The package provides the kanban/orchestrator tools, the `/skill:se-llm-team` skill, and the agent prompts. Node >= 24 is required: the orchestrator daemon runs the `.ts` sources directly through node's type stripping, so there is no build step.

Local development alternative: symlink the repo to `~/.pi/agent/extensions/se-llm-team/`. pi loads `index.ts` from it. No build step. Publish the skill with a second symlink (settings `skills` entries only toggle discovered resources, they do not add paths):

```sh
ln -s /path/to/se-llm-team/skills/se-llm-team ~/.pi/agent/skills/se-llm-team
```

3. Optional config in `~/.pi/agent/se-llm-team.json` (a `.kanban/se-llm-team.json` in the project overrides it):

```json
{
  "agent": "pi",
  "pollMinutes": 1,
  "model": "anthropic/claude-sonnet-4-5",
  "thinking": "high",
  "roles": { "developer": { "thinking": "xhigh", "complex": { "model": "big-model" } } },
  "reviewerCap": { "simple": 1, "moderate": 2, "complex": 3, "trivial": 0 },
  "webUi": { "enabled": true, "host": "localhost", "port": 4242 }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `agent` | `pi` | Executable the orchestrator spawns for agents. |
| `pollMinutes` | `1` | Agent liveness poll interval. |
| `autoScheduleMinutes` | `5` | Idle cooldown for retry paths only: a merger requeued by a failed merge, and a respawn past the 5-death cap, wait this many minutes before the agent spawns again. Backlog promotion does not use it: promotion is event-driven and immediate. |
| `logStallMinutes` | `5` | A working agent whose log size stays unchanged for this many minutes is assumed dead: the task bounces one state back, the agent process is killed, and the respawn machinery takes over. An invalid value (non-number or <= 0) warns and keeps the default. |
| `provider` | unset | LLM provider to pass as `--provider`. Requires `model`; a provider without a model is ignored with a warning. |
| `model` | unset | LLM model or pattern to pass as `--model`. A `:<thinking>` suffix in the pattern keeps working natively. |
| `thinking` | unset | Reasoning level to pass as `--thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. An unknown value is ignored with a warning. |
| `roles.<type>.<key>` | unset | Override `provider`, `model` or `thinking` for one agent type (`developer`, `reviewer`, `live-tester`, `merger`); per-field, so unset fields keep the global value. |
| `roles.<type>.<complexity>.<key>` | unset | Same fields nested under `simple`, `moderate`, `complex` or `trivial` inside a roles entry. Applies to tasks whose `complexity` attribute matches; per-field, so unset fields keep the role default and unset role fields keep the global value. |
| `reviewerCap.<complexity>` | `1`/`2`/`3`/`0` | Successful reviewer runs before a to-review task force-advances to to-merge, per task complexity: simple `1`, moderate `2`, complex `3`, trivial `0`. An invalid value (non-integer or < 0) warns and keeps the default. |
| `webUi.enabled` | off | Serve the web dashboard with the daemon. |
| `webUi.host` | `localhost` | Dashboard bind host. |
| `webUi.port` | `4242` | Dashboard port. |

## Package manager

pnpm is the package manager, pinned in `package.json` through the `packageManager` field. Corepack resolves and runs exactly that version:

```sh
corepack enable
corepack prepare pnpm@12.11.2 --activate
```

There are no dependencies and no committed lockfile (pnpm writes an env lockfile that is gitignored). The checks still run with `node` directly, see [Checks](#checks).

## Kanban board

`.kanban/` in the project repo holds one markdown file per task, named `000001_nice_thing.md` (zero-padded number, slug capped at 4 words with the type word dropped). Flat YAML frontmatter (name, priority, state, worktree, issuer, complexity) plus # Summary, # Specs, # Notes sections. The complexity attribute (`simple`, `moderate`, `complex` or `trivial`) defaults to `moderate` and drives which per-complexity LLM config entry and reviewer-pass cap apply. The library writes files only; the orchestrator daemon is the sole git committer for `.kanban/` paths, at two points only: creation in backlog, and done. Edits in between stay uncommitted and land in the one done commit.

States: backlog, to-do, doing, to-review, reviewing, to-merge, merging, to-live-test, live-testing, done.

## Orchestrator

`src/orchestrator.ts` is a non-LLM daemon. Start it with the `orchestrator_start` tool (or `node src/orchestrator.ts --root <project>`). One daemon per project: the lockfile is `.kanban/.orchestrator.lock`.

- Watches `.kanban/` (fs.watch) and rescans every 10 s. The `orchestrator_poke` tool touches `.kanban/.poke` for an immediate scan and agent scheduling.
- backlog: promoted automatically, on every scan and poll: every backlog task whose blockedBy refs all point at satisfied blockers (done tasks, or tasks in the live test: to-live-test or live-testing), whose openQuestions section is empty and whose file has no conflict markers moves to to-do, all schedulable tasks at once (unchained tasks run as parallel lanes). When a blocker reaches done or enters the live test (to-live-test/live-testing), the daemon drops its ref from every task that listed it in the same scan or poll, so blockedBy always lists unsatisfied (to-merge/merging) blockers only.
- to-do: creates `.worktrees/<type>/<num>-<short-slug>` (e.g. feat/1-nice-thing) from the task, sets the worktree attribute, spawns a Developer, moves to doing. Unlimited lanes; the blockedBy chain serializes what must serialize.
- to-review: spawns a Reviewer, moves to reviewing. After `reviewerCap.<complexity>` successful reviewer runs (0 for trivial, 1 for simple, 2 for moderate, 3 for complex by default) the task force-advances to to-merge. A trivial task (cap 0) advances on the first sweep without spawning a reviewer.
- to-live-test: reached after the Merger merged. The daemon routes a task whose branch is not merged into the project root's current branch, or that has no worktree, back to to-merge first. Otherwise it spawns a Live-tester on the merged commit (the project root's checkout) and moves to live-testing.
- to-merge: spawns at most one Merger for the whole project (while the task's own agent is still alive the spawn waits), moves to merging. Only after the task sat idle in to-merge for `autoScheduleMinutes` does a merger requeued by a failed merge get a retry.
- merging: the Merger resolves the project root's current branch at the start of each merge, merges it into the task worktree, resolves conflicts and runs the tests there only when it had to resolve conflicts, then merges the branch into the project root's current branch from the root checkout and sets to-live-test (the Live-tester sets done). A detached root checkout refuses the merge with a Note. When the merge cannot be completed it sets the task back to to-merge and aborts any merge left dirty in the root or the worktree, so the root checkout never sits mid-merge.
- Liveness poll: an agent dead without a state update moves the task on (a dead Developer goes back to to-do for a fresh run, reviewing to to-review, live-testing to to-live-test, merging to to-merge). Capped at 5 respawns per task.
- done with a worktree: the Merger merged the branch before the live test set done, so the orchestrator removes the worktree, deletes the merged branch and commits the task file (the done commit). done without a worktree: the orchestrator commits the task file at the next rescan. The done commit is skipped when the file has nothing uncommitted.
- A task file with unresolved merge conflict markers is left untouched: the daemon spawns no agents, rewrites no attribute, and commits nothing for it until the merger or the user resolves the conflict.

### Board mirror to origin

Every mirror commit is best-effort pushed to `origin` as `refs/heads/meta/kanban` (only that ref; failures are logged, never fatal). The push needs SSH access to origin for the daemon user (a known_hosts entry and a deploy key); without it the mirror stays local and a fresh-clone bootstrap on another machine cannot work. After 3 consecutive failed pushes the daemon logs one warning (repeated only after a push succeeds again), visible in `.kanban/.logs/orchestrator.log`.

## Extension load path

Role agents run in the task worktree or at the project root, but pi loads the extension from the global symlink `~/.pi/agent/extensions/se-llm-team/`, which resolves to the main checkout. Tools added on an unmerged branch are invisible to role agents until the branch merges. Until then, a Live-tester of a new tool verifies it with fixtures and code inspection instead of invoking the tool.

## Web dashboard

With `webUi.enabled: true` in `~/.pi/agent/se-llm-team.json`, the orchestrator daemon serves a read-only dashboard at `http://<host>:<port>` (default `http://localhost:4242`): one column per task state, cards with a priority chip, and a popup with the full task (attributes and rendered body). The board is re-read on every request and the page refreshes itself every 5 s. A failed start (port taken) is logged and the pipeline continues. The page footer shows the serving hub's identity (`pid`, code checkout, `commit`), so a stale-code hub or a failover is visible at a glance; the same payload is at `GET /api/hub`.

Only daemons rooted at a main checkout can win the hub election and bind the port: a linked git worktree checkout can hold old code, so its daemon registers with the hub and never serves the ui. Candidacy is git topology (the per-worktree git dir differs from the common dir), not a path rule, so a worktree created anywhere (not just under `.worktrees/`) stands down. During a production restart the dashboard is briefly down instead of being served by old code. A daemon rooted in a task worktree exits itself when its task reaches `done` or is gone (checked at startup and on every sweep), so no stale worktree daemon lingers to hold the lock or contest the port.

## Agents

Agent prompts live in `agents/`. The orchestrator runs each agent as a headless `<executable> --approve --mode json [<llm flags>] -p <prompt>` process, with the task file path in the prompt, and the optional provider/model/thinking flags from the config. The Developer and the Reviewer run with the task worktree as cwd. The Merger and the Live-tester run at the project root. The agent log (`.kanban/.logs/`) carries the full JSONL event stream; the web ui renders it readably. The orchestrator reads the role prompt from `agents/` in its own checkout at each spawn. A prompt fix on a task worktree branch applies only after that branch merges, so do not rely on a prompt change before the merge. Agents update their own task file directly (notes and state attribute). The Live-tester reports issues to a Project manager subagent that creates new tasks.

## Tools

The PM session gets: kanban_list, kanban_get, kanban_create, kanban_update, kanban_set_state, kanban_set_worktree, kanban_delete, orchestrator_start, orchestrator_status, orchestrator_stop, orchestrator_poke. kanban_delete removes a mistaken task: it deletes the task file and commits a whole-board mirror snapshot in one operation, so the daemon cannot restore the task. Never delete a board file by hand. The daemon restores hand-deleted files from the mirror. The extension also notifies the session when a task reaches done.

## Checks

```sh
npm test
npm run test:changed
```

`npm test` runs all five suites:

```sh
node src/kanban.test.ts
node src/orchestrator.test.ts
node src/webui.test.ts
node src/extension.test.ts
node index.test.ts
```

`npm run test:changed` runs only the suites that the current modifications affect. It maps the working tree changes and the branch commits against main to the test files, and runs everything when a changed path is not in the mapping. The orchestrator suite runs its daemons with a fast delay profile (600 ms poll, 1 s rescan, faked cooldowns and hub timers), so the full check stays quick.

Sidecar files (`.kanban/.logs/`, `.kanban/.pids/`, `.kanban/.orchestrator.lock`) are gitignored.
