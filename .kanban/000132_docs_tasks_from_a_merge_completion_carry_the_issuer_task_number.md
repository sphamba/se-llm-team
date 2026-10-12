---
name: "docs: tasks from a merge completion carry the issuer task number"
priority: "medium"
state: "done"
worktree: ""
complexity: "simple"
blockedBy: ""
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

- Extended step 3 (Session flow) of skills/se-llm-team/SKILL.md: filing tasks from a merge completion or a live-tester report must pass issuer "#<num>" of the task whose merge or live test produced the findings (e.g. "#118"); the default issuer "user" stays for tasks the user requested. Docs-only, one sentence.
- Review pass: diff matches the Specs. One sentence in step 3 covers merge completions and live-tester reports, gives the "#118" example, and keeps the default "user" for user-requested tasks. Single file, no other changes. No open questions. Approved for live test.
- Live test (HEAD 7cc2257, tree clean): pass. Diff main...HEAD is the single step-3 sentence in skills/se-llm-team/SKILL.md. The sentence covers both a merge completion and a live-tester report, gives the issuer "#<num>" format with the "#118" example, and keeps the default "user" for tasks the user requested. No other file in skills/ or agents/ mentions issuer, so no contradicting instruction exists.
- Live test, real tool flow for the new instruction: kanban_create with issuer "#132" created 000138 with frontmatter issuer: "#132", and kanban_get reported the same value. kanban_create with no issuer created 000139 with issuer: "user". Both probes were deleted with kanban_delete. Board counts returned to done 129, backlog 3, live-testing 1, and the meta/kanban mirror holds the create/delete commit pairs for both probes.
- Live test observation, not a defect: the global symlink ~/.pi/agent/skills/se-llm-team points at the main checkout, so the new sentence serves only after the Merger merges this branch. This behavior is the known extension load path of unmerged branches.
- No unit suite was run. No issues found, so no Project manager report was needed. No open questions.
- Merge (base main): step 1 merged main into docs/132-tasks-from-a in the worktree, already up to date, clean, no conflicts, suites skipped. Step 2 merged docs/132-tasks-from-a into main in the project root, fast-forward ed64d1f..7cc2257, one file changed (skills/se-llm-team/SKILL.md, 1 insertion, 1 deletion). No conflicts, no fixes needed.
