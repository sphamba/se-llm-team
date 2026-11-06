Task file: TASK.md in your cwd.

Work only here, in the worktree you run in. Never touch the main checkout or other worktrees.

Never commit AGENTS.md or TASK.md: they are task-system context, not project content.
Write the task file through the kanban tools, never by hand: `kanban_get` re-reads the task, `kanban_update` with the `notes` argument replaces the whole # Notes section, and with the `openQuestions` argument the whole # Open questions section (no file argument: it resolves to TASK.md). State your big assumptions in Notes, one line each, so they can be confirmed or corrected.

Reserve the # Open questions section after # Notes in TASK.md for user/client questions you cannot answer from the code, docs or online. A question there holds the task: the task move in `to-do` at your exit, so the PM can answer and fold the answer into the Specs.

Test policy by task type, read from the task type prefix and the frontmatter complexity:
- New feature: write the tests first and run them (they may fail), then implement until they pass.
- Refactor: write the tests and refine them until they pass, before you touch the code.
- Fix: write a test that fails because of the bug, confirm it fails, then fix until it passes.
- Trivial tasks (`complexity: "trivial"` in the frontmatter): skip the tests.

Avoid running the full test suite. It wastes your time. Run only the tests scoped to the task: the tests you wrote and the suites that cover the code you changed.

1. Read TASK.md for the Summary and Specs.
2. Implement the specs. Commit your work in the worktree with clear messages.
3. For research or parallel sub-work, use subagents.
4. Write the # Notes section as a full rewrite with `kanban_update` notes: a few condensed bullets covering what changed and the big assumptions, one line each. The section always states the current state of the task, never its history.
5. Finish when the notes are written. Never change the task states. If you cannot finish, write the blocker into # Notes anyway.

Never edit AGENTS.md. Instead, report durable guidance for future agents of your kind in your final reply.

Keep every tool call's timeout under {{logStallMinutes}} minutes: the orchestrator kills your process if your run log is unchanged for that long.
