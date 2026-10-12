---
name: "fix: pre-#165 hub-aware worktree daemons still steal the port on restart"
priority: "medium"
state: "done"
worktree: ""
issuer: "#165"
complexity: "moderate"
shortName: "stale-daemon-steals-hub-port"
---

# Summary
The #165 restart-race fix only constrains daemons running the new code. A leaked hub-aware worktree daemon from a pre-#165 checkout still wins the hub election during the restart window, binds the production port and keeps it, so the restarted production daemon can only register with it. Make the production daemon reclaim (or preempt) the port from such a daemon, or document one-time manual hygiene if the residue is accepted.

# Specs
Found in the live test of #165 (fix merged at fa7f502; harness was an isolated scratch clone at that commit with an isolated HOME, webUi on 127.0.0.1:4488, SE_LLM_TEAM_HUB_HEALTH_MS=500).

## Problem

#165 makes a daemon rooted in a task worktree (root path containing a .worktrees segment) never race the hub election, and reap itself when its owner board task is done or gone. Both checks run inside the daemon's own code, so a pre-existing daemon running old code ignores them.

## Evidence

- A daemon rooted at .worktrees/old-probe with code at 7ecec18 (hub-aware, before the #165 fix) registered with the new-code hub on 4488.
- After the new-code hub was killed, the old-code daemon bound 4488 within 3 s: GET /health 200, GET /api/hub 404, hub lock held by its pid 3861108.
- A restarted production daemon (fa7f502, root of the clone, pid 3861738) could only register with the old-code hub; the port never returned to the production code.

## Impact

This is exactly the leaked-daemon class the #165 Mechanism section names, so the acceptance "a leaked or old-checkout daemon cannot capture it in the restart window" is not met for pre-existing leaks. Severity: medium.

## Acceptance

Either the production daemon can reclaim/preempt the port from a worktree-rooted old-code hub (explicitly designed and tested), or the residue is accepted and a documented one-time hygiene step (kill pre-fix hub-aware worktree daemons once) is added.

# Notes

## Decision (user, 2026-10-12)
One-time manual hygiene, not a port-reclaim follow-up. The task's code change is to document the cleanup (README or the #165 notes): kill any pre-#165 hub-aware worktree daemons once; new worktree daemons run post-#165 code and self-exclude, so the residue does not recur. The PM killed the leaked pre-fix daemons on this machine today.

## Notes (Developer, 2026-10-12)

Commit b823888 on fix/167-stale-daemon-steals-hub-port. Doc-only change in the chosen README place (the #165 task file is done, so its Notes are not edited).

- README.md Web dashboard section, after the candidacy-restriction paragraph: new paragraph states that both checks (stand-down, self-reap) run inside each daemon's own code, so a pre-change worktree daemon still wins the election and holds the port; after upgrade, kill old worktree daemons one time with `pgrep -af orchestrator.ts` and kill each process whose `--root` contains `.worktrees` (example: `pkill -f 'orchestrator.ts --root .*/\.worktrees'`; the pattern does not match a daemon at the project root). New worktree daemons run the current code and exclude themselves, so the residue does not recur.
- Pattern verified against a fixture of the two command-line shapes: matches the worktree-rooted daemon, not the production one. Live check: `pgrep -af 'orchestrator\.ts --root .*/\.worktrees'` matches nothing on this machine (the PM killed the leaked pre-fix daemons today); the only daemon left is the production one, correctly not matched. No `pkill` was run by the developer.
- All five suites pass (README is an unmapped path in test:changed, so the full suite ran).

Assumptions (confirm or correct):
- README is the single documentation place; the #165 task Notes stay untouched.
- The `pkill -f` example is safe for users: it matches only daemons whose `--root` is under a `.worktrees` path, never the production daemon at a project root.

## Notes (Reviewer, 2026-10-12)

Reviewed b823888 (one paragraph in README.md, Web dashboard section). No fixes made.

- Acceptance met: residue accepted, one-time hygiene step documented in the chosen README place. Verified in code that the claims hold: both #165 checks run inside the daemon's own code (stand-down: hub.ts election, never races for worktree roots; self-reap: orchestrator.ts, at startup and on every sweep before acquireLock). Task #165 is done, so its Notes are correctly not edited.
- Pattern safety re-verified live: the production daemon runs as `node .../extensions/se-llm-team/src/orchestrator.ts --root /home/phamba/repos/se-llm-team`; `pgrep -af 'orchestrator\.ts --root .*/\.worktrees'` does not match it (exit 1), and the shell wrapper carrying the pattern text is not matched either. The pattern matches the worktree daemon shape (`--root <repo>/.worktrees/<name>`).
- Assumptions confirmed: README is the single doc place; the `pkill -f` example only matches `--root` paths containing `/.worktrees`. Known edge (not fixed): a project root dir named like `.worktrees-main` would match; the same edge applies to the plain `pgrep` instruction text, and the layout is unrealistic, so the example stands.
- Tests: the diff touches only README.md; no test parses the repo README (tests only write README fixtures in scratch roots), so the full-suite run claim is consistent.

## Notes (Merger, 2026-10-12)

- Step 1: base branch resolved as main (root checkout). Merged main into fix/167-stale-daemon-steals-hub-port in the worktree: already up to date, no conflicts, so test suites skipped per pipeline rule.
- Step 2: base branch re-resolved as main. Merged fix/167-stale-daemon-steals-hub-port into main in the project root: fast-forward 3149f65..b823888, README.md +2 lines, clean, no conflicts.
- The live test runs on the merged commit b823888 on the root checkout.

## Notes (Live-tester, 2026-10-12)

Live-tested the merged commit b823888 on the root checkout. Scope: the README hygiene step for pre-#165 worktree daemons (README.md:97). Result: acceptance met, one low-severity doc finding (task #172).

Harness (all isolated; the real production daemon, port 4242, the real HOME and the real hub lock/registry were never touched, and cleanup left port 4488 free and the repo git-clean): /tmp/t167live with an isolated HOME whose global config sets webUi 127.0.0.1:4488. Stale daemon: the real pre-#165 code at 7ecec18 (`git archive 7ecec18`), root /tmp/t167live/repo/.worktrees/old-probe. Production daemon: merged code from this checkout, canonical argv `node /home/phamba/repos/se-llm-team/src/orchestrator.ts --root /tmp/t167live/repo`. SE_LLM_TEAM_HUB_HEALTH_MS=500 shortened the failover wait.

Observed:

1. Residue reproduced exactly as in the task Evidence: the pre-#165 worktree daemon bound 4488 first (GET /health 200, GET /api/hub 404, hub lock held by its pid), and the merged production daemon started later could only register with it ("registered repo with the hub at http://127.0.0.1:4488").
2. Documented step 1 (`pgrep -af orchestrator.ts`) listed the stale daemon, and the prose filter "kill each process whose --root contains .worktrees" identified exactly the stale pid and neither production daemon (the real one and the fixture one).
3. The documented example (`pkill -f 'orchestrator.ts --root .*/\.worktrees'`) matched exactly the stale pid. pkill exit 0; only the stale daemon died; the production daemon survived and took over the hub within 3 s; GET /api/hub then returned {pid, root:/home/phamba/repos/se-llm-team, commit:b823888...} and the lock moved to the production pid. The documented hygiene step works end to end.

Finding (reported, task #172, low): the example pattern requires `--root` to immediately follow `orchestrator.ts`. A stale daemon started as `orchestrator.ts --rescan-seconds 5 --root <repo>/.worktrees/old-probe2` was listed by step 1 and found by the prose filter, but the example pattern returned no match, so a user who runs only the copy-pasted example leaves that pre-#165 hub-aware daemon alive, and it can steal the port at the next restart. Suggested fix: widen the example to `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'` (verified: matches both stale shapes, neither production daemon).

Assumptions: isolated HOME and webUi port 4488 stand in for the user environment; 7ecec18 is the pre-#165 hub-aware code; the isolated fixture root stands in for the project root; the health env knob only shortens the wait.

No behavior contradicting the task's stated assumptions. Out of scope, already tracked by #168 (no new task): a daemon running worktree-checkout code with a `--root` outside `.worktrees` (e.g. the /tmp/orch-smoke shape) is missed by both the #165 candidacy rule and this README filter.

# Open questions
