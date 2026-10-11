---
name: "fix: flaky per-complexity reviewer cap test part AB"
priority: "low"
state: "reviewing"
worktree: "fix/114-flaky-per-complexity"
issuer: "#98"
---

# Summary
The part AB "per-complexity reviewer cap" smoke test in src/orchestrator.test.ts intermittently spawns one extra reviewer (4 instead of 3 for the cap-3 complex task), making the first full-suite run of the #98 live test fail while a second run passed. The instant loopStub reviewer races the daemon's post-spawn setState("reviewing") plus armed-marker write; when the stub wins, the liveness poll requeues reviewing -> to-review, the armed marker no longer matches the cleared pidfile, consumeReviewerRun drops the run without counting it, and an extra spawn happens. Real reviewers take seconds, so this is test-only flakiness, not a product bug. Acceptance: a reliably green full suite.

# Specs
Race detail (test-only): in part AB of src/orchestrator.test.ts, the loopStub fake reviewer writes state to-review and exits faster than the daemon performs its post-spawn setState("reviewing") plus armed-marker write in the to-review branch of rescan (src/orchestrator.ts). When the stub wins the race, the liveness poll requeues the task reviewing -> to-review, the armed marker no longer matches the now-cleared pidfile, consumeReviewerRun drops the run without counting it against the cap, and a further reviewer spawn occurs (4 instead of 3). Real reviewer sessions take seconds, so this never affects production.

Suggested fix direction (not prescriptive): make the assertion robust rather than merely lengthening sleeps — e.g. have the stub signal that the daemon has taken over (armed the reviewer) before it exits, or wait for the daemon to finish arming the reviewer before letting the stub exit/write its state. Keep the per-complexity cap coverage intact: the test must still prove that a complex task caps at 3 reviewer spawns and that an invalid configured value falls back to the default 3.

Acceptance: node src/orchestrator.test.ts passes reliably across repeated runs (several consecutive green runs), with the per-complexity reviewer-cap assertions unchanged in strength. Test-stability fix only; orchestrator behavior itself is believed correct.

# Notes
- The flaky part is labeled part AJ in the current file (renumbered from AB by commit 34e5ebc "test: rename merged part locals to their renumbered labels"). The part AJ assertions (complex caps at 3 spawns, invalid reviewerCap.complex falls back to the default 3) were left byte-identical.
- Reproduced and re-diagnosed: since the to-review branch now does setState("reviewing") before spawnAgent, the stub can no longer leave the task in reviewing with a dead pid, so the filed requeue path (reviewing -> to-review) is gone; the live failure mode is a poll tick clearing the pidfile of the to-review task between the stub's exit and the next sweep's consumeReviewerRun, which then sees armed(pid) != pidfile(0) and drops the run uncounted, so the cap spawns again (4 instead of 3; simple/moderate got 2 instead of 1 under stress). Proven with a focused harness: poll interval 600ms failed 5/6 runs (complex spawned 4, 5, 10); with the fix it passes 10/10.
- Fix (test-only, orchestrator.ts untouched): the loopStub reviewer now waits for the post-spawn armed marker (<slug>.reviewer-armed) before writing its state, and stays alive (pid keeps the pidfile matched) until the next sweep consumes that marker, so the poll can never clear the pidfile while a run is uncounted. Waits are bounded (10s) sync Atomics.wait loops; live-tester stubs are unchanged (no armed marker, and done has no dead transition). Commit ccb7b2e in the worktree.
- Verified: 3 consecutive green full-suite runs under CPU load (yes x3 hogs), plus 10/10 green focused runs at the 6x-faster poll interval; part AA (reviewer successful-run cap) still green in every full-suite run.
- Left no open questions.