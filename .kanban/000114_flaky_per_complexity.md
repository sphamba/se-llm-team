---
name: "fix: flaky per-complexity reviewer cap test part AB"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#98"
---

# Summary
The part AB "per-complexity reviewer cap" smoke test in src/orchestrator.test.ts intermittently spawns one extra reviewer (4 instead of 3 for the cap-3 complex task), making the first full-suite run of the #98 live test fail while a second run passed. The instant loopStub reviewer races the daemon's post-spawn setState("reviewing") plus armed-marker write; when the stub wins, the liveness poll requeues reviewing -> to-review, the armed marker no longer matches the cleared pidfile, consumeReviewerRun drops the run without counting it, and an extra spawn happens. Real reviewers take seconds, so this is test-only flakiness, not a product bug. Acceptance: a reliably green full suite.

# Specs
Race detail (test-only): in part AB of src/orchestrator.test.ts, the loopStub fake reviewer writes state to-review and exits faster than the daemon performs its post-spawn setState("reviewing") plus armed-marker write in the to-review branch of rescan (src/orchestrator.ts). When the stub wins the race, the liveness poll requeues the task reviewing -> to-review, the armed marker no longer matches the now-cleared pidfile, consumeReviewerRun drops the run without counting it against the cap, and a further reviewer spawn occurs (4 instead of 3). Real reviewer sessions take seconds, so this never affects production.

Suggested fix direction (not prescriptive): make the assertion robust rather than merely lengthening sleeps — e.g. have the stub signal that the daemon has taken over (armed the reviewer) before it exits, or wait for the daemon to finish arming the reviewer before letting the stub exit/write its state. Keep the per-complexity cap coverage intact: the test must still prove that a complex task caps at 3 reviewer spawns and that an invalid configured value falls back to the default 3.

Acceptance: node src/orchestrator.test.ts passes reliably across repeated runs (several consecutive green runs), with the per-complexity reviewer-cap assertions unchanged in strength. Test-stability fix only; orchestrator behavior itself is believed correct.

# Notes
