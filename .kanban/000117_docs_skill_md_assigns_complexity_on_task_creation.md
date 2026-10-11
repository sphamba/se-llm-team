---
name: "docs: SKILL.md assigns complexity on task creation"
priority: "medium"
state: "live-testing"
worktree: "docs/117-skill-md-assigns"
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
