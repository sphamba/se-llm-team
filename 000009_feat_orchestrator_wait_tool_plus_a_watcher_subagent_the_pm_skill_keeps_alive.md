---
name: "feat: orchestrator_wait tool plus a Watcher subagent the PM skill keeps alive"
priority: "high"
state: "done"
worktree: ""
---

# Summary
Add an orchestrator_wait tool that blocks until the orchestrator records a new kanban: create or kanban: done commit; add a "watcher" subagent type that calls it in a loop and stops to report; edit the PM skill to spawn the Watcher at session start and relaunch it after every report, so the chat learns when a task is done and whether it created new tasks.

# Specs
# Need

Combine the watcher-subagent option with a wait tool. The chat must be updated when a task is done and whether that flow created new tasks. The push channel into a session is the completion notification of a background subagent; the event feed is the merged commit policy (kanban: create / kanban: done commits in git log).

# Facts

- index.ts (repo root) is a pi extension. Tools are registered with pi.registerTool({ name, label, description, parameters: Type.Object({...}), async execute(_id, params, _signal, _onUpdate, ctx) }). The orchestrator_status/stop tools (:151-178) are the pattern to copy.
- Event feed: the daemon commits board changes as `kanban: create <file>` and `kanban: done <file>` commits. git log in the main checkout is the event source. No daemon change and no daemon restart are needed; the tool runs session-side.
- Custom pi agent types live in .pi/agents/<name>.md and are picked up automatically; the Agent tool selects them with subagent_type. There are no agent docs; follow the Agent tool contract.
- The PM skill is skills/se-llm-team/SKILL.md (28 lines). Step 8 falsely claims "The session shows a notification when a task reaches done". There is no such notification.

# Required behavior

1. New tool "orchestrator_wait" in index.ts, next to the other orchestrator tools:
   - Params: timeoutSeconds, optional number, default 300, clamped to 1-900.
   - Execute: read the current HEAD sha in ctx.cwd (execSync). Poll every 2s: `git log --format=%s <baseline>..HEAD` and collect subjects that start with "kanban: done " or "kanban: create ". When at least one lands, return immediately, one subject per line. On abort or timeout return "No board commits in Ns."
   - Description: "Wait for the orchestrator to record new board commits (kanban: create / kanban: done). Blocks up to the timeout, then reports what changed. No update before the timeout is normal."
2. New custom agent type .pi/agents/watcher.md:
   - Frontmatter description: "Watcher that blocks on orchestrator_wait and reports board events (done task, created tasks) to the Project manager."
   - Body: You are the Watcher of the se-llm-team kanban pipeline. Loop: call orchestrator_wait (timeoutSeconds 600). When it returns board commits, stop and report: which task is done, and which tasks were created. When it reports no commits, call it again. Your final text is the report the Project manager relays to the user; keep it under 100 words. Never edit board files or code.
3. PM skill edit (skills/se-llm-team/SKILL.md):
   - Replace the false notification claim in step 8 with the Watcher flow.
   - Add a "## Watcher subagent" section: spawn one Watcher with the Agent tool (subagent_type "watcher", run in background) at session start and again after every Watcher report. When the Watcher stops to report, summarize the update to the user and immediately relaunch a fresh Watcher; never leave it dead. Note that the Watcher works only while the session is open; events while no session runs are read late from the same git feed.

# Constraints

- Minimal diff. No new dependencies. No daemon changes, no daemon restart.
- Keep the tool contracts of the existing tools unchanged.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.
- orchestrator_wait works: with a watcher waiting, a real kanban: create or done commit lands and the tool returns it within the timeout.
- .pi/agents/watcher.md exists and is selectable as subagent_type "watcher".
- The skill states the launch and relaunch flow and no longer claims an automatic done notification.

# Notes
