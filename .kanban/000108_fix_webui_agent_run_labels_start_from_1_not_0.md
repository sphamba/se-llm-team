---
name: "fix: webui agent run labels start from 1, not 0"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
When several agents have run on the same step the detail card labels them with the 0-based log index ("Reviewer 0", "Reviewer 1"). Render the visible run number 1-based instead; disk naming and handles stay unchanged.

# Specs
User order (2026-10-11): when multiple agents have run on the same step they are numbered from 0 in the webui; start from 1 instead.

Facts (verified on current main, src/webui.ts):
- renderAgent (~line 869-893) labels each run button: cap(a.role) + (count[a.role] > 1 && a.run != null ? " " + a.run : ""). a.run is the 0-based index in the <slug>.<role>.<n>.log file name (null for a legacy unsuffixed file), so two runs read "Reviewer 0" and "Reviewer 1".
- The subagent buttons (renderSubs) are labeled by the Agent id string, not a number - unaffected.
- The button's data-handle carries the file-name handle (e.g. slug.reviewer.0); only the visible label must shift.

Changes (src/webui.ts, src/webui.test.ts only):
1. renderAgent: the label renders the run number 1-based - " " + (a.run + 1) when count[a.role] > 1 and a.run != null. The first run of a role reads "1", the second "2", regardless of the disk naming.
2. Legacy unsuffixed logs keep their unnumbered label (a.run == null -> no number), unchanged.
3. Do NOT rename log files or change nextRunIndex/orchestrator indexing: the .0.log handle and disk names stay exactly as they are (#87/#88 contracts); only the displayed number shifts. Old .0.log files display as "1".
4. Extend src/webui.test.ts: the served payload/client label logic asserts the 1-based rendering (a run with index 0 labels "1" when the role has several runs; a solo run keeps its unnumbered label per the current count > 1 rule).

Acceptance:
- In the detail card, multiple runs of one role read "1, 2, 3..." oldest-first; a solo run stays unnumbered.
- node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts only. No orchestrator changes.

# Notes

- Extracted the run-label lambda from renderAgent as exported client helper agentLabel(a, count), interpolated into PAGE like the other tested client helpers, and made it 1-based: " " + (a.run + 1) when count[a.role] > 1 and a.run != null. The local capitalize cap in renderAgent folded into agentLabel; the count > 1 rule and a.run == null unnumbered path are unchanged. Log names, handles and nextRunIndex untouched.
- src/webui.test.ts: agentLabel asserted over the served 000088 payload (developer run 0 -> "Developer 1", run 1 -> "Developer 2", legacy run null -> "Developer", solo run -> "Reviewer") plus the page-ships-the-tested-source check.
- node src/webui.test.ts, node src/kanban.test.ts pass; node src/orchestrator.test.ts failed once on the timing-sensitive respawn-cap smoke, passed on re-run (it imports hub.ts, not webui.ts, so unrelated to this change). Committed 38f7e75 on fix/108-webui-agent-run.
- Review (2026-10-11): verified 38f7e75 against the specs, no fixes needed. agentLabel renders " " + (a.run + 1) under the count > 1 && run != null rule; legacy run-null and solo runs stay unnumbered; diff touches only src/webui.ts and src/webui.test.ts (no renames, no orchestrator changes, data-handle unchanged). Test assertions checked against the served payload (devRuns[1] = run 0 -> "Developer 1", devRuns[2] = run 1 -> "Developer 2", devRuns[0] = legacy null -> "Developer", solo reviewer count 1 -> "Reviewer"); page-ships-source check confirmed inside the <script> block. All three suites pass on this worktree (orchestrator incl. the timing-sensitive respawn-cap smoke). The removed renderAgent-local cap lambda had no other callers; the module-level cap truncate helper is separate.
- Live test (2026-10-11), real user flow: started the worktree webui (startWebUi from src/webui.ts) on 127.0.0.1:4288 against the real main-checkout board, then a headless Chrome driven over CDP (playwright not installed; raw CDP via Node's global WebSocket). Opened the real detail card of 000078 (developer runs null/0/1, reviewer runs 0/1/2): labels read "Developer" (legacy null), "Developer 1", "Developer 2", "Reviewer 1", "Reviewer 2", "Reviewer 3", solo "Live-tester". 000097 (solo developer, two reviewers, solo live-tester): "Developer", "Reviewer 1", "Reviewer 2", "Live-tester". All data-handle values still point at the unchanged disk handles (e.g. .developer.0, .reviewer.2). No 0 label anywhere. All three suites pass on the worktree. No issues found.
- Merge (2026-10-11): step 1 resolved the base branch (main) and merged it into fix/108-webui-agent-run in the worktree; ort auto-merged src/webui.ts and src/webui.test.ts with no conflicts, merge commit 1725cb8. Step 2 re-resolved the base branch (still main) and fast-forwarded main to 1725cb8. Verified the 1-based agentLabel survived the auto-merge (run 0 -> "Reviewer 1", run 1 -> "Reviewer 2", legacy run-null and solo runs unnumbered). All three suites pass on the worktree (kanban + webui + orchestrator) and webui.test.ts passes on main after the fast-forward.
