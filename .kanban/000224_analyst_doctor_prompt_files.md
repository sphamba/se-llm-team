---
name: "refactor: analyst and doctor prompts as editable markdown files"
priority: "medium"
state: "doing"
worktree: "refactor/224-analyst-doctor-prompt-files"
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
1. New files agents/analyst.md and agents/doctor.md at the repo root, holding the CURRENT prompt scaffolds verbatim (static text only), with the dynamic parts as {{placeholder}} tokens. Behavior is otherwise unchanged: same prompts, same caps, same instructions.
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
- node tests/efficiency-analysis.test.ts passes (extend: prompts load from the two files with placeholder substitution, a missing file fails the run with a clear message before any LLM call, the manual-tool error path, and the unchanged argv).
- node tests/orchestrator.test.ts and node tests/webui.test.ts pass unchanged (the hook logs a failed analysis and continues).

# Notes
