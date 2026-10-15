---
name: "refactor: analyst and doctor prompts as editable markdown files"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "analyst-doctor-prompt-files"
---

# Summary
Move the two inline analysis prompts out of src/efficiency-analysis.ts into editable agents/analyst.md and agents/doctor.md with placeholder substitution, so the prompts can be tuned without code changes. The files are required: a missing file fails the analysis step, logged, pipeline unaffected.

# Specs
# Goal
Replace the inline prompt builders in src/efficiency-analysis.ts (analystPrompt at L320, doctorPrompt at L350) with editable markdown files agents/analyst.md and agents/doctor.md at the repo root, following the agents/<role>.md convention, with dynamic parts injected as placeholders. The files are the only prompt source: a missing file fails the analysis step.

# Current state (verified 2026-10-15)
- src/efficiency-analysis.ts: analystPrompt(block, leadIns) at L320 builds the pass-1 prompt (block type, tool name, content capped at 8,000 chars BLOCK_CAP, merged lead-ins capped at 8,000, asks for "Summary:"/"Struggle:" lines); doctorPrompt(blocks, reports, failedCount, mergedCount, roleFile?, role?) at L350 builds the pass-2 prompt (stats, numbered block summaries, the absolute role-file path, pain-point + revision instructions). Call sites: callWithRetry(buildArgs(analystPrompt(...))) at L528 and runDoctor(buildDoctorArgs(doctorPrompt(...))) at L547.
- analyseLog opts (AnalyseOptions L28-37) carry agent/backend/llm/concurrency/mergeThreshold/roleFile/role; the engine has no repo-root access today — callers know the root (src/tools.ts L312 passes it via resolve(root, ...); the orchestrator's post-success hook likewise).
- The manual efficiency_analysis tool (src/tools.ts L294-318) calls analyseLog with no role/roleFile. The orchestrator hook passes the analysed run's role and role file.
- A failing analysis must never affect the pipeline (best-effort, #222 constraint).

# Requirements
1. New files agents/analyst.md and agents/doctor.md at the repo root, holding the CURRENT prompt scaffolds verbatim (static text only), with the dynamic parts as {{placeholder}} tokens. Behavior is otherwise unchanged: same prompts except the deliberate combined doctor scaffold (decided 2026-10-15 in #228: the none-parenthetical stays unconditionally present, including with a role file, and the no-roleFile revision paragraph stays as shipped), same caps, same instructions.
2. Placeholder contract:
   - agents/analyst.md: {{blockType}} (text|thinking|toolCall), {{toolName}} (empty string for non-tool blocks), {{blockContent}} (block text capped at 8,000 chars), {{leadIns}} (merged lead-in context capped at 8,000, empty string when none).
   - agents/doctor.md: {{stats}} (block counts by type, tool calls per tool, merged count, error count), {{reports}} (the numbered block-summary list, byte-budgeted as today), {{failedCount}}, {{mergedCount}}, {{roleFile}} (absolute path of the role file, or the literal "none"), {{role}}.
   - Substitution is plain replacement of the known placeholders; an unknown placeholder stays literal text. When {{roleFile}} is "none" the doctor must not write any file.
3. The files are required: the engine reads both files once per analysis run (at analyseLog start, before any LLM call); a missing or unreadable file fails the analysis with a clear message naming the path (no inline fallback). The orchestrator hook logs the failure and continues; the manual tool returns "Cannot analyse <path>: <msg>".
4. Plumbing: analyseLog opts gain the repo root (e.g. opts.root or a promptDir equivalent); the callers (src/tools.ts, the orchestrator post-success hook) pass it. The engine resolves <root>/agents/analyst.md and <root>/agents/doctor.md.
5. The files ship with the repo like the other agents/*.md role prompts; nothing writes to them at runtime (the doctor rewrites .kanban/AGENTS.<role>.md, never agents/*.md).

# Constraints
- The analyst/doctor spawn argv (tests/efficiency-analysis.test.ts asserted) must not change; only the prompt source moves.
- No daemon restart needed for prompt edits: the engine reads the files per analysis run.
- The existing roles.analyst/roles.doctor llm config keys, concurrency, mergeThreshold, and retry behavior are untouched.

# Acceptance
- The prompts load from agents/analyst.md and agents/doctor.md with placeholder substitution; a missing or unreadable file fails the analysis with a clear message naming the path before any LLM call, including the manual-tool error path.
- The analyst/doctor spawn argv stays unchanged.
- The post-run hook logs a failed analysis and continues; a failing analysis never affects the pipeline.

# Notes

Implemented as e424cd3 plus 8663c3c in the worktree refactor/224-analyst-doctor-prompt-files:

- Shipped agents/analyst.md and agents/doctor.md with {{placeholder}} tokens. Substitution is a single-pass renderTemplate: known placeholders replaced, unknown ones stay literal text, substituted values never re-scanned.
- The analyst template carries {{blockIndex}} beyond the spec's four tokens: the current prompt names the block number (pinned by the spawn-argv test asserting "Block 1 of type thinking"), and the four placeholders alone cannot render it. {{toolName}} substitutes a leading-space value (" read") so it joins the raw type into the header label, and the empty string otherwise.
- The doctor template is one combined scaffold, not two variants: without a roleFile, {{roleFile}} and {{role}} substitute to the literal "none" and the prompt tells the doctor not to write any file. The none-parenthetical is always present, including with a role file, so the doctor prompt is not byte-identical to the old builders (the analyst prompt is).
- analyseLog reads both files once per run at start, before any LLM call; a missing or unreadable file fails the analysis with the path named, no inline fallback. opts.root is optional and defaults to the package's own agents dir (the renderPrompt precedent in src/orchestrator/spawn.ts), so the existing test call sites pass no root and src/tools.ts plus src/analysis-run.ts change by one line each.
- src/tools.ts passes the session cwd, so the manual tool resolves prompts per project: a project without agents/analyst.md gets "Cannot analyse <path>: <msg>" naming the missing file. src/analysis-run.ts passes the package root, so unattended hook analyses always find the shipped files and the orchestrator plus webui suites pass unchanged.
- The doctor block-summary list is budgeted against the rendered template under PROMPT_CAP 131000: render with {{reports}} left literal, split at the token, keep whole entries, marker when cut, no injection when the token is absent.
- Tests extended in tests/efficiency-analysis.test.ts: testPromptFileSubstitution (per-root template, unknown placeholder stays literal, toolName empty for non-tool blocks), testMissingPromptFileFails (no LLM call, no report on a failed load, both files), testManualToolErrorPath; testDoctorPromptWithoutRoleFile updated for the none semantics. Efficiency-analysis, orchestrator, webui, extension and mcp suites pass.
- Pre-existing fix in the same worktree: de1b859 reworded agents/merger.md but left the part AL assertion on the old "never run test suites" wording, so tests/orchestrator.test.ts failed at HEAD independently of this task. The stale assertion now checks the new "run the full test suite in your worktree" contract.

# Notes extra: review pass (2026-10-15)

- Verified e424cd3 + 8663c3c against the Specs. No fixes needed. All five requirements hold: the files ship at agents/, the placeholder contract is met, unknown placeholders stay literal, both files are required and read once per run at analyseLog start before any LLM call (failure names the path, no inline fallback), opts.root reaches both callers, and nothing writes agents/*.md at runtime. renderPrompt serves only the developer, merger, reviewer and live-tester roles, so the two new files collide with no role prompt.
- The stats split in the doctor template ({{stats}} holds the block counts and per-tool counts, the merged and error counts sit on their own lines with their own tokens) matches the spec token list and keeps the rendered prompt byte-identical to the old builders.
- Suites run: efficiency-analysis, mcp, extension and orchestrator all pass (orchestrator exit 0, run twice; part AT2 in it exercises the real hook path). Webui was not run: it imports neither efficiency-analysis, tools.ts nor analysis-run and spawns no real analysis, so no part of it covers this change.
- The six Assumptions below stand as recorded. The one to confirm first is the hook's package-root prompt resolution: per-project prompt tuning then works only through the manual tool, or by editing the package files.

# Notes extra: live test (2026-10-15)

Live test of e424cd3 + 8663c3c, run from the merged worktree. Fixture: /tmp/lt224, a project with the two prompt files carrying markers, a fake pi CLI as the project agent that records every invocation (script, argv, full -p prompt) as JSONL and answers in pi shape. Evidence: /tmp/lt224/evidence-final.txt. 64 scripted checks passed, plus the real-session checks below. No code was edited. The worktree is clean and both shipped prompt files kept their bytes (sha256 checked before and after).

- Phase 1, the manual efficiency_analysis tool handler (36 checks): templates are read from the fixture project's agents/, all placeholders substitute (block header "Block 1 of type text." and "Block 3 of type toolCall read.", content, tool arguments and result, lead-ins, doctor stats/reports/failedCount/mergedCount/roleFile/role), an unknown {{nope}} token stays literal, substituted text is never re-scanned, block content is cut at 8,000 chars, no shipped placeholder stays unsubstituted, a template edited between two runs in the same process is picked up by the next run (no restart), and a missing analyst.md or doctor.md returns "Cannot analyse <path>: ENOENT ... '<root>/agents/<file>'" (analyst first) with no LLM call and no report.
- Phase 2, real user flow: a real `pi -p` session ran tool_search then efficiency_analysis on the fixture run log and returned the analysis, the report path and "Blocks analysed: 3"; the fake agent recorded 3 analyst plus 1 doctor call. A real `pi --mode rpc` session then called the tool twice with the fixture template edited between the turns: the first turn's 3 analyst prompts carry marker V1 and the second turn's 3 carry V2, so prompt edits need no session or daemon restart.
- Phase 3, the detached orchestrator hook entry (20 checks): `node src/analysis-run.ts` exits 0 and uses the package's shipped prompts (not the fixture project's), passes the absolute role file path and the role to the doctor, the doctor rewrites .kanban/AGENTS.developer.md, and the run leaves the report plus the doctor stream log next to the run log. With a missing package prompt file the runner exits 1, makes no LLM call, writes no report and no doctor log, and appends one failure line naming the path to orchestrator.log.
- Phase 4, differential against the pre-change builders (8 checks): the analyst prompts are byte-identical, and the analyst and doctor spawn argvs are byte-identical to the old code.
- The doctor prompt is not byte-identical to the old builder on the hook (roleFile) path: agents/doctor.md always carries the parenthetical " (a role file of none means there is no role file: do not write any file, produce the report only)", and without a role file the revision paragraph is longer than the old report-only one-liner. This is the deviation already recorded in the review-pass Notes and in assumption 2, but it contradicts requirement 1 ("same prompts") as written. This is live-test finding 1; the open question is below.
- Live-test finding 2 (pre-existing mechanism, new trigger): a failed analysis respawns on every to-merge sweep while the task stays in to-merge, because the runner leaves no report and no doctor log and removes its pid. Three direct spawnRunAnalysis calls produced three "spawned analysis pid=" lines and three ENOENT failure lines; the same loop exists in the pre-change code for another early failure (a corrupt .gz log gives three spawns and three "incorrect header check" lines), so this is not a regression. The Specs claim itself holds: the failure is logged and the pipeline continues. The new required-file rule just makes the trigger easy to reach.

Assumptions made while designing the tests: the two prompt files are the only prompt source (proved by editing them between runs); the manual tool resolves prompts from the session project's root while the hook resolves them from the package root (both exercised); "no LLM call" is read from the fake agent's empty call ledger; and the fixture's unknown {{nope}} token (plus a block whose text is the literal string "{{leadIns}}") is a safe probe for literal-pass and no-rescan behavior. The live test did not run a full daemon end to end (the daemon's spawnRunAnalysis call site is untouched by this task); the detached hook entry was run directly, and finding 2's re-fire behavior was reproduced by calling spawnRunAnalysis itself.

# Open questions

Assumptions (confirm or correct before the choice hardens):

- The prompt files resolve from a repo root (opts.root), not from the agent cwd; the default is the package's own agents dir.
- One combined doctor template is acceptable: the none-parenthetical appears in both variants, and the no-roleFile prompt grows beyond the old report-only one-liner. Confirmed 2026-10-15 (#228): accepted and recorded in requirement 1.
- {{role}} substitutes to the literal "none" when no role file is given, even when the analysed run has a role.
- The manual efficiency_analysis tool needs agents/analyst.md and agents/doctor.md in the session project to work; other projects copy the two files to tune their prompts.
- The orchestrator hook analyses always use the shipped package prompts, never a per-project agents dir, because a per-project lookup would fail every unattended analysis for projects without the files.
- A prompt-load failure aborts the analysis entirely (no report), matching the no-inline-fallback requirement.