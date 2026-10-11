---
name: "docs: SKILL.md assigns complexity on task creation"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
skills/se-llm-team/SKILL.md never mentions assigning the complexity attribute when creating tasks. Add it to step 4 (values simple/moderate/complex, default moderate, consequences: reviewer-pass cap 1/2/3 and per-complexity LLM config), plus complexity in the Board section's frontmatter list.

# Specs
skills/se-llm-team/SKILL.md step 4 names every task-creation attribute (type prefix, priority, shortName) but never mentions complexity. Add complexity assignment to step 4: pass complexity on every kanban_create with one of simple, moderate, complex; omitting it writes the default "moderate". Guidance on choosing: simple for docs-only or single-file trivial changes, moderate for normal features and fixes, complex for multi-file or subsystem-wide changes. State the consequences so the PM picks correctly: the reviewer-pass cap keys off it (1 pass for simple, 2 for moderate, 3 for complex, overridable via the reviewerCap config key) and per-complexity LLM config (roles.<type>.<complexity>.<key>) overrides the role default. kanban_update changes complexity later with replace semantics. Also add "complexity" to the Board section's frontmatter attribute list on line 15 (currently "name, priority, state, worktree"). Match the file's terse bullet style. Files: skills/se-llm-team/SKILL.md only. No code, no tests, no other agent prompts.

# Notes
