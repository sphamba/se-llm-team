---
name: "fix: PM skill spawns a Watcher without checking for a live one; keep exactly one Watcher"
priority: "low"
state: "done"
worktree: ""
---

# Summary
Patch the PM SKILL.md Watcher step: before spawning a Watcher subagent, check whether one is already running (by agent ID or handle), and spawn only when none is running or the last one has finished.

# Specs
Keep exactly one Watcher running.

File: skills/se-llm-team/SKILL.md, line 35 ("## Watcher subagent" section):
- Current text: "At session start, spawn one Watcher with the Agent tool (subagent_type "watcher", run in background). Spawn a fresh Watcher again after every Watcher report; never leave it dead."
- Change to: at session start, spawn one Watcher and remember its agent ID/name. After every Watcher report, check whether another Watcher is already running before spawning: use get_subagent_result on the last known Watcher's agent ID or handle with wait=false; spawn a fresh Watcher only when no Watcher is running or the last one has finished and reported. Never leave the board without a Watcher; never run two at the same time.

Acceptance:
- The skill instructs the check-then-spawn pattern with the exact tool call (get_subagent_result, wait=false, agent ID or handle).
- Exactly one Watcher runs at any time; no duplicate or stacked watchers.

Constraints:
- Only skills/se-llm-team/SKILL.md changes. No overlap with the in-flight tasks (000029: src/webui.ts; 000034: src/orchestrator.ts, .gitignore).

# Notes

- Patched the "## Watcher subagent" bullet in skills/se-llm-team/SKILL.md (worktree commit 5d9e65c): the skill now says to remember the Watcher's agent ID/name at session start, then before spawning again call get_subagent_result on the last known Watcher's agent ID or handle with wait=false, and spawn a fresh Watcher only when none is running or the last one has finished and reported. Never leave the board without a Watcher; never run two at the same time. Only that file changed.
- Reviewed (worktree commit 5d9e65c, no fixes): the changed bullet is at line 35 in "## Watcher subagent" as the Specs require. It tells the PM to remember the agent ID/name at session start, to check before each spawn with get_subagent_result (wait=false, agent ID or handle), and to spawn only when no Watcher runs or the last one finished and reported. Both acceptance criteria are met. git diff main...HEAD shows only skills/se-llm-team/SKILL.md (1 file, +1/-1), so the constraint holds (no overlap with 000029 or 000034).
- Live test PASSED, no defects in the change (worktree commit 5d9e65c). The changed bullet is at line 35 in "## Watcher subagent" and matches the Specs and both acceptance criteria. git diff main...HEAD shows only skills/se-llm-team/SKILL.md (1 file, +1/-1); no overlap with 000029 or 000034.
- I tested the pattern with real watcher subagents. get_subagent_result on a running Watcher with wait=false returned at once, no block, with status running; I tested both the name handle and the agent ID forms, both work. While Watcher 1 ran I made no second spawn (the check returned running). After Watcher 1 finished and reported (orchestrator_wait timeout after 300s), I spawned a fresh Watcher 2 and the check returned running again. Exactly one Watcher ran at each moment; no stacked watchers.
- The merge of this branch defers while my pid is alive (mergeDone reads .kanban/.pids/000035....pid), so it lands after this session ends. The installed skill is a symlink to the main checkout, so users get the new text at merge time. Verified by mechanism inspection per the README "Extension load path" rule for unmerged branches.
- One observation, not a defect of this change: orchestrator_wait uses the session cwd. A Watcher spawned from a session whose cwd is a task worktree (as here) watches the worktree git history (HEAD pinned at the branch tip) and never sees main-checkout board commits; its 300s wait times out with no events. In the PM flow (cwd = project root) the same call sees kanban commits. Reported to the Project manager.
