Create a pi coding agent extension (this repo is already symlinked to ~/pi/agent/extensions/se-llm-team/). It comes with one visible only-user-invokable skill (identifier "se-llm-team"). When called, the current session becomes the Project manager, and an Orchestrator job is launched.


# Project manager
- Gets feature requests and feedback from the user
- Creates Kanban tasks in the backlog based on interaction with the user
  - task names should be prefixed by "feat: ", "fix: ", "perf: ", etc.
  - looks for all not-done tasks before creation to not have duplicates. update tasks if in backlog, otherwise create new ones with no overlap
- Asks clarification questions to the user, until agreement is found, to write the tasks specs
- Prioritizes tasks, moves them from backlog to to-do, chooses how many lanes are done in parallel, is aware of how many lanes are currently being worked on
- Gets progress notifications (tasks moving to done) from the Orchestrator


# Kanban board
- List of markdown, e.g. 000001_feat_nice_thing.md, files under .kanban/, committed to git only at creation and when done
- Markdown structure:
  - "name" attribute
  - "priority" attribute: low, medium, high, critical
  - "state" attribute: backlog, to-do, doing, to-review, reviewing, to-live-test, live-testing, done
  - "worktree" attribute: name of the worktree under .worktrees/, e.g. feat/nice-thing
  - "Summary" section: concise, coming from Project manager + user
  - "Specs" section: detailed description of needs
  - "Notes" section: live implementation and review notes
- Programmatic interface (Typescript): for the Project manager and the Orchestrator.
  - Methods for the Project manager to get all tasks (name + summary only) in backlog, done, or in progress (includes all the other states, no need for more granularity)
  - Same for the Orchestrator, but with full granularity
  - Methods to change the state and set the worktree name


# Orchestrator
- Stateless process spawned when calling the extension, Typescript
- Detects when a Kanban task changes state
- For every new task in to-do:
  - create a unique git worktree under .worktrees/ based on the task name, and set the worktree attribute of the task
  - spawn a Developer agent and move the task to "doing"
  - If the agent terminates without doing updating the task's state, the orchestrator moves it to "to-review"
- For every new task in to-review:
  - spawn a Reviewer agent and move the task to "reviewing"
  - If terminated without updated state, move to back to "to-review"
- For every new task in to-live-test:
  - spawn a Tester agent and move to "live-testing"
  - If terminated without updated state, move to "done"
- Poll the agents for liveness (every 15 minutes, configurable). If dead, kill the agent, and respawn at same state.
- configuration variable for the coding agent executable


# Agents

All agents can spawn subagents (and are encouraged to do so) for implementation, review, testing, etc.

## Developer
- Implements the specs
- Update the task notes
- Moves the task to "to-review" after completion

## Reviewer
- Review the code and fix mistakes
- Update the task notes
- Moves the task to "to-review" if fixes were made
- Moves the task to "to-live-test" if no fixes were made

## Live-tester
- Performs live testing, like a user
- Doesn't edit the code. Read it if necessary only to spawn the project for testing.
- Moves the task to "done"
- Spawns a Project manager subagent to report feedback, issues, and findings, so that the Project manager creates new tasks
