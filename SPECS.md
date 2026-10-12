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
- List of markdown, e.g. 000001_nice_thing.md, files under .kanban/, committed to git only at creation and when done
- Markdown structure:
  - "name" attribute
  - "priority" attribute: low, medium, high, critical
  - "state" attribute: backlog, to-do, doing, to-review, reviewing, to-merge, merging, to-live-test, live-testing, done
  - "worktree" attribute: name of the worktree under .worktrees/, e.g. feat/1-nice-thing
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
  - If the agent terminates without doing updating the task's state, the orchestrator moves the task back to "to-do"
- For every new task in to-review:
  - spawn a Reviewer agent and move the task to "reviewing"
  - If terminated without updated state, move to back to "to-review"
- For every new task in to-merge:
  - spawn at most one Merger agent at a time for the whole project, and move to "merging"
  - the Merger resolves the project root's current branch at the start of each step, merges it into the task worktree, resolves conflicts and runs the tests there only when it had to resolve conflicts, then merges the branch into the project root's current branch and sets "to-live-test"
  - when the merge cannot be completed, the Merger sets the task back to "to-merge" and aborts any merge left dirty, so main never sits mid-merge
- For every new task in to-live-test:
  - route a task whose branch is not merged into the project root's checkout, or that has no worktree, back to "to-merge"
  - spawn a Live-tester agent on the merged commit (the project root's checkout) and move to "live-testing"
  - If terminated without updated state, move back to "to-live-test"
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
- Moves the task to "to-merge" if no fixes were made

## Live-tester
- Performs live testing, like a user
- Doesn't edit the code. Read it if necessary only to spawn the project for testing.
- Moves the task to "done", whatever the test result. The change is already merged, so problems travel as new tasks for the Project manager, never as a re-merge.
- Spawns a Project manager subagent to report feedback, issues, and findings, so that the Project manager creates new tasks

## Merger
- Resolves the project root's current branch at the start of each step, merges it into the task worktree, and runs the tests there only when it had to resolve conflicts. When the two sides disagree, the base branch wins unless the task Specs say otherwise.
- Merges the task branch into the project root's current branch, then moves the task to "to-live-test"
- Moves the task back to "to-merge" when the merge cannot be completed, and aborts any merge left dirty, so main never sits mid-merge
