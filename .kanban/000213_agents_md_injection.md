---
name: "fix: preserve project AGENTS.md and inject it into agent sessions"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "agents-md-injection"
---

# Summary
Stop repointContextSymlink from destroying a target project's tracked AGENTS.md, and inject the repo-root AGENTS.md content into every agent session so project instructions reach agents alongside the role-notes symlink.

# Specs
# Context

Role prompts live in agents/<role>.md and are re-read at every spawn. Per-role project notes live at .kanban/AGENTS.<role>.md. ensureContextSymlinks (src/orchestrator/spawn.ts) repoints two cwd symlinks at every spawn: <worktree>/SPECS.md -> .kanban/<taskFile> and <worktree>/AGENTS.md -> .kanban/AGENTS.<role>.md. repointContextSymlink treats a real (non-symlink) AGENTS.md as a stale link: it deletes it and symlinks over it, so a target project's own tracked AGENTS.md is destroyed in the worktree and no test covers it.

pi loads one context file per directory from candidates AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md (first hit wins) and shadows the main-repo context file whose directory+basename matches the worktree's loaded file, so with the role-notes symlink at AGENTS.md the project's own instructions never reach agents. The user chose injection over the override-slot rename so agents keep editing plain AGENTS.md in their cwd.

# Required behavior

1. Keep the <worktree>/AGENTS.md -> .kanban/AGENTS.<role>.md symlink unchanged. Agents edit AGENTS.md in their cwd and the edit lands in the role-notes master (write-through stays).
2. At every spawn, read <repoRoot>/AGENTS.md. When it exists and is non-empty, pass its content to the spawned agent as --append-system-prompt <content> via execFileSync argument arrays (the content is one argv element, never shell-interpolated). When it is missing or empty, pass nothing. Every role gets the injection.
3. Cap the injection at 1,000,000 bytes: above that, skip it, log one warning line naming the file and its size, and continue the spawn (Linux argv limit is near 2 MB).
4. Before repointing <worktree>/AGENTS.md, when the path is a real file, run git update-index --skip-worktree AGENTS.md in the worktree and ignore failure (an untracked file), so the symlink replacement leaves git status clean. A real file must never be deleted without the skip-worktree mark. Follow the existing skip-worktree pattern in src/orchestrator/board.ts.
5. Do not change the SPECS.md symlink behavior.
6. Docs: update docs/agents-and-tools.md to describe the two cwd symlinks plus the injected repo-root AGENTS.md system prompt. Do not add this to README.md.

# Acceptance

- node tests/orchestrator.test.ts passes, including a new case: fixture repo with a tracked AGENTS.md; assert git status stays clean after spawn setup, the AGENTS.md symlink is created, and the stub agent argv contains the project AGENTS.md content after --append-system-prompt.
- node tests/kanban.test.ts passes.
- node tests/webui.test.ts passes.
- node tests/extension.test.ts passes.
- node index.test.ts passes.

# Notes
