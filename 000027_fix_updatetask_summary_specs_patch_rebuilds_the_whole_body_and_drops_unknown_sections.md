---
name: "fix: updateTask summary/specs patch rebuilds the whole body and drops unknown sections"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
In updateTask (src/kanban.ts), a summary or specs patch rebuilds the whole task body as Summary/Specs/Notes, dropping any unknown sections from the file. Follow the updateAttrs pattern, which already keeps the untouched body verbatim.

# Specs
Found in the live test of task 000011 (worktree commit a90e867); the review flagged it as a follow-up. Pre-existing on main, not caused by the merge-conflict rewrite path — updateAttrs keeps the body verbatim — but it contradicts task 000011's spec line "keep all sections and unknown content intact" and the kanban_update tool description "Replaces the whole Summary section".

Cause: in updateTask (src/kanban.ts, ~line 157), when patch.summary or patch.specs is set, the body is rebuilt from parsed fields as "# Summary\n...\n\n# Specs\n...\n\n# Notes\n..." — any section outside Summary/Specs/Notes in the existing body is silently discarded. By contrast, updateAttrs (~line 133) rewrites only the frontmatter and re-appends the body untouched: serializeFrontmatter(attrs) + m[2].

Fix:
- When patching summary and/or specs, rewrite only the corresponding section(s) in the existing body and keep everything else (unknown sections, Notes, ordering) intact, following the updateAttrs verbatim-body pattern.
- Update the kanban_update tool description if the real behavior differs from "Replaces the whole Summary section", or make the behavior match the description.

Acceptance:
- Patching summary or specs preserves unknown sections and Notes content byte-for-byte.
- A task with only Summary/Specs/Notes behaves as before.
- Existing tests pass.

# Notes
