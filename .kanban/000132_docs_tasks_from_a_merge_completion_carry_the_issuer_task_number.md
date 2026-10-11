---
name: "docs: tasks from a merge completion carry the issuer task number"
priority: "medium"
state: "backlog"
worktree: ""
complexity: simple
blockedBy: "#131, #130"
---

# Summary
Tasks filed from a merge completion or live-tester report must not get the default issuer "user". SKILL.md step 3 gains: pass issuer "#<num>" of the task whose merge/live test produced the findings.

# Specs
# Change (skills/se-llm-team/SKILL.md only)

Step 3 (session flow) says "A live-tester report is a new need: create one task per finding, with the finding's open questions in its body." Extend that sentence: when creating tasks from a merge completion or a live-tester report, pass issuer "#<num>" of the task whose merge or live test produced the findings (e.g. "#118"), so the finding tasks are traceable to their cause. The default "user" stays for tasks the user requested.

# Facts

- The mechanism already exists: kanban_create accepts issuer (index.ts ~:68, "'user' (default) or '#<num>' when created after live-testing of task #<num>"), and src/kanban.ts:292 validates user/#<num> with fallback to "user" at creation only.
- The tool description already says to set it; the skill never does, so finding-flow tasks (e.g. #130) were filed with "user".
- Issuer is set at creation only and never changed afterwards - no retro-edit of existing tasks is in scope.

# Complexity

simple. Single file, docs-only.

# Notes
