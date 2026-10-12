---
name: "docs: README stale-daemon pkill example misses flags before --root"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#167"
complexity: "trivial"
shortName: "readme-pkill-example"
---

# Summary
The README.md Web dashboard hygiene step (around line 97, from #167) documents a `pgrep -af orchestrator.ts` filter plus the copy-paste example `pkill -f 'orchestrator.ts --root .*/\.worktrees'`. The prose step catches a stale pre-#165 hub-aware worktree daemon, but the example pattern does not when another flag sits between `orchestrator.ts` and `--root` (e.g. `--rescan-seconds 5`), so a user who runs only the example silently under-cleans and such a daemon can steal the production port at the next restart. Fix: widen the example to `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'`.

# Specs
## Finding (reproduced in the #167 live test, 2026-10-12)

The doc change in #167 is README.md around line 97 (Web dashboard section). It documents a one-time hygiene step for stale pre-#165 hub-aware worktree daemons: run `pgrep -af orchestrator.ts` and kill each process whose `--root` contains `.worktrees` (for example: `pkill -f 'orchestrator.ts --root .*/\.worktrees'`; the pattern does not match a daemon at the project root).

The prose instruction works. The copy-paste example does NOT catch a stale daemon whose command line has another flag between `orchestrator.ts` and `--root`.

Reproduction (isolated fixture, real pre-#165 code at 7ecec18):

- Daemon started as `node <oldcheckout>/src/orchestrator.ts --rescan-seconds 5 --root <repo>/.worktrees/old-probe2`.
- `pgrep -af orchestrator.ts` lists it; the prose filter finds it (its `--root` contains `.worktrees`).
- `pgrep -af 'orchestrator.ts --root .*/\.worktrees'` returns NO match, so the example's pkill would have left it alive.
- That daemon is pre-#165 hub-aware and would steal the port at the next production restart — exactly the residue this task set out to document away. A user who runs only the example silently under-cleans.

The shape is real: `--rescan-seconds`/`--poll-minutes` before `--root` is accepted by parseArgs (src/orchestrator.ts:159).

## Acceptance

- README.md's Web dashboard hygiene example uses the widened pattern `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'`.
- The widened pattern is verified to match both stale shapes (with and without flags between `orchestrator.ts` and `--root`) and still to match neither production daemon (real and fixture, where `--root` is a project root).
- The prose step stays as is; only the example pattern is corrected.
- Docs-only: no code changes.

## Out of scope

#168 (hub candidacy detection is path-based so a worktree outside .worktrees stays hub-eligible) — that is about detection when a worktree lives outside .worktrees, not about the README pkill pattern being too narrow for a worktree still under .worktrees.

# Notes
