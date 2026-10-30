# Agents and tools

## Agents

The orchestrator runs each agent as a headless CLI process. The flags depend on the `pi` or `claude` backend. See [`src/orchestrator/backends.ts`](../src/orchestrator/backends.ts). The prompt comes from [`agents/`](../agents/) and carries no task path.

Before each spawn, the orchestrator puts two symlinks in the worktree cwd. `SPECS.md` points at the task file through the linked board. `AGENTS.md` points at the role's notes file, `.kanban/AGENTS.<role>.md`. The agent reads the task and the role guidance from its cwd at startup. The Splitter runs at the project root and gets only the `SPECS.md` link. It never runs on a held task, and it never runs when the `splitting` config is off.

The orchestrator also reads the project root's `AGENTS.md`. When it exists and is not empty, the orchestrator injects it as an appended system prompt. The exception is the Splitter under pi, where the cwd chain loads the file directly. The target project's instructions thus reach the agent even though the cwd `AGENTS.md` is the role-notes symlink.

| Role | cwd | Prompt |
| --- | --- | --- |
| Splitter | the project root, never a held task | [agents/splitter.md](../agents/splitter.md) |
| Developer | the task worktree | [agents/developer.md](../agents/developer.md) |
| Reviewer | the task worktree | [agents/reviewer.md](../agents/reviewer.md) |
| Merger | the task worktree | [agents/merger.md](../agents/merger.md) |
| Live-tester | the task worktree | [agents/live-tester.md](../agents/live-tester.md) |
| Doctor | the task worktree | [agents/doctor.md](../agents/doctor.md) |

The Merger rebases the task branch onto the base branch, resolves the conflicts, and runs the full project test suite in its worktree. The daemon only proves that result and fast-forwards the root checkout to that branch. A merger that gives up on the rebase leaves the task in merging and writes `.kanban/.logs/<slug>.merge-stuck` with the reason, the branch and the base. That marker blocks the whole merge lane. The daemon reports the hand-repair recipe, and the sweep moves the task to to-live-test after the root fast-forward.

A non-empty `# Open questions` section holds the task. The sweep adds the `question` token to `blockedBy`, moves the task to to-do at the agent exit, and queues one PM report. `question` holds the task like the `user` manual hold: it starts no stage. A `question` token on a done task does not reopen it. `kanban_create` never adds the token: the sweep adds it at its next pass.

Agent logs live in `.kanban/.logs/`. The web UI renders them readably. The orchestrator reads the role prompt from `agents/` in its own checkout at each spawn. A prompt fix on a task branch applies only after that branch merges.

Agents append notes to the task file directly. On a successful finish, the orchestrator moves the developer to to-review and the live-tester to done. A merger leaves the task in merging, and the orchestrator then proves the rebase and moves it to to-live-test. The Reviewer moves no state itself: on its exit 0 the orchestrator compares the worktree commits against the pre-run base, bounces to to-review after fixes, and moves to to-merge on approval or when the review cap is reached. On a Specs violation it writes to-do. The Live-tester ends with a finish message that reports its findings, and it names the task numbers it filed. It moves no state. It files each defect as a new task with `kanban_create`, with `issuer` set to `#<num>` of the tested task. It never writes an open question on the tested task: when a finding needs a user decision, the same `kanban_create` call carries `openQuestions` and `blockedBy: "question"`. An environment problem stays in its own `# Notes`. A Doctor pass follows every successful run of the developer, reviewer, merger, and live-tester. It rewrites that role's notes file.

## Tools

The PM session gets 13 kanban and orchestrator tools: `kanban_list`, `kanban_get`, `kanban_create`, `kanban_update`, `kanban_set_state`, `kanban_set_worktree`, `kanban_delete`, `kanban_mark_processed`, `orchestrator_start`, `orchestrator_status`, `orchestrator_stop`, `orchestrator_poke`, and `efficiency_analysis` (the run-analysis tool that turns one agent log into a markdown report, see [src/tools.ts:316](../src/tools.ts)).

`kanban_get`, `kanban_update`, and `kanban_set_state` take an optional `file`. When omitted, the task resolves from the session cwd through the `SPECS.md` symlink. With no `SPECS.md` in the cwd, the tool reports `no task; pass the file name or run from a worktree with SPECS.md`.

`kanban_update` takes `openQuestions` with replace semantics. Clearing the section with `openQuestions: ""` requires `specs` in the same call, so an answer never disappears without landing in the Specs. The PM answers, folds the answer into the Specs, then clears the section. The sweep removes the `question` token when the section is empty.

`kanban_delete` removes a mistaken task. It deletes the task file and commits a whole-board mirror snapshot in one operation. The daemon cannot restore the task. Never delete a board file by hand, because the daemon restores hand-deleted files from the mirror. `kanban_mark_processed` records that the PM handled a done task.

The extension notifies the session when a task reaches done. It also delivers the queued PM reports as `board-report` messages. See the Orchestrator section in [architecture.md](architecture.md).

All tools load on demand. They are registered deferred, so they stay out of the model's startup tool list. The model declares one when the built-in `tool_search` tool finds it. The extension activates `tool_search` before each agent start, so installing the plugin is enough. Without the extension, enable the tool with `"defaultTools": ["+tool_search"]` in `~/.pi/agent/settings.json`.
