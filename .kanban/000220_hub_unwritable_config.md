---
name: "fix: hub setup survives an unwritable neutral config dir"
priority: "medium"
state: "live-testing"
worktree: "fix/220-hub-unwritable-config"
issuer: "#215"
complexity: "simple"
shortName: "hub-unwritable-config"
---

# Summary
The daemon must not crash at startup and must not misreport the cause when the neutral config dir (~/.config/se-llm-team) cannot be written. Today a read-only root filesystem made acquireHubLock's mkdirSync throw unhandled (daemon died) and made the lock write fail EROFS, logged as "hub lock held by another daemon, standing down".

# Specs
# Problem

Today the root filesystem of the development machine was mounted read-only (ext4, `ro`). `~/.config` lives on that read-only filesystem. The repository itself is a separate `rw` bind mount, so all board, log, worktree and pid writes inside the repo still work.

Two failure modes came out of this state, both in the hub election code merged with #215:

1. Startup crash: when `~/.config/se-llm-team` did not exist, `mkdirSync(neutralHubDir(), { recursive: true })` inside `acquireHubLock` (src/hub.ts) threw unhandled (reported ENOENT at the time, EROFS-class on a read-only parent). The throw propagated through `becomeHub` at module init and killed the whole daemon, so the pipeline stalled until a manual restart.
2. Misleading stand-down: after the directory existed but stayed unwritable, `writeFileSync(lock, pid, { flag: "wx" })` failed with EROFS. The catch branch read the absent lock file, hit the "lock vanished" path and returned false, and `becomeHub` logged `hub lock held by another daemon, standing down` every rescan. A write failure was reported as a rival daemon.

# Fix

1. The hub election must degrade gracefully: any error thrown while creating the neutral dir, writing the lock, or binding the hub must be caught at the `becomeHub` level, logged with the real error code and path, and leave the daemon running the pipeline without the hub. The daemon must never exit because the hub cannot start.
2. `acquireHubLock` must distinguish `EEXIST` (a lock file exists: keep the current rival-pid check and stale-pid steal unchanged) from other write failures (EROFS, EACCES, ENOSPC, ENOENT): return the failure reason so the log names the actual cause instead of "another daemon".

# Constraints

- Keep the create-exclusive lock and stale-pid steal behavior for EEXIST exactly as it is.
- No new dependencies.
- The legacy `~/.pi/agent` read-only fallback and the old-code-daemon warning stay unchanged.

# Acceptance criteria

- A test starts the daemon (or drives the election path) with `XDG_CONFIG_HOME` pointing into an unwritable directory (for example a `chmod 555` temp dir) and asserts: the daemon or pipeline keeps running, and the log names the write-failure cause rather than "another daemon".
- `node tests/orchestrator.test.ts` passes.
- `node tests/webui.test.ts` passes.

# Notes

