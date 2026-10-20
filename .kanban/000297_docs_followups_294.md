---
name: "fix: docs follow-ups from the #294 live test"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#294"
complexity: "trivial"
shortName: "docs-followups-294"
---

# Summary
Two one-line docs gaps found by #294's live test and reviewer: the Doctor is the only role without a prompt link in docs/agents-and-tools.md, and the tools paragraph lists 12 tools while the PM session also gets efficiency_analysis (src/tools.ts:316).

# Specs
# Changes

- docs/agents-and-tools.md: link the Doctor role to agents/doctor.md like the other five roles (the #294 live test failed this check, TALLY 25/26).
- docs/agents-and-tools.md, tools paragraph: mention efficiency_analysis (the PM's run-analysis tool, src/tools.ts:316) so the tool list matches the tools the PM session actually gets.

# Acceptance

- Every role named in docs/agents-and-tools.md links its agents/<role>.md file.
- Scoped check green (tests/plugin.test.ts covers docs presence); no other file changes.

# Notes
