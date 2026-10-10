---
name: "feat: 10s daemon scan and an orchestrator_poke tool for the Project Manager"
priority: "medium"
state: "done"
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

- src/orchestrator.ts: default rescanSeconds 30 -> 10 (one line).
- index.ts: new orchestrator_poke tool between orchestrator_status and orchestrator_stop. No params. Touches .kanban/.poke with openSync("a") + closeSync (guarded for a missing board), then reads the pid with readPid + pidAlive. Running: "Poked the orchestrator (pid N). Scan starts within a second." Not running: "No orchestrator daemon running for this project."
- .gitignore: added .kanban/.poke.
- README.md: scan interval line now says 10 s and mentions the poke tool; orchestrator_poke added to the PM tool list.
- Checks: node src/kanban.test.ts && node src/orchestrator.test.ts pass. Live fixture in /tmp: daemon start log prints rescan=10s with no flag; a poke on a running daemon produced a sweep and a developer spawn ~0.5s after the poke; the tool return text verified for both the running and not-running cases. Fixture processes and files removed.
- Review (state to-review): no functional issues. Verified in a live /tmp fixture that the no-flag start log prints rescan=10s, and that a kanban-dir change fires a sweep with no timer tick near (the mechanism the poke rides; a poke-caused sweep cannot be distinguished from a task-edit sweep because both funnel into the same fs.watch debounce, by design). .poke stays out of git status. Tests pass after the fix.
- Fixed: misindented try/catch in the poke tool execute (commit 1b3741e, style only).
- Review (state to-review): found and fixed a functional bug (commit fea8703). On Linux, open("a") + close on an ALREADY EXISTING .poke writes nothing, and inotify reports no event, so only the first poke after daemon start triggered a sweep; every later poke was silent. Verified live with a standalone fs.watch probe (bare open("a") on an existing file fired no event; rm+create fired rename every time) and with a live daemon fixture: a poke reset the daemon's 500ms debounce (poll's state-write sweep had been scheduled for t+0.5s, the poke moved it to t+0.96s) and a reviewer spawn followed within 1s. Fix: the tool now unlinks .poke before re-creating it, so every poke fires a fs.watch event. Re-verified: no-flag start log prints rescan=10s; node src/kanban.test.ts && node src/orchestrator.test.ts pass; .poke stays out of git status. Tool return texts match the spec strings for both the running and not-running cases.
- Review 2 (state to-live-test): no fixes. Diff against main matches the specs: rescan default 10 (src/orchestrator.ts), orchestrator_poke between orchestrator_status and orchestrator_stop with the spec texts, .kanban/.poke in .gitignore, README updated. .poke is invisible to the scan (task list filters on .md). Verified in a fresh /tmp fixture: no-flag start log prints rescan=10s; tests pass; a .poke touch on a running daemon produced a sweep and agent scheduling within ~1.5s with no 10s timer tick in the window (fs.watch debounce, as designed). No leftover 30s mentions anywhere. Existing tool contracts unchanged.
- Review 4 (state to-live-test): no fixes. Independent pass over the diff and live checks, same verdict. New evidence this pass: (1) a standalone fs.watch probe re-confirmed the fix rationale live, bare open("a") on an existing .poke fires no event, rm+create fires a rename every time; (2) a live /tmp daemon fixture with a /bin/true agent proved the poke reaches the daemon: a state edit at T scheduled a sweep for T+0.5, a poke at T+0.3 reset the debounce, and the spawn landed at T+0.807 (poke-predicted T+0.8, edit-predicted T+0.5 passed unfired), so the poke drives the sweep, not the timer; (3) no-flag start log prints rescan=10s in three fresh fixtures; (4) git check-ignore confirms .kanban/.poke stays out of git status; (5) node src/kanban.test.ts && node src/orchestrator.test.ts pass. Tool strings, placement, params, README, and .gitignore match the specs byte for byte. Fixture processes and files removed, no leftover 30s mentions anywhere, existing tool contracts unchanged. Two fixture-side artifacts noted, not diff bugs: commitKanban swallows git failures silently (a non-git fixture gives no sweep-visible error log), and a to-review task with a missing worktree dir spawns with ENOENT (real tasks reach to-review after doing, which creates the dir).
- Review 3 (arrived after Review 2, state already live-testing, left as is): no fixes. Independent pass over the same diff and live checks, same verdict. One transient scare explained: a /tmp fixture log showed the start line twice; confirmed log() appends once and main() has a single call site, so it was cross-contamination from a concurrent fixture, not a double-start bug. Cleanup: killed one leaked daemon (pid 782445, root /tmp/orch-smoke-aDjvH9, --rescan-seconds 1) left behind when the earlier live-test bash in this worktree died before its test-side killAll ran. Other worktree fixtures untouched.
- Live test (state to-live-test): pass with one finding. node src/kanban.test.ts && node src/orchestrator.test.ts pass. In /tmp git fixtures: with no --rescan-seconds flag, the daemon start log prints rescan=10s (checked on two starts), and the 10s tick fired (a to-review spawn logged 10.0s after start). The poke tool ran as a user through a headless pi session that loaded the worktree index.ts. With the daemon running it returned exactly "Poked the orchestrator (pid N). Scan starts within a second." (pid matched the lock). After stop it returned exactly "No orchestrator daemon running for this project." A .poke event (rm+create, the tool operation, committed as fea8703) with pending work produced the sweep within ~1s: a done commit landed 0.5s after the poke, with the next 10s tick not due. Agent scheduling on the sweep works: kanban_set_state to-do spawned a developer ~1s later and moved the task to doing. .kanban/.poke stayed out of git status. No leftover 30s mentions. FINDING (reported to the PM): the branch was cut before main's f159f14, and its index.ts daemonLog still passes ctx.cwd to board (double .cwd, the merge-base state), so the orchestrator_start tool throws "The path argument must be of type string. Received undefined" before the daemon spawns. Live-verified in a fixture: no daemon starts from the tool on this branch. The three-way done-merge should resolve the line (only main touched it), but verify after the merge that orchestrator_start works on merged main. Minor observations, pre-existing and out of scope: a state change made by the startup poll races the fs.watch registration, so that first transition waits for the 10s tick instead of the ~500ms sweep; a daemon started manually from a dying terminal can crash on the next log write (EPIPE), the orchestrator_start flow is unaffected.