- 000220 fixed in 9d9ab09 on fix/220-hub-unwritable-config.
- src/hub.ts: `acquireHubLock` now returns `true` (lock ours), `""` (a rival holds it), or a reason string naming the error code and path. Only a write `EEXIST` at the lock path itself keeps the rival-pid check and the stale-pid steal; every other failure (EROFS, EACCES, ENOSPC, ENOENT, the neutral dir replaced by a file) returns the reason.
- src/hub.ts: `becomeHub` wraps the whole election in one try/catch, releases a lock it may hold on any error, and logs `hub election failed (<code> [at <path>]), running without the hub`. A failed lock logs `hub lock write failed at <path> (<code>), running without the hub`. The daemon keeps sweeping without a hub, and a rival lock still logs the unchanged `hub lock held by another daemon, standing down`. No new dependencies, the legacy read-only fallback and old-code warning are unchanged.
- tests/orchestrator.test.ts part Z2: two spawned daemons with an isolated HOME and XDG_CONFIG_HOME, one with the XDG root chmod 555 (mkdir EACCES) and one with a pre-created neutral dir chmod 555 (lock EACCES). Each asserts the log names the error code and the failing path, never says "another daemon", and the daemon is still alive 1.2 s later.
- Verified: `node tests/orchestrator.test.ts` exit 0 (two full runs; election race, failover and neutral shared paths parts included), `node tests/webui.test.ts` exit 0. Manual smoke against a live daemon in both failure states printed the exact new log lines.
- Review (second pass, this worktree): verified the Notes claims against src/hub.ts and re-ran both acceptance suites in the worktree: `node tests/orchestrator.test.ts` exit 0 (part Z2 passed), `node tests/webui.test.ts` exit 0. EEXIST keeps the rival-pid check and the stale-pid steal exactly as before; the legacy fallback and the old-code warning are only indented, not changed. No fixes needed.
- Review: the open-question assumptions were technical and are now answered, so the section is empty again. Code-verified retry cadence: a failed election retries every second hub health tick (tick gates at HEALTH_FAILS = 2), so the failure line repeats every 2 x healthMs, 10 s at the default, with no rate limit. Test-verified: chmod 555 gives EACCES in both part Z2 states. The Specs state the "running without the hub" degradation and the unchanged legacy fallback, and scope the fix to hub setup only, so per-project lock and board write failures keep their existing behavior.
- Review: one narrow edge stays out of scope here, no fix requested: if the neutral dir turns unwritable between the lock write and the registry write inside one election, releaseHubLock's rm also fails and a self-owned stale lock stays, so later elections read "another daemon" for our own lock. The window is two adjacent syscalls, and the Specs freeze the EEXIST branch. The hub reap flush after a running hub loses write access is also outside hub setup and keeps its current behavior.
- Live test (#220, daemon e2e on a git fixture with a fake agent, no suites): all Specs checks pass, no finding. The daemon started with XDG_CONFIG_HOME on a chmod 555 dir (mkdir EACCES) and with a pre-created neutral dir at chmod 555 (lock EACCES). In both states the log names the code and the path, for example `hub lock write failed at /tmp/t220/xdg-ro/se-llm-team (EACCES), running without the hub`, the text "another daemon" never appears, and the daemon stays alive. A to-do task added after the failed election still spawned a developer (cwd in the task worktree), so the pipeline keeps running without the hub. The neutral path replaced by a regular file logs `hub lock write failed at /tmp/t220/xdg-file/se-llm-team (EEXIST), running without the hub`, which shows the guard compares the error path and not only the error code. Recovery: after the path became writable, the next retry logged `web ui on http://127.0.0.1:4498 (hub for repoH)`. Observed cadence: the first retry came 5 s after startup, then one line every 10 s, in agreement with the Notes.
- Live test differential against the pre-change code (444c106, same fixtures): the mkdir EACCES state killed the old daemon with an unhandled `Error: EACCES: permission denied, mkdir ...` thrown from acquireHubLock, and the lock EACCES state logged the misleading `hub lock held by another daemon, standing down`. Both failure modes from the Specs reproduce on the old code and are gone on the merged code.
- Live test of the EEXIST constraint: a lock with a dead pid is stolen and the daemon becomes the hub (lock file rewritten with its pid), a lock with a live pid logs the unchanged `hub lock held by another daemon, standing down`, and the legacy warning still prints `legacy hub lock held by pid N, an old-code daemon may still serve the hub` before a successful election. The commit touches only src/hub.ts and tests/orchestrator.test.ts, so no new dependency.
- Live test assumptions and scope: chmod 555 gives EACCES, which takes the same non-EEXIST branch as EROFS, so the read-only-filesystem class is covered (an unprivileged user cannot mount a read-only filesystem to reproduce EROFS exactly). The bind-failure branch, the two acceptance suites, the per-project lock and the board write failures are outside this live test, as the Specs scope them to other gates. No contradiction with the task assumptions was observed.
- Live test technical difficulty (harness only, not a product issue): a `pgrep -f /tmp/t220/fake-pi` inside the test shell matched the shell's own command line and killed the test once. Kill only recorded pids, or read /proc/<pid>/cmdline from a script file.

# Open questions
