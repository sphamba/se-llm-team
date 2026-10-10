---
name: "feat: 10s daemon scan and an orchestrator_poke tool for the Project Manager"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Cut the daemon rescan default from 30s to 10s, and give the PM a poke tool that triggers an immediate scan and agent scheduling by touching .kanban/.poke, which the daemon's existing fs.watch turns into a sweep.

# Specs
# Need

1. The daemon rescan interval drops from every 30 seconds to every 10 seconds (default when --rescan-seconds is not given).
2. The PM gets a tool to poke the daemon for an immediate scan and agent scheduling.

# Facts

- src/orchestrator.ts:271: `const rescanSeconds = args.rescanSeconds ?? 30;`
- The daemon watches .kanban/ with fs.watch (src/orchestrator.ts:302) and debounce-sweeps ~500ms after any change (scheduleSweep, :283). So a poke can be a file touch with no new daemon loop and no new config.
- index.ts (repo root) registers the tools; orchestrator_status/stop read the lock via readPid (:207).

# Required behavior

1. src/orchestrator.ts:271: default rescanSeconds 30 → 10.
2. New tool "orchestrator_poke" in index.ts, next to the other orchestrator tools:
   - Params: none. Description: "Poke the se-llm-team orchestrator daemon to trigger an immediate scan and agent scheduling."
   - Creates or touches .kanban/.poke (openSync("a") + closeSync). The daemon's fs.watch turns it into a sweep within ~1s; the sweep schedules agents (startTodo for to-do tasks, done bookkeeping, and so on).
   - Reads the daemon pid (readPid): with a daemon running → return "Poked the orchestrator (pid N). Scan starts within a second." Without → return "No orchestrator daemon running for this project."
3. Add .kanban/.poke to .gitignore so it never appears in git status and never gets committed.
4. README.md: one line for the poke tool, and update any mention of the 30s scan interval.

# Constraints

- Minimal diff. No new dependencies. No new daemon loop, no new config key.
- Keep the tool contracts of the existing tools unchanged.

# Acceptance criteria

- `node src/kanban.test.ts && node src/orchestrator.test.ts` pass.
- With no --rescan-seconds flag, the daemon start log prints rescan=10s.
- A touch of .kanban/.poke on a running daemon produces a sweep within ~1s (visible in the daemon log, or a to-do task gets a spawn).
- The poke tool returns the pid text as specified.

# Notes
