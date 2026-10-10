---
name: "docs: role agents get extension tools from the main checkout, so new tools are invisible until merge"
priority: "low"
state: "done"
worktree: ""
---

# Summary
Role agents run in worktrees but pi loads the se-llm-team extension from the global symlink ~/.pi/agent/extensions/se-llm-team, which resolves to the main checkout, so tools added on an unmerged branch are invisible to role agents until merge. Document this gap (or make the extension load path follow the worktree) so live-testers of new tools know to verify via fixtures and code inspection instead of invoking the tool.

# Specs
Found by the live-tester of task 000007: it could not invoke orchestrator_poke (the tool did not exist in its session) and had to fall back to code inspection and fixtures.

Cause: role agents run in worktrees, but pi loads the se-llm-team extension from the global symlink ~/.pi/agent/extensions/se-llm-team, which resolves to the main checkout. Tools added on an unmerged branch are invisible to role agents until the branch merges.

Need: document this gap so live-testers of new tools know to verify them with fixtures and code inspection instead of invoking the tool.

Constraints:
- Target README.md: add one short section (a few sentences), placed after the existing Orchestrator section.
- Do not edit skills/se-llm-team/SKILL.md or agents/*.md in this task (task 000014 owns them in this round).
- Documentation only; no code changes.

Acceptance:
- README.md states the load-path gap and tells live-testers how to verify new tools until the branch merges.
- No other files change.

# Notes
Discovered by the live-tester of task 000007, which could not invoke orchestrator_poke and fell back to code inspection and fixtures.

Added a short "## Extension load path" section to README.md, directly after the Orchestrator section. It states that role agents run in task worktrees while pi loads the extension from the global symlink ~/.pi/agent/extensions/se-llm-team/, which resolves to the main checkout, so tools added on an unmerged branch are invisible to role agents until merge. It tells live-testers of new tools to verify with fixtures and code inspection instead of invoking the tool. README.md is the only file changed (commit e7d2022).

Review (commit e7d2022): pass, no fixes. Verified the section is directly after the Orchestrator section, states the load-path gap and the fixture/code-inspection fallback, and matches the Setup section (global symlink resolves to the main checkout). Diff touches only README.md (4 insertions), no SKILL.md or agents/*.md edits, no code changes. Worktree clean.

Live test (commit e7d2022): pass, no issues. Verified every claim in the new section against the live system: readlink -f ~/.pi/agent/extensions/se-llm-team resolves to /home/phamba/repos/se-llm-team (main checkout); this Live-tester session itself runs with cwd inside .worktrees/docs/..., confirming role agents run in task worktrees; no per-project .pi/extensions/ exists in the repo, so nothing shadows the global symlink. Section is placed directly after the Orchestrator section, before Web dashboard, and the fixture/code-inspection advice matches the repo's real test approach (fixture() in src/orchestrator.test.ts, node src/kanban.test.ts). The related branch fix/main-entry-guard-fails-under-symlinked-extension-so-the-spawned-daemon-never-runs has no commits beyond main, so no contradiction with the doc. Smoke test: node src/kanban.test.ts and node src/orchestrator.test.ts both pass from the worktree. Acceptance met: README.md states the load-path gap and the fallback, only README.md changed (4 insertions).
