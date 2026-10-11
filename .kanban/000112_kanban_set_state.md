---
name: "fix: kanban_set_state and kanban_set_worktree accept an unsupported field"
priority: "low"
state: "to-merge"
worktree: "fix/112-kanban-set-state"
issuer: "#85"
---

# Summary
kanban_set_state and kanban_set_worktree have no additionalProperties:false, so a real pi validation passes an unsupported field (e.g. notes) and the tool reports success. Lower impact than kanban_create: the primary state/worktree change still lands and only the extra field is dropped. Decide whether to reject unknown fields for consistency.

# Specs
kanban_set_state and kanban_set_worktree (index.ts, tool registrations ~lines 101 and 118) have no additionalProperties:false, so pi's validation passes an unsupported field (e.g. notes) and the tool reports success.

Verified evidence (live test of #85, real pi runtime):
- Loaded the real index.ts through pi's loader aliases and ran pi's real validation function validateToolArguments (from pi-ai dist utils/validation.js - the Convert + Compile path pi runs before execute).
- A real validation of both tools with an unsupported "notes" field passes, and each tool reports success. The primary operation (the state or worktree change) still happens; only the extra field is dropped - a false-but-harmless success.

User decision (settled 2026-10-11, structured dialog): REJECT unknown fields everywhere for consistency - both tools get additionalProperties:false (the #85 pattern), alongside kanban_create (#111).

Fix:
- index.ts, kanban_set_state and kanban_set_worktree registrations: { additionalProperties: false } as the second argument to Type.Object, the pattern #85's fix (commit bf0621d, branch fix/85-kanban-update-silently) applied to kanban_update.
- Do not change src/kanban.ts state/worktree library behavior.

Acceptance:
- Both tools reject an unrecognized field before execute, naming the offending field via pi's validation error.
- Valid calls (file + state / file + worktree) keep the current behavior and response, including the empty-string worktree clear.
- Extend src/extension.test.ts to cover both tools' schema strictness with pi's real validator.
- The existing node suites stay green (extension, kanban, webui, orchestrator).

# Notes

- fix/112-kanban-set-state commit 5b02f70: added { additionalProperties: false } as the second Type.Object argument to kanban_set_state and kanban_set_worktree registrations in index.ts (the #85 kanban_update pattern). src/kanban.ts untouched.
- src/extension.test.ts extended: a strict() helper covers both tools with pi's real typebox validator (Compile path) - additionalProperties false, unknown "notes" field fails validation, error names the offending field via keyword additionalProperties; valid calls verified through execute (state change response, worktree set, empty-string worktree clear).
- All suites green: extension, kanban, webui, index, orchestrator (orchestrator run with SE_LLM_TEAM_NO_WEBUI=1).
- Review of 5b02f70: no issues found. Both registrations carry { additionalProperties: false } as the second Type.Object argument (the #85 pattern, same as kanban_update), src/kanban.ts untouched. Tests cover schema strictness via pi's real Compile validator (unknown notes field fails, error names the field), valid calls through execute keep behavior and response, including the empty-string worktree clear. All suites re-run green in the worktree: extension, kanban, webui, index, orchestrator (SE_LLM_TEAM_NO_WEBUI=1, exit 0).
- Live test (real pi runtime, worktree extension loaded via `pi --no-extensions -e index.ts`, scratch board in /tmp, no unit suites run):
  - kanban_set_state with {file, state, notes} rejected before execute with `Validation failed for tool "kanban_set_state": - notes: schema is false - root: must not have additional properties`; the scratch task state stayed `backlog`.
  - kanban_set_worktree with {file, worktree, notes} rejected the same way, naming `notes`; no write happened.
  - Valid calls kept current behavior and response: set_state `state -> doing` persisted, set_worktree `worktree -> feat/1-x` persisted, empty-string `worktree -> ` cleared the attribute to `""`.
  - No issues found.

# Open questions
