---
name: "fix: role prompt prohibitions and one-time notes distill"
priority: "high"
state: "backlog"
worktree: ""
issuer: "#279"
complexity: "simple"
shortName: "doctor-minimal-role-notes-content"
blockedBy: "#285, #286, #287"
---

# Summary
Verification-only parent for the content half of #279, split three ways: #285 (developer role: prompt prohibition + notes distill), #286 (live-tester role: prompt prohibition + notes distill), #287 (reviewer, merger, splitter: three prompt prohibitions + three notes distills). Verify the full content contract (five read-only/doctor-maintains prohibitions, five distilled notes files) once all three land. Code half is #280.

# Specs
# Verification

Verification-only parent: #285, #286 and #287 each pair one role's prompt prohibition with that role's one-time notes distill. Once all three land, check the content contract end to end:

- grep -n "Edit it for project-specific\|append what future agents" over agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md returns no matches; each of the five carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent; the splitter one covers the inline-injection path).
- For each of the five .kanban/AGENTS.developer.md, .kanban/AGENTS.live-tester.md, .kanban/AGENTS.reviewer.md, .kanban/AGENTS.merger.md, .kanban/AGENTS.splitter.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.
- The merged deliverable diff touches only the five agents/*.md files (one guidance paragraph each); nothing under src/, tests/, agents/doctor.md or agents/analyst.md changed.
- The splitter inline-injection byte cap is untouched.

# Notes

# Notes
