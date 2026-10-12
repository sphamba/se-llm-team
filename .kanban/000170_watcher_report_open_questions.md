---
name: "docs: Watcher report path is not backed by the watcher agent definition"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#161"
complexity: "simple"
shortName: "watcher-report-open-questions"
---

# Summary
Found in the live test of #161 (merged 3149f65; skills/se-llm-team/SKILL.md only): the new Watcher-section text promises the Watcher's report lists backlog tasks held by unanswered open questions, but the watcher agent definition was not updated and the daemon never gives an in-session watcher its .kanban/AGENTS.watcher.md, so a real watcher report carries only done/created tasks. Either update the Watcher agent so the report really lists those backlog tasks, or reword SKILL.md so the PM runs that board check on every report.

# Specs
Found in the live test of #161 (merged commit 3149f65; the change touched skills/se-llm-team/SKILL.md only).

## Problem

SKILL.md's Watcher section, second bullet, now says: "The report also lists backlog tasks held by unanswered open questions, read from the task files on disk (state backlog with a non-empty openQuestions section), quoting each task's questions." Nothing backs that promise. The Watcher agent definition .pi/agents/watcher.md was not changed and still says: "When it returns board commits, stop and report: which task is done, and which tasks were created. ... keep it under 100 words." The daemon appends .kanban/AGENTS.<role>.md only to the roles it spawns itself (src/orchestrator.ts spawnAgent -> ensureRoleNotes + --append-system-prompt), not to the in-session watcher subagent the PM spawns with the Agent tool, and there is no .kanban/AGENTS.watcher.md (only developer, live-tester, merger, reviewer exist).

## Evidence

- Real watcher subagent spawned exactly as the skill says (subagent_type "watcher") woke on the "kanban: create 000169_live_duration_ticks_every_second.md" commit. Its report listed only the created task and "done: none" - no backlog-held open questions.
- At that moment the live board held #167 (000167_stale_daemon_steals_hub_port.md) and #168 (000168_hub_candidacy_path_based.md) in state backlog with non-empty openQuestions sections, so a working report path would have carried them. The user's decisions on those questions had to come from elsewhere.
- So only the PM's own kanban_list board check (step 1/2) actually surfaces blocked questions; the Watcher half of the #161 change is inert.

## Expected change / decision

One of:
1. Update .pi/agents/watcher.md so its report really lists backlog tasks held by unanswered open questions (state backlog with a non-empty openQuestions section), reading the task files on disk and quoting each task's questions; add a .kanban/AGENTS.watcher.md if that is the wanted mechanism, noting that the daemon does not append role notes to in-session watchers, so the watcher definition itself must carry the instruction. Keep the report bounded (the 100-word cap needs revisiting if questions are quoted).
2. Keep the change SKILL.md-only and reword the Watcher bullet so the PM performs that board check itself when a report arrives (the report no longer claims to carry the questions).

Whichever is chosen, SKILL.md and .pi/agents/watcher.md must agree.

## Acceptance

- The watcher definition (or the reworded SKILL.md bullet) states the report/board-check behavior that the #161 live test showed missing.
- A live test spawns a watcher subagent with the Agent tool (subagent_type "watcher") while a backlog task with non-empty openQuestions exists, and shows either that the report quotes that task's questions, or that the PM asks them from its own board check after the report.

# Notes

# Open questions
Update the Watcher agent so its report really lists backlog tasks held by unanswered open questions, or keep the change SKILL.md-only and reword it so the PM runs the board check itself on every Watcher report?
