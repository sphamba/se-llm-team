---
name: "fix: log pane meta keeps a stale model or thinking level from an older record"
priority: "low"
state: "done"
worktree: ""
issuer: "#146"
complexity: "simple"
blockedBy: ""
shortName: "stale-log-meta-field"
---

# Summary
The log pane's meta line (#m-log-meta, from #146) can show a model or thinking level that the latest usage-bearing log record no longer carries: logStats in src/webui.ts only overwrites each field when the current record has it, so an absent field is inherited from an older record. This contradicts the #146 Specs sentence that the two fields come from the LATEST usage-bearing record.

# Specs
Current state: the #146 logStats implementation carries forward the last seen model/thinkingLevel, so when the latest usage-bearing record lacks them the meta line keeps a stale value from an older record instead of clearing.

Changes (src/webui.ts + src/webui.test.ts only):
- Latest record wins: logStats picks model and thinkingLevel from the latest usage-bearing record only; when that record lacks them (or no usage-bearing record exists) both clear to null and the #m-log-meta line hides. No carry-forward from older records.
- The PM confirmed the carry-forward was never intentional; the #146 Specs statement (null when none) is authoritative and the #146 assumptions need no update.
- Keep the meta line's position rules (inside the pane for now; #154 moves it outside), chunk walk-back, offsets, dedupe and live streaming untouched.
- Update any src/webui.test.ts assertions that rely on the stale carry-forward.

Tests: the webui suite stays green (run it as the check); assert a record without model/thinkingLevel clears the meta.

# Notes

- Fix committed in the worktree (c22ec3e): logStats in src/webui.ts now overwrites model/thinkingLevel unconditionally per usage-bearing record, so a latest record without them clears both to null instead of carrying an older record's value. Doc comment updated to match.
- Added a webui.test.ts scenario: an older record with model/thinkingLevel, a latest record without them, both served fields assert null. Existing assertions did not rely on the carry-forward, none changed. Full webui suite green.
- Review passed, no fixes: the diff touches only the logStats meta fields, the doc comment, and the new test, as the Specs scope asks. Clearing is per field, so a latest record with a model but no thinking level keeps the model; this matches the latest-record-wins sentence. The client builds the meta label fresh from each payload, so nulls hide the #m-log-meta line with no client carry-forward. Existing assertions (latest-record-wins with both fields present) stay valid. Webui suite green, worktree clean.
- Live test passed, no issues found (2026-10-12). Ran the real daemon from the worktree (node src/orchestrator.ts --root <fixture> --rescan-seconds 3600) on a synthetic board at /tmp/lt151/fixture with a separate HOME and port 4401, so the hub on 4242 was untouched. Exercised the real hub HTTP API and the real page in headless Chromium. No unit suite was run.
- Server, real /api/agent-log against a live-tester run log: an older record with model+thinkingLevel followed by a latest usage-bearing record without them serves model=null, thinkingLevel=null (the fix); a latest record with both serves both; model only clears thinkingLevel and keeps the model; thinkingLevel only clears the model; no usage-bearing record and a .gz (compacted) run both serve nulls. A non-usage record after a usage record does not clear the fields (latest usage-bearing record wins). Text streaming stayed intact: the init payload rendered the text, and an offset poll returned only the new delta without re-serving the older text. Traversal, unknown task and unknown sub handles still 404.
- Browser, real page: opening the live-tester log whose latest usage record lacked the fields showed #m-log-meta with an empty text and the hidden class, inside #m-log as the Specs require. Appending a usage record with both fields made the 1 s poll show "GLM 5.3 Flash · thinking max"; appending model only showed "DeepSeek V4.1 Flash"; appending a usage record with neither hid the line again. No console or page errors. Screenshots: /tmp/lt151/shot-a-cleared.png, shot-b-both.png, shot-c-model-only.png, shot-d-cleared.png.
- Repro proof: main's pre-fix webui served that same log as model "DeepSeek V4.1 Flash", thinkingLevel "max" (the stale carry-forward), while the worktree served null/null. The test detects the defect and the fix clears it.
- Assumptions: a usage-bearing record is a turn_end or assistant record with a finite numeric message.usage.totalTokens (the logStats predicate); the fixture task's pid file named a live sleep process, so no sweep compacted the plain log; the meta label needs a model (thinkingLevel alone renders nothing), which is the pre-existing #146 client rule and not part of this change.
- Merged (2026-10-12). Step 1, worktree: resolved base branch main, merged main into fix/151-stale-log-meta-field; clean, main was already an ancestor (Already up to date), so no merge commit and no test suites re-run. Step 2, root: resolved base branch main again (root clean, still on main), merged fix/151-stale-log-meta-field into main; fast-forward 9eb7f40..c22ec3e, src/webui.ts and src/webui.test.ts, 15 insertions and 4 deletions. No conflicts on either side, worktree left clean. Verified the fix (logStats latest-record-wins meta fields) is present on main at c22ec3e.

# Open questions

