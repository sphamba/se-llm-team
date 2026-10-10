---
name: "fix: guard task state transitions and done merges against in-flight agent sessions"
priority: "high"
state: "done"
worktree: ""
---

# Summary
Concurrent role sessions raced on one task during the 000007 live test, and the done+merge path destroyed an in-flight session. Neither an agent nor the daemon may set a task to done or run mergeDone while that task's agent pid is still alive, and role prompts and the PM skill must tell agents to re-check the task state before each transition.

# Specs
Found by the live-tester of task 000007: concurrent role sessions raced on one task, and the done+merge path destroyed an in-flight session (the merge removed the worktree under the live-tester's cwd mid-check).

Already in place (task 000010, merged): the daemon defers mergeDone while the task's agent pid or merger pid is alive (src/orchestrator.ts, mergeDone). Do not re-implement that.

Remaining need, make agents re-check before they act:
- Update the role prompts agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md: before every state transition (kanban_set_state) the agent must re-read the task with kanban_get and abort the transition when the state no longer matches what it saw when it started (for example the task moved to done, or another session moved it on).
- Update the PM skill skills/se-llm-team/SKILL.md with the same re-check rule, one short bullet in the session flow section.

Constraints:
- Prompt and skill edits only. No changes to src/orchestrator.ts, src/kanban.ts, or index.ts in this task; a tool-level state guard is a possible follow-up task.
- Keep the edits small and in the existing style of each file.

Acceptance:
- Each of the four role prompts states the re-check-before-transition rule.
- The PM skill states the same rule.
- No other files change.

# Notes
Discovered by the live-tester of task 000007; its session was destroyed mid-check by the merge under its cwd.

Developer: added the re-check-before-transition rule to all four role prompts (agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md) and to the PM skill skills/se-llm-team/SKILL.md (session flow section). Rule: before every state transition (kanban_set_state), re-read the task with kanban_get and abort the transition when the state no longer matches what the agent saw when it started. Prompt and skill edits only, 5 files, 10 inserted lines, no source changes. Committed as 313f1c7.

Reviewer: accepted, no fixes. All acceptance criteria met: the rule text in all four role prompts and in the PM skill matches the spec (re-read with kanban_get before every kanban_set_state, abort on state mismatch). The skill edit is one short line in the session flow section, placed after the numbered steps as a standalone paragraph rather than a bullet; this fits the section style (numbered steps are the flow, the rule applies across steps). git diff main...HEAD shows only the 5 specified files, 10 insertions, 0 deletions; src/orchestrator.ts, src/kanban.ts, and index.ts are untouched, and the worktree is clean. State set to to-live-test.

Live-tester: passed, no issues. (1) Content: the rule text is present in all four role prompts and in the PM skill, verbatim as specced; git diff main...HEAD shows only the 5 specified files, 10 insertions. (2) Rendering: rendered agents/live-tester.md through the same placeholder chain as orchestrator.ts renderPrompt ({{ROOT}}, {{TASK_FILE}}, {{WORKTREE}}, {{WORKTREE_NAME}}, {{NAME}}, {{PRIORITY}}): no placeholders left, rule survives. The installed PM skill at ~/.pi/agent/skills/se-llm-team is a symlink to the repo file, so the rule is live for users after merge. (3) Rule exercised live: before the done transition I re-read the task with kanban_get, state still matched what I saw at start (live-testing), transition proceeded per the rule. (4) Done+merge guard against this in-flight session: set state to done while my own spawned session (pid from .kanban/.pids/000014....pid, alive, child of the daemon) was still running. The daemon rescanned and processed other tasks but did not merge my branch (0 'merged fix/guard' log lines), the worktree under my cwd still exists, my session is alive, and the kanban: done commit is deferred to fold in this report. The 000007 failure (merge removing the worktree under a live tester's cwd) does not reproduce. Note: the deferral is silent by design (mergeDone returns false without logging), so a deferred merge leaves no log trace; acceptable, out of scope for this prompt-only task.
