---
name: "fix: kanban_create silently drops an unsupported field and reports a false success"
priority: "medium"
state: "done"
worktree: ""
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

- 2026-10-11: Applied the #85 pattern to kanban_create: index.ts kanban_create registration now passes { additionalProperties: false } to Type.Object, so pi rejects an unsupported field with a validation error before execute. src/kanban.ts untouched. Extended src/extension.test.ts with the kanban_create cases: schema carries additionalProperties:false, pi's validator (typebox Compile) fails a call with an unsupported "notes" field (keyword additionalProperties), and a call with all supported fields still passes. All node suites green (extension, kanban, webui, orchestrator; orchestrator needs >180s, passes with a longer timeout). Committed as 97721c1 on fix/111-kanban-create-silently.
- 2026-10-11 review: 97721c1 matches the #85 pattern (bf0621d) exactly, including comment style; src/kanban.ts untouched as spec'd. One gap found: the acceptance item "all supported calls keep the current behavior and response" was only covered at the validator level, the create execute path never ran (unlike the update cases in #85). Fixed with commit 8b291f8: extension.test.ts now runs kanban_create execute with all supported fields and asserts the exact `Created <file> (#N)` response plus the written issuer. All four node suites re-run green after the fix. No open questions.
- 2026-10-11 review (2nd pass): 97721c1 + 8b291f8 fully satisfy the Specs. index.ts kanban_create passes { additionalProperties: false } to Type.Object with the #85 comment style (bf0621d); src/kanban.ts untouched; diff touches only index.ts and src/extension.test.ts. extension.test.ts asserts the schema flag, pi's validator (typebox Compile) rejecting an unsupported "notes" field with the additionalProperties keyword, all supported fields passing validation, and the create execute path returning the exact `Created <file> (#N)` response with the issuer written. Re-ran all four node suites green (extension, kanban, webui instant; orchestrator full smoke passed, >5 min). No fixes needed. No open questions.
- 2026-10-11 live test (real pi runtime, worktree fix/111-kanban-create-silently at 8b291f8): PASS, no issues. Ran the real pi CLI (`pi -ne -e <worktree>/index.ts`) in scratch git projects and let a real model call kanban_create, so each call passed through pi's own Convert plus Compile validation before execute.
  - Valid call (name plus summary): pi returned `Created 000001_live_valid_check.md (#1)`. The task file holds the expected frontmatter and Summary.
  - All supported fields (name, priority high, complexity complex, issuer #42, summary, specs, openQuestions, blockedBy #7): pi returned `Created 000001_all_supported_fields.md (#1)`. Every field was written to the file, including issuer, complexity, blockedBy, and the Open questions section.
  - Unsupported field (notes): pi rejected the call before execute with `Validation failed for tool "kanban_create": - notes: schema is false / - root: must not have additional properties`. No `Created` message appeared and no task file was made (the board still held only the valid task).
  - Control run against main index.ts (no additionalProperties): the same unsupported notes call returned `Created 000001_main_false_success.md (#1)`, made the file, and dropped the notes text. This confirms that the worktree change turns the false success into a rejection.
  - The unit suites were not run here (developer/reviewer gate). No open questions.
- 2026-10-11 merge (Merger): Step 1 merged main (654dbd3) into fix/111-kanban-create-silently in the worktree. Clean merge with the ort strategy, no conflicts. The auto-merge in index.ts kept both sides: the kanban_create additionalProperties fix and main's changes to kanban.ts, webui.ts, orchestrator.ts. Committed as 50c4833. Ran all four node suites in the worktree after the merge: extension, kanban, webui instant and green, orchestrator full smoke green. No fixes needed. Step 2 merged fix/111-kanban-create-silently into main in the project root (base branch resolved again as main). Fast-forward to 50c4833, clean, 2 files changed (index.ts, src/extension.test.ts). Both merges complete. No open questions.

# Open questions
