---
name: "fix: kanban_update silently ignores an unsupported parameter and reports success"
priority: "medium"
state: "live-testing"
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
- [2026-10-11 17:20] Root cause confirmed at the runtime level: pi validates tool arguments with `Convert` then `Compile(schema).Check` (typebox, agent loop bundle). With the old schema, Convert keeps unknown keys and Check passes them (JSON Schema allows additional properties), so `notes` reached execute, updateTask ignored it, and the tool claimed an update.
- [2026-10-11 17:20] Fix (index.ts, commit bf0621d in the worktree): (1) kanban_update parameters now carry `additionalProperties: false`, so pi rejects an unrecognized field with "Validation failed for tool \"kanban_update\": - notes: must not have additional properties" before execute runs; (2) execute returns "Nothing to update in <file>" when the patch has no recognized field (only file given), instead of a false "Updated". updateTask's empty-patch no-op in src/kanban.ts is untouched per the specs.
- [2026-10-11 17:20] New src/extension.test.ts loads the real index.ts with plain node by registering a resolve hook that mirrors pi's own loader aliases (typebox and @earendil-works/pi-ai resolve inside pi's install), captures the registered tools through a fake pi object, and asserts: the schema carries additionalProperties false, the validator pi runs before execute (typebox Compile) fails unknown-field and mixed calls, an empty patch does not touch the file and says so, and a recognized field keeps the "Updated <file> (#NN)" response. Skips with a message when pi's install is absent (extension-loading convention, 000015).
- [2026-10-11 17:20] Checks: node src/extension.test.ts, node src/kanban.test.ts, node src/webui.test.ts and the full node src/orchestrator.test.ts (all parts) pass. Ad hoc strict tsc (TypeScript 5.9.3 from another checkout, @types/node, nodenext): the error profile of index.ts is identical to the base commit d93e444; the new test file adds exactly one TS2307 for the dynamic import of typebox/compile, the same unavoidable no-node_modules class as index.ts's three pre-existing TS2307s (deps resolve at runtime via pi).
- [2026-10-11 17:16] Review: fix verified against the specs. Controlled base/head tsc comparison (tsc 5.9.3 strict, @types/node 24.10.1, nodenext, type: module, identical toolchain for both) confirms the index.ts error profile is identical to d93e444; the new test file adds one TS2307 (typebox/compile) and two TS5097 (.ts import path) errors, the same unavoidable no-node_modules and .ts-import class as index.ts's three pre-existing TS2307s and the other test files' TS5097s. Correction to the Notes above: pi's rejection message is not "- notes: must not have additional properties". The actual errors are "- root: must not have additional properties" and "- notes: schema is false" (verified with the real typebox Compile from pi's install against the registered schema). The behavior matches the specs: the call errors before execute and claims no update. Also verified at the runtime level: pi passes the null-normalized, converted args to execute, so the v !== undefined guard in kanban_update is sound. Checks re-run in this review: node src/extension.test.ts, node src/kanban.test.ts, node src/webui.test.ts pass, node src/orchestrator.test.ts passes in full (an earlier run hit a pre-existing real-timer flake in part R, ENOENT on a task file that part created; orchestrator.ts and orchestrator.test.ts are byte-identical to main and the branch does not touch them, so the flake is not caused by this branch).
