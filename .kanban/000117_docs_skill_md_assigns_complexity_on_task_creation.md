---
name: "docs: SKILL.md assigns complexity on task creation"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
skills/se-llm-team/SKILL.md never mentions assigning the complexity attribute when creating tasks. Add it to step 4 (values simple/moderate/complex, default moderate, consequences: reviewer-pass cap 1/2/3 and per-complexity LLM config), plus complexity in the Board section's frontmatter list.

# Specs
skills/se-llm-team/SKILL.md step 4 names every task-creation attribute (type prefix, priority, shortName) but never mentions complexity. Add complexity assignment to step 4: pass complexity on every kanban_create with one of simple, moderate, complex; omitting it writes the default "moderate". Guidance on choosing: simple for docs-only or single-file trivial changes, moderate for normal features and fixes, complex for multi-file or subsystem-wide changes. State the consequences so the PM picks correctly: the reviewer-pass cap keys off it (1 pass for simple, 2 for moderate, 3 for complex, overridable via the reviewerCap config key) and per-complexity LLM config (roles.<type>.<complexity>.<key>) overrides the role default. kanban_update changes complexity later with replace semantics. Also add "complexity" to the Board section's frontmatter attribute list on line 15 (currently "name, priority, state, worktree"). Match the file's terse bullet style. Files: skills/se-llm-team/SKILL.md only. No code, no tests, no other agent prompts.

# Notes
- Verified all spec facts in code before writing: DEFAULT_REVIEWER_CAP {simple: 1, moderate: 2, complex: 3} overridable via the top-level reviewerCap key (src/orchestrator.ts:30-33), per-complexity roles sub-objects overriding role defaults (src/orchestrator.ts:52-56), default complexity "moderate" (src/kanban.ts:125), kanban_update replaces complexity (src/kanban.ts:261).
- Edited skills/se-llm-team/SKILL.md only: step 4 now ends with the complexity assignment guidance (values, default, choosing guidance, reviewer-pass cap, per-complexity LLM config, kanban_update replace semantics); Board section frontmatter list now reads (name, priority, complexity, state, worktree).
- Committed as 42017e3 on docs/117-skill-md-assigns. Docs-only change; ran node src/kanban.test.ts as a sanity check, all assertions passed.

## Review (reviewer)

- Verified the diff against the Specs: step 4 carries all required elements (values, default moderate on omission, choosing guidance, reviewer-pass cap 1/2/3 overridable via reviewerCap, per-complexity roles.<type>.<complexity>.<key> LLM config, kanban_update replace semantics); Board frontmatter list includes complexity.
- Re-verified facts in code: DEFAULT_REVIEWER_CAP {simple: 1, moderate: 2, complex: 3} + top-level reviewerCap override (src/orchestrator.ts:31-33, 107-116), roles.<type>.<complexity>.<key> (README.md:38, src/orchestrator.ts:50-54), default complexity "moderate" (src/kanban.ts:125), replace semantics (src/kanban.ts:261).
- Scope and style correct: only skills/se-llm-team/SKILL.md changed, terse style matches. node src/kanban.test.ts passed.
- No fixes needed.

## Live test (live-tester)

Docs-only change; no code path to exercise end to end. Verified every factual claim in the new SKILL.md text against the real kanban/orchestrator interface (node, temp project dir, no unit suites):

- Board frontmatter: kanban_create writes `complexity` into the frontmatter (verified in the parsed and raw file). Step 4 text and the Board list match the tool schema (index.ts exposes `complexity` on kanban_create and kanban_update as simple/moderate/complex).
- Default and values: omitting complexity writes `moderate`; explicit `simple` and `complex` are honored; an invalid value falls back to `moderate`. All four cases matched the doc.
- kanban_update replace semantics: changing moderate -> complex -> simple leaves the last value only, never accumulates.
- reviewer-pass cap: loadConfig default is `{simple: 1, moderate: 2, complex: 3}`; a temp `.kanban/se-llm-team.json` with `reviewerCap: {simple: 5, complex: 7}` yields `{simple: 5, moderate: 2, complex: 7}`, so the documented override works.
- per-complexity LLM config: a config `roles.developer.moderate.model` loads as `roles.developer.moderate.model = "mod-model"` while the role default stays unset, matching `roles.<type>.<complexity>.<key>` overrides the role default.

Result: PASS. All documented behavior matches the code. No user-facing issues found. Note: the 113 existing board files carry no `complexity` attribute (parseTask defaults them to moderate), so only newly created tasks will show it in the frontmatter, as the doc implies.

## Merge (merger)

- Step 1: merged main into docs/117-skill-md-assigns in the worktree; clean merge (ort strategy), no conflicts, no fixes needed. Test suites skipped per clean-merge rule.
- Step 2: merged docs/117-skill-md-assigns into main at the project root; fast-forward from 0ac94ce to ced7e55, clean, no conflicts.
- Final state: main at ced7e55 carries the SKILL.md change (42017e3); both worktree and root clean.
