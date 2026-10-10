# se-llm-team

A pi coding agent extension. One skill, `/skill:se-llm-team`, turns the session into the Project manager and starts an orchestrator daemon that runs a kanban pipeline of headless coding agents.

## Setup

1. The repo is symlinked to `~/.pi/agent/extensions/se-llm-team/`. pi loads `index.ts` from it. No build step.
2. Publish the skill with a symlink (settings `skills` entries only toggle discovered resources, they do not add paths):

```sh
ln -s /path/to/se-llm-team/skills/se-llm-team ~/.pi/agent/skills/se-llm-team
```

3. Optional config in `~/.pi/agent/se-llm-team.json` (a `.kanban/se-llm-team.json` in the project overrides it):

```json
{ "agent": "pi", "pollMinutes": 15 }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `agent` | `pi` | Executable the orchestrator spawns for agents. |
| `pollMinutes` | `15` | Agent liveness poll interval. |

## Kanban board

`.kanban/` in the project repo holds one markdown file per task, named `000001_feat_nice_thing.md`. Flat YAML frontmatter (name, priority, state, worktree) plus # Summary, # Specs, # Notes sections. The library writes files only; the orchestrator daemon is the sole git committer for `.kanban/` paths, at two points only: creation in backlog, and done. Edits in between stay uncommitted and land in the one done commit.

States: backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, done.

## Orchestrator

`src/orchestrator.ts` is a non-LLM daemon. Start it with the `orchestrator_start` tool (or `node src/orchestrator.ts --root <project>`). One daemon per project: the lockfile is `.kanban/.orchestrator.lock`.

- Watches `.kanban/` (fs.watch) and rescans every 10 s. The `orchestrator_poke` tool touches `.kanban/.poke` for an immediate scan and agent scheduling.
- to-do: creates `.worktrees/<slug>` from the task name, sets the worktree attribute, spawns a Developer, moves to doing. Unlimited lanes; the PM throttles by how many tasks it promotes to to-do.
- to-review: spawns a Reviewer, moves to reviewing.
- to-live-test: spawns a Live-tester, moves to live-testing.
- Liveness poll: an agent dead without a state update moves the task on (a dead Developer goes back to to-do for a fresh run, reviewing to to-review, live-testing to done). Capped at 5 respawns per task.
- done with a worktree: merges the branch into the main checkout, removes the worktree, deletes the branch, then commits the task file (the done commit). On conflict, spawns a Merger agent, capped at 3 attempts. done without a worktree: the orchestrator commits the task file at the next rescan. The done commit is skipped when the file has nothing uncommitted.

## Agents

Agent prompts live in `agents/`. The orchestrator runs each agent as a headless `<executable> --approve -p <prompt>` process, with the task worktree as cwd and the task file path in the prompt. The orchestrator reads the role prompt from `agents/` in its own checkout at each spawn. A prompt fix on a task worktree branch applies only after that branch merges, so do not rely on a prompt change before the merge. Agents update their own task file directly (notes and state attribute). The Live-tester reports issues to a Project manager subagent that creates new tasks.

## Tools

The PM session gets: kanban_list, kanban_get, kanban_create, kanban_update, kanban_set_state, kanban_set_worktree, orchestrator_start, orchestrator_status, orchestrator_stop, orchestrator_poke. The extension also notifies the session when a task reaches done.

## Checks

```sh
node src/kanban.test.ts
```

Sidecar files (`.kanban/.logs/`, `.kanban/.pids/`, `.kanban/.orchestrator.lock`) are gitignored.
