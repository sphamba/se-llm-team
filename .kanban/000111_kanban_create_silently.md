---
name: "fix: kanban_create silently drops an unsupported field and reports a false success"
priority: "medium"
state: "doing"
worktree: "fix/111-kanban-create-silently"
issuer: "#85"
---

# Summary
kanban_create's parameters schema has no additionalProperties:false, so an unsupported field (e.g. notes) passes pi's validation, the tool returns "Created <file> (#N)", and the field text is silently dropped. Same false-success class as #85, which fixed only kanban_update. Reject unknown fields the same way.

# Specs
kanban_create (index.ts, tool registration ~line 56) accepts an unsupported field and reports a false success.

Verified evidence (live test of #85, real pi runtime):
- Loaded the real index.ts through pi's loader aliases, captured the registered tools, and ran pi's real validation function validateToolArguments (from pi-ai dist utils/validation.js - the Convert + Compile path pi runs before execute).
- A kanban_create call with name, summary and an unsupported "notes" field PASSES validation; execute runs and returns "Created <file> (#N)"; the notes text is never written anywhere.
- Same class of bug as #85, but out of scope of #85 (which only fixed kanban_update).

User decision (settled 2026-10-11, structured dialog): REJECT unknown fields everywhere - kanban_create, kanban_set_state and kanban_set_worktree all get additionalProperties:false (the #85 pattern); no notes parameter is added; "reject unsupported fields" is the intended convention for all kanban write tools.

Fix:
- index.ts, kanban_create registration: pass { additionalProperties: false } as the second argument to Type.Object, the pattern #85's fix (commit bf0621d, branch fix/85-kanban-update-silently) applied to kanban_update.
- Do not change src/kanban.ts: the silent drop is at the tool-schema level; createTask's contract stays as is.
- kanban_set_state and kanban_set_worktree are covered by #112 (same convention).

Acceptance:
- A kanban_create call carrying an unrecognized field is rejected by pi's validation before execute (no file created, no "Created ..." message).
- All supported calls (name, priority, issuer, summary, specs, openQuestions, complexity, blockedBy) keep the current behavior and response.
- Extend src/extension.test.ts (added by #85) to assert the schema carries additionalProperties:false and that pi's real validator rejects an unsupported field for kanban_create, alongside the existing kanban_update cases.
- The existing node suites stay green (extension, kanban, webui, orchestrator).

# Notes

# Open questions
