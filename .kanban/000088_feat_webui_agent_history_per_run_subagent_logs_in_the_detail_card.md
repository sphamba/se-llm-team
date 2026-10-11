---
name: "feat: webui agent history per run; subagent logs in the detail card"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
The webui task detail shows max 3 role-granular agents and cannot open per-run or merger logs, and subagent logs are invisible. Show every agent run chronologically in one row (building on #76), resolve each run's subagent logs from the parent log, and stack subagents vertically.

# Specs
Facts (main, verified): agentHistory src/webui.ts:86-91 lists PIPELINE_ROLES roles whose `<slug>.<role>.log` exists - role-granular, max 3; agentLogPath :95-99 allowlist regex `^(.+)\\.(developer|reviewer|live-tester)$` rejects `.merger` and run-suffixed names; taskPayload :212-224 serves agents/agent at :221-222; agentLogPayload :227-266 does LOG_CHUNK chunking with offset poll and unrenderable-tail walk-back; renderAgent :522-539 groups past-then-live buttons, openLog :547 builds `${file}.${role}`; renderLogChunk renders pi JSONL with passthrough fallback. Naming contract from task #87: new runs write `<slug>.<role>.<n>.log`, legacy `<slug>.<role>.log` stays. After #87 the current webui shows no agents for tasks whose runs are only indexed and 404s per-run handles (user-confirmed gap).

Changes:
1. agentHistory returns per-run entries: for each role in PIPELINE_ROLES order then merger, one entry per `.logs/<slug>.<role>.<n>.log` ordered by index ascending; when a legacy `<slug>.<role>.log` exists it is an extra entry ordered before that role's indexed runs. Entry shape {role, run (number|null for legacy), alive, handle} where handle is `${slug}.${role}` or `${slug}.${role}.${n}`; alive on the entry whose role matches AGENT_ROLE(state) with a live pid (highest index of that role, or the legacy entry).
2. /api/agent-log (agentLogPath) allowlist accepts plain role handles, run-suffixed handles, and merger, still gated on taskFiles; content serving reuses the same chunked payload unchanged. Covers the allowlist-regex slice of #79 (supersedes it there; #79 keeps states/WORKING/accent/STATE_NAMES).
3. Correct-log retrieval (user order): a run-suffixed handle resolves to its own indexed file - never the legacy file - and the #67 walk-back (serve the last renderable chunk for a finished log) plus the offset poll apply unchanged to run-suffixed and merger handles, so every per-run click retrieves the correct file and the correct final chunk. agentHistory's alive marking must probe the pid of the entry's own role (highest index), not the role-granular currentPid alone.
4. Subagent logs via optional `sub` param on /api/agent-log: `sub=list` returns [{id, index}] parsed from that handle's own parent log - tool_execution_end records whose result text matches "Agent ID: <uuid>" and "Output file: <path>"; `sub=<n>` serves the n-th output file through the same chunked payload. Path validation at this trust boundary: the resolved path must start with /tmp/pi-subagents-1000/ and end with .output; the client never passes paths. No matching records means an empty list, never an error. (Ceiling: /tmp/pi-subagents-1000 and the result-text wording are emergent undocumented pi behavior; revisit if pi documents a structured event.)
5. Rendering (renderAgent, building on #76's row): all runs render as buttons in one horizontal chronological row, oldest leftmost, sorted by run log file mtime across roles (tie-breakers only: run index ascending, legacy first within role, role pipeline order); the live agent rightmost with its spinner; when the selected agent has subagents they render as buttons stacked vertically below the row, chronological; clicking a subagent button opens that log in the existing pane via the sub params. Button labels: role name, with the run index appended when that role has multiple runs. Ordering must be chronological across roles, not by fixed role order: on a reopened task a reviewer run can be newer than the live-tester run and must render to its right.
6. Subagent .output files are JSONL sidechain transcripts ({isSidechain:true,...}); they render through the existing renderLogChunk passthrough - no special casing.

Tests (src/webui.test.ts): per-run entries (indexed files yield multiple entries), legacy entry ordered first, entry order (chronological by log mtime across roles: a newer reviewer run renders right of an older live-tester run), allowlist accepts run-suffixed and merger handles and rejects junk, a run-suffixed handle serves its own file (not the legacy one) with the walk-back applied, sub=list and sub=n payloads (create a fixture parent log + /tmp/pi-subagents-1000 fixture), agents payload deepEqual update (:127-128); STATE_NAMES untouched.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts all pass.

HOLD: none. The earlier holds (#87 naming, #76 row, #47 merge) are all satisfied and dropped. #84 is scheduled at the same time; both touch the agent-log serve region (agentLogPayload) in separate worktrees and the merger resolves the overlap.

# Notes

Developer notes (2026-10-11). Worktree feat/88-webui-agent-history.

- 3a04942 feat: webui agent history per run, subagent logs in the detail card (src/webui.ts +251/-59, src/webui.test.ts +146). Server: LOG_ROLES (pipeline roles plus merger), AgentEntry {role, run, alive, handle}, agentHistory gives one entry per .logs/<slug>.<role>[.<n>].log ordered by log mtime across roles (tie-breakers: run index ascending, legacy first, role pipeline order), the run-suffix and merger allowlist in agentLogPath, the subagentLogs parser (resolve() then the /tmp/pi-subagents-1000 prefix and the .output suffix), and sub=list / sub=<n> in agentLogPayload. Client: logState {handle, sub}, run buttons carry data-handle, sub buttons stack vertically with data-handle and data-sub, a log is live only when sub is null and the alive entry handle matches.
- f8896ae fix: review follow-up. Run and sub buttons bind their listener after render, not through an inline onclick that interpolated the handle. A file name with a quote made the button dead, a backslash opened the wrong log. Sub list parsing now pre-filters lines before JSON.parse and memoizes per path until the file size changes (369 ms first, 0.4 ms repeat on a 55 MB log). A sub index must be fully numeric, so 1abc gives 404.

Acceptance: node src/kanban.test.ts, node src/orchestrator.test.ts (includes the reviewer successful-run cap smoke) and node src/webui.test.ts all pass. The PAGE client JS was extracted and passes node --check.

Browser smoke (Playwright against a temp root, startWebUi port 0): clicked through per-run buttons, sub buttons and pane content. Task files 000002_quo"te.md and 000003_back\slash.md resolve the exact handle and show their log. Zero page errors.

Verified limitation (spec point 6): real pi subagent .output transcripts are sidechain records ({isSidechain:true,...} with user/assistant/toolResult types) that renderLogChunk drops, so an unchanged serve shows an empty pane. The sub=1 test pins this: the sidechain JSON record renders to nothing, the non-JSON line passes through.

Reviewer notes (2026-10-11). Reviewed 3a04942 and f8896ae against the Specs in worktree feat/88-webui-agent-history. No fixes made, the code matches specs 1 to 6 and the tests pin them.

- Acceptance re-run in one sequence: node src/kanban.test.ts, node src/orchestrator.test.ts and node src/webui.test.ts all pass. The worktree is clean at f8896ae.
- Independent Playwright smoke on a fixture root: 4 runs render in one horizontal row. Labels are Developer 0, Live-tester, Reviewer, Developer 1, so only the role with several runs carries an index. The live run sits rightmost with its spinner. Two subagent buttons stack vertically below the reviewer run. A sub click opens the pane and marks the sub button active. A run switch clears the old sub buttons. No page errors.
- The sub parser was checked against a real parent log in the main checkout (000072 reviewer log). sub=list returns the real subagent id f4089c91-f3de-47d, so the "Agent ID" and "Output file" wording matches the actual pi output.
- The open question is confirmed with a real .output file: sub=0 serves text "" and the walk-back reads the whole 281 KB file. A real transcript holds user, assistant and toolResult sidechain records, and renderLogChunk drops all of them. No fix here: spec 6 forbids special casing and existing tests pin that parsed JSON records never leak raw JSON. The user decides on the follow-up.
- Harmless observation, no action: rolePid has a merger branch that is unreachable today, because AGENT_ROLE has no merge state. The merger log still lists and serves through the merger handle.

Live-test report (2026-10-11). Worktree feat/88-webui-agent-history at f8896ae, tree clean.

- Acceptance re-run: `node src/kanban.test.ts`, `node src/orchestrator.test.ts` and `node src/webui.test.ts` all pass.
- Browser smoke (Playwright, real HTTP server via startWebUi port 0, temp fixture root with 3 tasks and a real subagent fixture). Result: 26 of 27 checks pass. The one miss is an expected, pre-existing 404 on `/api/projects` in the single-project server (the page tolerates it); it is not related to this change.
- Passed, user flows: run buttons render in one row in log-mtime order across roles with the live run rightmost and spinning; a reviewer run with two Agent calls shows two subagent buttons stacked vertically (`flex-direction: column`); a sub click opens that transcript and marks the button active; switching runs clears the sub buttons; a legacy-only task opens its legacy log; a finished run's pane shows its rendered content.
- Passed, API and trust boundary: run-suffixed handles serve their own file (never the legacy one); merger handle accepted; junk handle, path traversal, `sub=1abc` and an out-of-range `sub` all 404; a log with no Agent records returns an empty list; `sub=list` returns the two fixtures in log order.
- Passed, escaping fix (f8896ae): task files named `000001_quo"te.md` and `000002_back\slash.md` each open their own log through their run button, with zero page errors.
- Reconfirmed spec 6 limitation: a sidechain-only `.output` (real pi shape) serves 200 but renders an empty pane; a non-JSON line in the same file passes through. This is the open question below.
- Verdict: the change matches specs 1 to 6 and no code fix is needed. State set to to-merge.

Merger notes (2026-10-11). Worktree feat/88-webui-agent-history, branch merged into main.

- Step 1, merge main into feat/88-webui-agent-history: one conflict in src/webui.ts, in the agentLogPayload walk-back loop. Main's #84 changed readRange to return [text, boundary] and set next = boundary on a forward poll, so a tail lands on a record boundary; main reads `log`. This branch reads `target`, the file the request serves (the parent log, or the subagent .output file for sub=<n>). Resolution: main's record-boundary logic stays, applied to `target`; sub=list and subagentLogs keep reading `log`, the parent log. src/webui.test.ts auto-merged: the branch's per-run, handle and sub assertions plus main's to-merge/merging state names, four-pair layout and priority-order tests.
- Step 2, merge feat/88-webui-agent-history into main: fast-forward (01136ea..d93e444), no conflicts. `node src/kanban.test.ts`, `node src/orchestrator.test.ts` and `node src/webui.test.ts` pass in the worktree after the merge and again on main. No fixes needed.

# Open questions

1. Subagent transcripts show an empty pane. A real pi .output file holds sidechain records that renderLogChunk drops. Spec point 6 says no special casing, so the file is served unchanged. Do you want a follow-up task that teaches renderLogChunk the sidechain record shapes, or is the empty pane acceptable?
