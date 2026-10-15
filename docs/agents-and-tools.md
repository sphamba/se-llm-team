# Agents and tools

## Agents

Agent prompts live in `agents/`. The orchestrator runs each agent as a headless `<executable> --approve --mode json [<llm flags>] [--append-system-prompt <project AGENTS.md>] -p <prompt>` process, with the optional provider/model/thinking flags from the config. The prompt carries no task path. Before each spawn the orchestrator puts two symlinks in the agent cwd: `SPECS.md` points at the task file through the linked board, and `AGENTS.md` points at the role's notes file (`.kanban/AGENTS.<role>.md`). The agent reads the task and the role guidance from its cwd at startup. At every spawn the orchestrator also reads the project root's own `AGENTS.md` and, when it exists and is non-empty, injects its content into the agent session as an `--append-system-prompt` argument (one argv element, never shell-interpolated; skipped with a logged warning above the 131,000-byte cap), so the target project's own instructions reach agents even though the cwd `AGENTS.md` is the role-notes symlink. When a tracked `AGENTS.md` sits in the worktree, the orchestrator marks it `--skip-worktree` before replacing it with the symlink, so git status stays clean. The orchestrator re-points both symlinks at every spawn and removes them when the agent terminates. All four roles run with the task worktree as cwd:

| Role | cwd |
| --- | --- |
| Developer | the task worktree |
| Reviewer | the task worktree |
| Merger | the task worktree (resolves conflicts, runs the full test suite after the replay) |
| Live-tester | the task worktree (tests the merged commit) |

The agent log (`.kanban/.logs/`) carries the full JSONL event stream; the web ui renders it readably. The orchestrator reads the role prompt from `agents/` in its own checkout at each spawn. A prompt fix on a task worktree branch applies only after that branch merges, so do not rely on a prompt change before the merge. Agents append notes to their task file directly; only the Reviewer also writes the state attribute (its approve/reject decision), and the orchestrator moves the task itself on a successful finish. The Live-tester reports issues to a Project manager subagent that creates new tasks.

## Tools

The PM session gets: kanban_list, kanban_get, kanban_create, kanban_update, kanban_set_state, kanban_set_worktree, kanban_delete, orchestrator_start, orchestrator_status, orchestrator_stop, orchestrator_poke. kanban_get, kanban_update and kanban_set_state take an optional file parameter: when omitted, the task resolves from the session cwd through the SPECS.md symlink, so an agent session in a worktree never passes the file name. With no SPECS.md in the cwd the tool reports `no task; pass the file name or run from a worktree with SPECS.md`. kanban_delete removes a mistaken task: it deletes the task file and commits a whole-board mirror snapshot in one operation, so the daemon cannot restore the task. Never delete a board file by hand. The daemon restores hand-deleted files from the mirror. The extension also notifies the session when a task reaches done, and delivers the queued PM reports as `board-report` messages (see the Orchestrator section in docs/architecture.md).

All tools load on demand: they are registered deferred, so they stay out of the model's startup tool list, and the model declares one when the built-in `tool_search` tool finds it. The extension activates `tool_search` automatically at session start (a `before_agent_start` handler), so installing the plugin is enough. When the extension is not loaded, enable the tool manually with `"defaultTools": ["+tool_search"]` in `~/.pi/agent/settings.json`.
