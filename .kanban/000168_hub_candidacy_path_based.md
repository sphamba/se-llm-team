---
name: "fix: hub candidacy detection is path-based so a worktree outside .worktrees stays hub-eligible"
priority: "low"
state: "done"
worktree: ""
issuer: "#165"
complexity: "simple"
shortName: "hub-candidacy-path-based"
---

# Summary
Hub candidacy is detected with splitWorktreeRoot looking for a .worktrees path segment. A daemon rooted at a git worktree created outside .worktrees (e.g. git worktree add /tmp/x) treats itself as production and can bind the port. Either accept and document the path-segment rule or switch detection to git worktree topology.

# Specs
Found in the live test of #165 (fix merged at fa7f502; harness was an isolated scratch clone at that commit with an isolated HOME, webUi on 127.0.0.1:4488, SE_LLM_TEAM_HUB_HEALTH_MS=500).

## Problem

Candidacy detection is path-based: splitWorktreeRoot looks for a .worktrees path segment. A new-code daemon rooted at a git worktree placed outside .worktrees (git worktree add /tmp/x) treated itself as production and bound the port ("web ui on ... (hub for wt-outside)").

## Impact

The orchestrator always creates task worktrees under .worktrees, so the real-world impact is small (severity: low), but the #165 decision wording says "qualifying daemons are any that are not a task worktree", and this class of worktree is one.

## Acceptance

Either the .worktrees path-segment rule is accepted and documented (manually placed worktrees outside it stay hub-eligible), or detection switches to git worktree topology — for example compare git rev-parse --git-common-dir with --show-toplevel, or read the worktree's .git file — with a test covering a worktree outside .worktrees.

# Notes

## Decision (user, 2026-10-12)
Switch detection to git worktree topology: a daemon is non-production when its git common dir differs from its working tree top level (compare git rev-parse --git-common-dir with --show-toplevel), catching worktrees created anywhere, not just .worktrees. Add a test covering a worktree outside .worktrees.

## Done (developer, 2026-10-12; merge c7c1150 by reviewer)
- src/hub.ts: new exported isLinkedWorktree(root). Git topology, not path segments: the per-worktree git dir differs from the common dir. Git failure (non-git root) falls back to production, as before.
- joinHub: canHub = !isLinkedWorktree(opts.root). The splitWorktreeRoot import is gone. The standdown log now says "linked worktree checkout".
- The task-worktree self-reap in orchestrator.ts stays path-based. Task worktrees always live under .worktrees, so no change needed there.
- README: the hub candidacy paragraph now documents the topology rule.
- Tests: orchestrator.test.ts part Y2. Unit asserts for a main checkout, a subdir of one, a worktree outside .worktrees, a subdir of it, and a non-git root. E2E: a daemon rooted at that worktree stands down, never binds, never races for the hub lock, and is not reaped as a task worktree. Full suite passes (kanban, orchestrator, webui, extension, index). Commit 04c53df.

## Review (reviewer, 2026-10-12)
- Code matches the specs: isLinkedWorktree is git topology (realpath-normalised --git-dir vs --git-common-dir), git failure falls back to production, joinHub uses it, the self-reap stays path-based, README documents the rule, and unit + E2E tests cover a worktree outside .worktrees. No code fixes needed.
- Both open-question assumptions verified with local git runs, section cleared: in a --separate-git-dir checkout --git-dir and --git-common-dir are equal while --show-toplevel differs, so the developer's swap is the correct mapping (the decision's literal example would have wrongly marked such checkouts non-production; the decision said "for example", so the swap is within latitude). A bare repo root has --git-dir == --git-common-dir (production) while its worktrees differ (non-production), as assumed.
- main had moved past the merge-base (3149f65): merged main into the branch (c7c1150, no conflicts), full suite passes on the merge (kanban, orchestrator with the new part Y2 smoke, webui, extension, index).

## Merge (merger, 2026-10-12)
- Base branch resolved as main (root checkout, confirmed before each step). Step 1: merge main into fix/168-hub-candidacy-path-based in the worktree was already up to date (main had not moved past c7c1150), so test suites were skipped per the clean-merge rule. Step 2: merged the branch into main at the project root, fast-forward b23fcb2..c7c1150, no conflicts. No fixes were needed on the branch.
- Merged change: isLinkedWorktree in src/hub.ts (git topology: per-worktree git dir differs from common dir), joinHub uses it, self-reap stays path-based, README documents the rule, orchestrator.test.ts part Y2 unit + E2E tests added.

## Live test (live-tester, 2026-10-12): PASS, no findings

Harness: scratch origin `/tmp/lt168/origin.git` at c7c1150 (meta/kanban ref deleted, so the fixture board starts empty), fixture clone `/tmp/lt168/repo`, isolated HOME `/tmp/lt168/home` with `~/.pi/agent/se-llm-team.json` = fake-pi agent + `webUi` on 127.0.0.1:4488, `SE_LLM_TEAM_HUB_HEALTH_MS=500`. All daemons loaded the merged checkout `/home/phamba/repos/se-llm-team/src/orchestrator.ts` via `node --input-type=module -e`. No agents spawned (fake-pi log empty).

1. Worktree outside .worktrees (the fix): `git worktree add /tmp/lt168/wt-outside`; git topology there is `--git-dir=/tmp/lt168/repo/.git/worktrees/wt-outside` vs `--git-common-dir=/tmp/lt168/repo/.git`. Daemon A rooted there logged `no hub answering; linked worktree checkout stands down (the port is not ours to take)` (20:44:43Z). Port 4488 stayed down, no hub lock file was created, A stayed alive.
2. Main checkout is still production: daemon B rooted at `/tmp/lt168/repo` logged `web ui on http://127.0.0.1:4488 (hub for repo)`; `/health` returned ok and `GET /api/hub` matched B's pid at commit c7c1150 (`.root` is the code checkout, the known #172 gotcha). Within ~1 s A logged `registered wt-outside with the hub` and `GET /api/projects` listed both roots.
3. No failover takeover: SIGKILL on B, then two 500 ms health ticks; port 4488 stayed down, A never logged `web ui on` and stayed alive. A linked worktree never races for the port, as designed.
4. Production restart recovers: a fresh daemon B2 at the main checkout bound 4488 again and served `/api/hub` at c7c1150; A re-registered. A survived two hub restarts and B's rescans, so the path-based self-reap did not touch it.
5. Docs: README line 95 documents candidacy as git topology and that a worktree created anywhere stands down.

Assumptions: (a) the real interface is the orchestrator daemon with webUi enabled, so the election was exercised through it, not by importing hub.ts directly; (b) `SE_LLM_TEAM_HUB_HEALTH_MS=500` only shortens the pre-existing health cadence and does not alter the logic under test; (c) a worktree created by `git worktree add` outside `.worktrees` reproduces the reported class exactly; (d) the fixture board is empty, so no scheduling flow interferes. No observed behavior contradicts the task's stated assumptions.

Harness incident (not a product finding): the cleanup used a machine-wide `pkill -P 1 -f orchestrator.ts`, which also sent SIGTERM to the project's own daemon (log `orchestrator stopped` at 20:45:20Z). It was restarted with orchestrator_start (pid 4110262) before the state transition, so the pipeline is intact. The live-tester guidance now forbids machine-wide pkill.
