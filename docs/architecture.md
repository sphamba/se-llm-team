# Architecture

## Kanban board

`.kanban/` holds one markdown file per task, named `000001_nice_thing.md`. The name has a zero-padded number and a slug of at most 4 words, or 5 for a supplied `shortName`. The type word is dropped from a name-derived slug. Each file has flat YAML frontmatter. The fields are name, priority, state, worktree, issuer, and complexity, plus optional `shortName` and `blockedBy`. The body has `# Summary`, `# Specs`, and `# Notes`. It has `# Open questions` when needed.

The complexity attribute is `trivial`, `simple`, `moderate`, or `complex`. It defaults to `moderate`. It selects the per-complexity LLM config and the reviewer pass cap.

The library writes task files. The orchestrator daemon commits them at creation in backlog and at done. Edits in between stay uncommitted and land in the done commit. A task deletion commits its own board snapshot.

States: backlog, to-do, doing, to-review, reviewing, to-merge, merging, to-live-test, live-testing, to-integration-test, integration-testing, done.

## Orchestrator

`src/orchestrator.ts` is a non-LLM daemon. Start it with the `orchestrator_start` tool, or run `node src/orchestrator.ts --root <project>`. One daemon runs per project. Its lockfile is `.kanban/.orchestrator.lock`.

The daemon watches `.kanban/` and rescans every 10 s. The `orchestrator_poke` tool touches `.kanban/.poke` for an immediate scan. A poke scan bypasses the backlog quiet window. A poke is the PM's signal to schedule now. Under the `maxParallel` cap the orchestrator starts higher-priority tasks first, with creation order inside a priority.

- **backlog**: the daemon promotes tasks whose blockers are satisfied and whose `# Open questions` section is empty. A board-wide quiet window (`backlogIdleMinutes`, default 1) waits for the board to stay untouched. When a blocker reaches done, to-live-test, or live-testing, the daemon drops its ref.
- **to-do**: for moderate and complex tasks, the daemon spawns a Splitter at the project root. When the Splitter leaves the task in to-do, the daemon creates the worktree `.worktrees/<type>/<num>-<short-slug>` and spawns a Developer. Simple and trivial tasks skip the Splitter and start with the worktree. The daemon sets the task to doing before it starts the Developer.
- **doing**: the Developer implements the Specs in the worktree.
- **to-review**: the daemon spawns a Reviewer and moves the task to reviewing. After `reviewerCap.<complexity>` successful runs, the daemon force-advances the task to to-merge. A trivial task has cap 0 by default and skips the reviewer.
- **reviewing**: the Reviewer fixes small mistakes and sets its own state. Approval goes to to-merge. More fixes go back to to-review. A Specs violation goes to to-do.
- **to-merge**: the orchestrator merge queue. The daemon rebases the task branch onto the root checkout's current branch. It then fast-forwards that branch to the task branch. One merger runs project-wide.
- **merging**: a merger resolves the rebase conflicts. It reports test failures in `# Notes` and moves no state. The next sweep retries to-merge.
- **to-live-test**: the merged commit is ready. The daemon spawns a Live-tester and moves the task to live-testing.
- **live-testing**: the Live-tester runs the merged commit like a user.
- **to-integration-test**: the integration test queue. At the merge fast-forward the orchestrator creates one task in this state or extends the waiting task, so the run can overlap the covered task's live test. The task is named `test: integration of #42, #43`, with the refs in ascending order and deduplicated. Its shortName is `integration-of-<num>` of the first covered task. Its priority is low, its complexity is simple, and its issuer is auto. On a later merged ref the orchestrator rebuilds the whole `# Specs` from the board and appends the new ref: a `## Covered tasks` section with one `### #<num> <name>` entry and a quoted summary per covered ref, and a Summary that names the full set. When no task waits (for example one already runs), it creates a new one. It skips a ref that a waiting or running integration task already names. The daemon spawns an Integration-tester and moves the task to integration-testing. One Integration-tester runs project-wide.
- **integration-testing**: the Integration-tester runs the full project test suite on the merged base branch in the root checkout, with no worktree. It is report-only: it reports defects and coverage gaps, and it never edits code, commits, or merges. Its run counts as one `maxParallel` slot.
- **done**: the daemon removes the worktree and the merged branch. It commits the task file.

A successful finish moves the developer to to-review. It moves the live-tester and the integration-tester to done. A merger returns the task to to-merge. The Reviewer sets its own state. A crash moves the task back one step. The integration lane is report-only, so its every end, a crash included, lands at done. A log that does not grow for `logStallMinutes` counts as a crash. After 5 respawns, the daemon waits `retryIdleMinutes` before the next spawn.

A task file with conflict markers stays untouched. The daemon spawns no agent and writes nothing for it until the merger or the user resolves the conflict.

On a sweep that moves tasks to done, the daemon queues one board report in `.kanban/.reports/`. The extension delivers it to the Project manager session. The report lists the done tasks, the promoted tasks, the live-test findings, and the PM instructions. An integration task has issuer `auto`, so the report never counts it as a finding. Only a session at the repo root receives it.

### Board mirror to origin

The daemon mirrors the board to `refs/heads/meta/kanban` and pushes that ref to `origin`. The push is best effort. It needs SSH access to origin for the daemon user. Without it, the mirror stays local and a fresh clone cannot bootstrap from it.

## Web dashboard

Set `webUi.enabled: true` in the config to serve a read-only dashboard at `http://<host>:<port>`, default `http://localhost:4242`. The board shows every task state, a priority chip on each card, and a popup with the full task. The last column stacks five states: to-live-test, live-testing, to-integration-test, integration-testing, and done. The page refreshes every 5 s. It refreshes every second while the open task has a live agent or doctor. The footer shows the serving hub's `pid`, checkout, and `commit`. The same data is at `GET /api/hub`.

Only a daemon rooted at a main checkout can win the hub election and serve the UI. A daemon in a linked worktree registers with the hub and stands down. This keeps old worktree code off the port. After an upgrade, kill old worktree daemons once: `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'`. A daemon in a task worktree exits when its task is done or gone.
