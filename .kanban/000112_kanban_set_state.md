---
name: "fix: kanban_set_state and kanban_set_worktree accept an unsupported field"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#85"
---

# Summary
kanban_set_state and kanban_set_worktree have no additionalProperties:false, so a real pi validation passes an unsupported field (e.g. notes) and the tool reports success. Lower impact than kanban_create: the primary state/worktree change still lands and only the extra field is dropped. Decide whether to reject unknown fields for consistency.

# Specs
kanban_set_state and kanban_set_worktree (index.ts, tool registrations ~lines 101 and 118) have no additionalProperties:false, so pi's validation passes an unsupported field and the tool reports success.

Verified evidence (live test of #85, real pi runtime):
- Loaded the real index.ts through pi's loader aliases and ran pi's real validation function validateToolArguments (from pi-ai dist utils/validation.js — the Convert + Compile path pi runs before execute).
- A real validation of both tools with an unsupported "notes" field passes, and each tool reports success.
- Impact is lower than kanban_create: the primary operation (the state or worktree change) still happens; only the extra unsupported field is silently dropped. So this is a false-but-harmless-success concern, not a dropped write of the main intent.

Fix location and pattern:
- index.ts, kanban_set_state and kanban_set_worktree registrations. #85's fix (commit bf0621d on branch fix/85-kanban-update-silently, task 000085) shows the accepted pattern: `{ additionalProperties: false }` as the second argument to Type.Object.
- Do not change src/kanban.ts state/worktree library behavior.

Acceptance (if the open question resolves towards rejection):
- Both tools reject an unrecognized field before execute, naming the offending field via pi's validation error.
- Valid calls (file + state / file + worktree) keep the current behavior and response, including the empty-string worktree clear.
- Extend src/extension.test.ts to cover both tools' schema strictness with pi's real validator.
- The existing node suites stay green (extension, kanban, webui, orchestrator).

# Notes

# Open questions
- Should the same unknown-field rejection apply to kanban_set_state and kanban_set_worktree for consistency, or is the lower-impact silent drop acceptable there?
