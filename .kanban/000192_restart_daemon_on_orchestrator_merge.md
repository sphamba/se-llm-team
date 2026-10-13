---
name: "fix: restart the daemon after a merge that changes the orchestrator"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#187"
complexity: "simple"
shortName: "restart-daemon-on-orchestrator-merge"
---

# Summary
When a merge into main changes src/orchestrator/ while the daemon keeps running the pre-change code, the pipeline livelocks: the merged developer, merger and live-tester prompts no longer call kanban_set_state (the new orchestrator moves the state on a successful exit 0), but the old daemon has no exit-code detection, so every successful agent finish looks like a dead agent, bounces the task and respawns it — the task can never reach done and each cycle burns one full agent run. Nothing in README.md or skills/se-llm-team/SKILL.md says the daemon must be restarted after such a merge, and orchestrator_start is a documented no-op while a daemon already runs, so the PM can believe the new code is live when the old daemon is still in charge. Fix: either document the mandatory restart, or make the daemon restart itself after a root-side merge that touched src/orchestrator/.

# Specs
## What happens
When a merge into main changes `src/orchestrator/` while the orchestrator daemon keeps running the pre-change code, the pipeline livelocks:

- The merged developer, merger and live-tester prompts no longer call `kanban_set_state` (the new orchestrator is supposed to move the state on a successful exit 0).
- The old daemon has no exit-code detection, so it treats every successful agent finish as a dead agent: it logs `agent pid=<pid> dead without state update, <state> -> <bounce state>` and respawns the task.
- The task can never reach done, and each cycle burns one full agent run (a developer run was about 24 minutes in the observed case).

The trap is made worse by the skill text: it tells the PM to call `orchestrator_start`, which is a documented no-op while a daemon already runs, so the PM can believe the new code is live when the old daemon is still in charge. Nothing in `README.md` or `skills/se-llm-team/SKILL.md` says the daemon must be restarted after a merge that changes the orchestrator.

## Evidence (real board, live test of #187)
- Production daemon pid 4110262 started 2026-10-12 22:45:40, before this change merged.
- It spawned the #187 merger (pid 441445) and both #187 live-testers with cwd = the project root (old behavior).
- Live-tester run pid 441909 ended normally (agent_settled, aborted false), and at 2026-10-13T08:50:11.975Z the daemon logged `000187_orchestrator_merge_worktree_flow: agent pid=441909 dead without state update, live-testing -> to-live-test` and spawned a replacement run, which is the run that reported this.
- Developer #189 (pid 463733, spawned 08:47:06) finished after about 24 minutes, and at 09:11:13 the daemon logged `000189_merger_poll_misattribution: agent pid=463733 dead without state update, doing -> to-do` and respawned a developer (pid 502040). The work is preserved in the worktree, but the successful run is discarded.
- Tasks #188 and #191 wait for the same trap.
- Current state: the live-tester stopped the old daemon and started a new one (pid 502237) on the merged commit, so the loop is stopped for now. The problem is that no documented step and no automation forces that restart on the next orchestrator change.

## Fix options (PM/user chooses)
- (a) Document in `README.md` and `skills/se-llm-team/SKILL.md` that the daemon must be restarted after a merge that changes the orchestrator (and call out that `orchestrator_start` is a no-op while a daemon runs).
- (b) Make the daemon restart itself after a root-side merge that touched `src/orchestrator/`; the restarted process loads the new code. This is the durable fix.

## Acceptance
- The chosen option is implemented: either the restart requirement is stated in both documents, or the daemon performs the self-restart after a root-side merge that touched `src/orchestrator/` (and in-flight agents survive it, per #125).

# Notes

# Open questions
Should the daemon restart itself after a root-side merge that changes src/orchestrator/, or should README.md and skills/se-llm-team/SKILL.md only document the manual restart?
