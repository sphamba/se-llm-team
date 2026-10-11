---
name: "refactor: general code architecture review and potential refactors"
priority: "low"
state: "doing"
worktree: "refactor/52-general-code-architecture"
blockedBy: "#115"
---

# Summary
Review the whole codebase architecture (module boundaries, duplication, dead code, error handling, naming) and apply justified, behavior-preserving refactors, keeping typecheck and the full test suite green. Do this only after the whole backlog has been done/emptied.

# Specs
Review the whole codebase for architecture issues: module boundaries, duplication, dead code, inconsistent patterns, error handling gaps, naming. Apply justified, behavior-preserving refactors. No new dependencies. Keep typecheck and the full test suite green.

MUST run only after the whole backlog has been done/emptied (and after the .kanban issues are resolved). Runs alone - it can touch any file.

# Notes
