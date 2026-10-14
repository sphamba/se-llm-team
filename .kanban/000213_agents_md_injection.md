---
name: "fix: preserve project AGENTS.md and inject it into agent sessions"
priority: "high"
state: "done"
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

Implemented in the worktree, committed as bfa8380 on fix/213-agents-md-injection.

- src/orchestrator/spawn.ts: ensureContextSymlinks marks a real (non-symlink) AGENTS.md skip-worktree in the worktree (git update-index --skip-worktree AGENTS.md, failure ignored, reusing the git() helper from board.ts) before the role-notes symlink replaces it. A real file is never deleted without the mark. The SPECS.md repoint is unchanged.
- src/orchestrator/spawn.ts: new projectAgentsPrompt reads <root>/AGENTS.md at every spawn, for all four roles. Exists and non-empty: its content rides as one --append-system-prompt argv element placed before -p, never shell-interpolated (it travels as a positional arg of the sh wrapper). Missing or empty: nothing is injected. Over 1,000,000 bytes (Buffer.byteLength): the injection skips, one warning line names the file and its size, the spawn continues.
- tests/orchestrator.test.ts: new part AX: fixture repo with a tracked AGENTS.md (force-added over the fixture's ignore rule so a worktree checkout carries a real file), a passive argv-recording stub, spawn setup driven by rescan: asserts git ls-files -v reports S (skip-worktree), git status --porcelain stays empty, the AGENTS.md symlink points at .kanban/AGENTS.developer.md, and the stub argv carries the exact content right after --append-system-prompt. A second task with a 1,000,001-byte AGENTS.md asserts the flag is dropped and the log line names the file and its size. Part AS's stale "the AGENTS.md cwd symlink replaces it" reason updated to the real one (no root AGENTS.md: nothing to inject); its no-flag assert stays as the missing-file case.
- docs/agents-and-tools.md: documents the two cwd symlinks, the injected repo-root AGENTS.md system prompt with its cap, and the skip-worktree marking. README untouched.
- npm test green: all five suites.

## Review (fix/213-agents-md-injection @ bfa8380)
- Re-verified against Specs 1-6 and the acceptance list in the worktree: all five suites re-run green (orchestrator including new part AX; kanban, webui, extension, index pass). The guard order is correct: the real file is marked skip-worktree before the repoint, so a tracked AGENTS.md is never deleted without the mark; an untracked real file still gets replaced (spec item 4 accepts this). All four roles get the injection through the role-generic spawnAgent; whitespace-only counts as empty; the SPECS.md repoint is unchanged; docs/agents-and-tools.md updated, README untouched.
- Confirmed open question 1 locally: a 131,000-byte single argv element passes, 132,000 fails with E2BIG; total ARG_MAX on this machine is 2,097,152. So the spec's 1,000,000-byte cap sits above the real kernel per-element limit (MAX_ARG_STRLEN = 131,072) and an AGENTS.md between ~128 KB and 1 MB would fail every spawn with E2BIG. Implementation kept at the spec value pending the user's answer.
- No unvoiced direction-affecting assumptions found; the three assumptions in Open questions match the code. Minor accepted edge, per the spec's chosen approach: the skip-worktree mark is never un-set after the symlinks clear. Harmless in practice (the done cleanup removes the worktree, and a rebase that must rewrite the marked path surfaces as a conflict the Merger already resolves).

## Live test (fix/213-agents-md-injection @ bfa8380)

Ran the merged daemon on a scratch git repo (`/tmp/t213/repo`, tracked root AGENTS.md, isolated HOME, argv-recording fake-pi, `--root --rescan-seconds 1 --poll-minutes 0.05 --no-webui`). Every spec item passed except the real argv limit below, which is open question 1.

- Injection: the developer spawn argv carried `--append-system-prompt` immediately followed by one argv element whose sha256 equals the root AGENTS.md (141 bytes; `$(echo NOPE)`, backticks, quotes and `$dollar` survived literally, no shell interpolation). Re-read at every spawn: a changed root file produced a new sha on the next spawn.
- Roles: reviewer and live-tester spawns carried the same exact injection. The merger reaches the same `spawnAgent` call (only `pidName` differs); no conflict fixture was built for it.
- Missing and whitespace-only root AGENTS.md: no flag, spawn continued (two tasks).
- Over the cap: 1,000,001 bytes logged exactly one line `skipping /tmp/t213/repo/AGENTS.md injection: 1000001 bytes is over the 1000000-byte argv cap`, dropped the flag, and the spawn continued (agent pid and argv recorded).
- Tracked worktree AGENTS.md: `git ls-files -v` reports `S AGENTS.md`, the file is replaced by the `.kanban/AGENTS.developer.md` symlink, `git status --porcelain -- AGENTS.md` is empty, the root copy is untouched, and a write through the worktree symlink lands in `.kanban/AGENTS.developer.md`.
- SPECS.md symlink unchanged (worktree `SPECS.md -> .kanban/000001_alpha.md`).
- `docs/agents-and-tools.md` documents both cwd symlinks, the injected prompt and the skip-worktree mark; README has no mention.

Finding (confirms open question 1 live): a root AGENTS.md between about 131,072 and 1,000,000 bytes is under the cap, so every spawn passes it as one argv element and fails with `spawn E2BIG`. At 200,000 bytes no agent started and the daemon looped `error handling 000005_epsilon.md (to-do): spawn E2BIG` and `000005_epsilon: agent pid=0 dead without state update, doing -> to-do`. The cap needs to drop to about 131,000.

# Open questions

Assumptions (confirm or correct):
- The injected file is the AGENTS.md at the project root the daemon runs at (--root), read fresh at every spawn, and every role gets it.
- A whitespace-only AGENTS.md counts as empty (nothing injected).
- The AGENTS.md symlink behavior (role notes, write-through) is unchanged; only the destructive replacement of a real file is guarded.

Questions:
1. The kernel rejects a single argv element over 131,072 bytes with E2BIG (MAX_ARG_STRLEN, tested: 131,000 passes, 132,000 fails), so the spec's 1,000,000-byte cap sits above the real per-argument limit. An AGENTS.md between 128 KB and 1 MB would make every spawn fail (agent never starts, the task stalls and retries). Keep the spec's 1,000,000 cap, or lower it to about 131,000 so the spawn always continues? Implemented the spec value for now.
