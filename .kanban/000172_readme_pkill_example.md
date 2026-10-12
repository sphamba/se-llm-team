---
name: "docs: README stale-daemon pkill example misses flags before --root"
priority: "low"
state: "done"
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

- Widened the README.md Web dashboard hygiene example (line 97) to `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'`. Prose step untouched. Docs-only, one-line diff, commit b23fcb2 on docs/172-readme-pkill-example.
- Verified with live fixtures (safe pgrep, no pkill, all killed by PID after): stale daemon with `--rescan-seconds 5 --root .../.worktrees/...` matches the widened pattern; stale daemon with `--root .../.worktrees/...` only matches; fixture production daemon with `--root` at a project root does not match.
- Verified against the real production daemon (`node ~/.pi/agent/extensions/se-llm-team/src/orchestrator.ts --root /home/phamba/repos/se-llm-team`): not matched, untouched.
- Merge step 1 (base branch `main` into docs/172-readme-pkill-example in the worktree): already up to date, no conflicts. Clean merge, so test suites skipped per merger procedure.
- Merge step 2 (docs/172-readme-pkill-example into `main` at the project root): fast-forward d34052c..b23fcb2, clean, one-line README.md diff on main now.

## Live test (2026-10-12)

Result: pass. No findings.

Read the merged README.md on `main` (commit b23fcb2). Line 97 holds the widened example `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'`, prose step unchanged. The test extracted the pattern from README.md itself, so the tested string is the shipped doc text and not a retyped copy.

Isolated fixture per the repo test notes: pre-#165 code at 7ecec18 via `git archive` in `/tmp/lt172`, scratch HOME, fixture repo with `webUi` on port 4488, no scratch origin and no fake-pi needed (docs-only change).

Steps and results, like a user who follows the README hygiene step:

1. Started a stale daemon with a flag before `--root`: `node oldcode/src/orchestrator.ts --rescan-seconds 5 --root /tmp/lt172/repo/.worktrees/old-probe`. It bound port 4488 (`GET /` returned 200), so this is the residue shape that can steal the production port. A second stale daemon started with `--root .../.worktrees/old-probe2` only.
2. `pgrep -af orchestrator.ts` (the prose step) listed both stale daemons and the real production daemon, with the `--root` paths readable.
3. The old narrow pattern `orchestrator.ts --root .*/\.worktrees` matched only the no-extra-flag shape. It missed the `--rescan-seconds 5` shape, which reproduces the #167 finding on the shipped doc change.
4. The documented widened pattern matched both stale shapes and neither project-root daemon (fixture or real). Before the pkill, a safety check confirmed every matched pid was under `/tmp/lt172`. No other live-tester daemon ran.
5. Ran the documented `pkill -f 'orchestrator.ts.*--root .*/\.worktrees'` exactly as extracted. `pkill` exit 0, both stale daemons gone, port 4488 free (connection refused).
6. Started the merged daemon (`node /home/phamba/repos/se-llm-team/src/orchestrator.ts --root /tmp/lt172/repo`). It took over port 4488, `GET /` returned 200, `GET /api/hub` returned `{pid:4096292, root:/home/phamba/repos/se-llm-team, commit:b23fcb251ec1bbe790eab02edb7ba3cc4fd5d45b}` (the merged commit).
7. Ran the documented pkill again while the fixture daemon and the real production daemon ran. `pgrep` had no match and `pkill` exit was 1. Both daemons survived and the fixture dashboard stayed at 200. The real production daemon (pid 4053007) is untouched and alive.

Assumptions made while designing the tests:

- The example pattern is machine-wide. The test checked the match set with `pgrep` before each `pkill` and would have aborted on a pid outside `/tmp/lt172`.
- `7ecec18` is the correct pre-#165 code, as the repo test notes state.
- The isolated HOME and the port 4488 fixture keep the real registry and the production port 4242 untouched.

No observed behavior contradicts the task's stated assumptions. Cleanup done: both stale daemons killed by the documented pkill, the fixture daemon killed by pid, `/tmp/lt172` removed.
