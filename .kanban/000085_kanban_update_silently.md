---
name: "fix: kanban_update silently ignores an unsupported parameter and reports success"
priority: "medium"
state: "doing"
worktree: "fix/85-kanban-update-silently"
---

# Summary
kanban_update returns "Updated <file> (#NN)" even when no field was recognized, so an unsupported parameter (e.g. notes) is silently dropped and an LLM caller can believe it wrote data when it did not. Reject unknown fields or report that nothing changed. Pre-existing; found in the live test of 000071.

# Specs
kanban_update silently ignores an unsupported parameter and still reports success.

Repro:
- Call the kanban_update tool with a valid task file and an unrecognized parameter, e.g. file = <some task file>, notes = "anything".
- The registered schema has only file, name, priority, summary, specs (index.ts, kanban_update registration, ~line 77-95). notes is not part of it.
- The tool returns "Updated <file> (#NN)", but the file does not change and its # Notes section stays unchanged.
- This actually happened during the live test of task 000071: the caller believed it had written Notes and it had not.

Cause:
- index.ts kanban_update execute always returns text(`Updated ${task.file} (#${taskNum(task.file)})`) after calling updateTask(ctx.cwd, task, params). Unrecognized params are dropped by the schema/serialization layer, so the patch passed to updateTask has no recognized fields.
- updateTask (src/kanban.ts:219) treats an empty patch as a no-op on purpose (validated in task 000027's review: "an empty patch is a no-op"). That library behavior is fine; the gap is entirely tool-level: no validation of unknown fields and an unconditional success response.

Expected behavior (either approach is acceptable):
- Reject an unknown field (e.g. schema strictness with additionalProperties: false, or an explicit unknown-key check that returns an error naming the field), or
- Return an explicit "nothing changed" message (e.g. "Nothing to update in <file>") when the patch contains no recognized field, instead of claiming an update.

Impact: an LLM caller can believe it wrote Notes (or any field outside the schema) when it did not — a silent false success on a write tool. It already misled a caller once (live test of 000071).

Likely fix location: index.ts, kanban_update tool registration. Do NOT change updateTask's intentional empty-patch no-op in src/kanban.ts (documented as intended in task 000027).

Acceptance:
- A kanban_update call with only file plus an unrecognized field no longer claims a successful update; it either errors or reports that nothing changed.
- Calls with recognized fields keep the current "Updated <file> (#NN)" response.
- Cover the tool-level behavior with a test to the extent the extension-loading convention allows (tools load from the main checkout; see 000015 and the README live-test convention).
- Typecheck and the existing suites stay green.

Provenance: surfaced by the live test of task 000071 (which PASSED; this is a separate pre-existing issue, not caused by that feature).

# Notes
