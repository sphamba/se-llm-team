---
name: "fix: role prompt prohibitions and one-time notes distill"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#279"
complexity: "simple"
shortName: "doctor-minimal-role-notes-content"
blockedBy: "#282, #283, #284"
---

# Summary
Verification parent for the content half of #279, split by role weight into three subtasks with disjoint file ownership: #282 (developer), #283 (live-tester), #284 (reviewer, splitter, merger). Each subtask owns its role prompt prohibition plus that role's one-time notes distill. Verify the landed contract across all five roles once the pieces have merged. The doctor/code half is task #280.

# Specs
# Verification (after #282, #283 and #284 merge)

- grep -n "Edit it for project-specific\|append what future agents" over the five agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md files returns no matches; each of the five carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent); the splitter wording covers its inline-injection path (no AGENTS.md symlink in cwd, the notes ride the appended system prompt, still read-only).
- For each of the five .kanban/AGENTS.<role>.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.
- agents/doctor.md, src/ and tests/ carry no changes from the content subtasks: the merged deliverable commits touch only the five agents/*.md files.

# Notes
