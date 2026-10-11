---
name: "feat: blockedBy task attribute; failsafe skips blocked tasks; PM honors holds"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Tasks gain an optional blockedBy frontmatter attribute listing blocker task refs, e.g. "#42, #43", to make the PM's scheduling holds machine-readable. The orchestrator's automatic scheduler never promotes a blocked task; the PM honors blockedBy at promotion time and removes entries whose blocker is done (no auto-clear).

# Specs
New attribute "blockedBy": optional list of task refs, e.g. "#42, #43", helping the project manager schedule. User decisions settled: the auto-schedule failsafe skips tasks whose blockers are not done; the PM maintains the list manually (nothing rewrites task attributes behind the scenes).

Facts (verified on current main):
- parseTask (src/kanban.ts:67-95): frontmatter attrs split at the first ":", "..." unquoted via decodeAttr; the returned object picks only name/priority/state/worktree/summary/specs/notes/conflicted - a blockedBy field must be added to the Task interface (:18-25) and that pick. Values are single strings: "#42, #43" stays one comma-joined string. Unknown attrs survive rewrites losslessly (kanban.test.ts:176-186).
- serializeFrontmatter (:160-163) always writes ${k}: "${encodeAttr(v)}" (escaping backslash, quote, newline) - blockedBy: "#42, #43" is written exactly as needed; same quoting mechanism as the issuer design (task #72, queued, no code in main yet).
- createTask (:255-278) builds frontmatter via serializeFrontmatter({name, priority, state: "backlog", worktree: ""}) :265 - an optional blockedBy slots into this object.
- updateAttrs (:165-185) is the conflict-guarded frontmatter patcher used by setState/setWorktree; updateTask (:219-238) patches {name?, priority?, summary?, specs?} with name/priority via updateAttrs :229-231 - blockedBy joins the updateAttrs patch.
- TaskRef (src/kanban.ts:30-36, built :113-117): file/num/name/priority/state/summary - adding blockedBy flows it into kanban_list and kanban_get automatically (src/index.ts).
- index.ts kanban_update (:77-91): params flow wholesale to updateTask - a new param works once updateTask's patch accepts it. kanban_create (:56-73) gains the optional param.
- autoSchedule (src/orchestrator.ts:624-647, called :604): filters !t.conflicted, picks backlog candidates, gates on cfg.autoScheduleMinutes idle, ranks priority then number. Task #75 (queued) adds an open-questions skip to the same function; task #78 (queued) rewrites the merge flow in the same file.
- skills/se-llm-team/SKILL.md: the PM scheduling step (promote backlog to to-do in priority order) has no blockedBy awareness.
- Collisions: src/kanban.ts + src/kanban.test.ts + index.ts + SKILL.md are dirty on the 000074 branches (reviewing); src/orchestrator.ts is queued work (000075, 000078). src/webui.ts is not touched by this task.

Changes:
1. Task interface and parseTask expose blockedBy (optional string like "#42, #43"; absent = no blocks). TaskRef gains it, so kanban_list and kanban_get include it.
2. createTask gains optional blockedBy (written only when provided); the kanban_create tool exposes it.
3. updateTask gains blockedBy via updateAttrs with replace semantics (the parameter value replaces the whole list; omitted = unchanged); the kanban_update tool exposes it. Entries are "#<num>" refs comma-joined; no extra validation beyond format (the PM maintains the list).
4. autoSchedule skips candidates whose blockedBy entries are not done: resolve each "#<num>" against the loaded tasks; an entry blocks while its task exists and is not done; a reference resolving to no existing task is ignored. Combine cleanly with the #75 open-questions skip (sequence per holds).
5. skills/se-llm-team/SKILL.md: the PM scheduling step honors blockedBy - never promote a task whose blockers are not done, and remove entries whose blocker is done at scheduling time (PM maintains the list; no auto-clear).
6. Tests: src/kanban.test.ts - blockedBy roundtrip (parse, create with, update replace, list/get inclusion). src/orchestrator.test.ts - autoSchedule skips a task blocked by a not-done task, schedules normally when the blocker is done, ignores ghost refs. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- Tasks can carry blockedBy "#42, #43"; kanban_list and kanban_get show it; kanban_update replaces it.
- The failsafe never auto-promotes a blocked task; unblocked tasks schedule normally.
- The PM honors blockedBy at promotion time (skill updated).
- Typecheck and the full test suite pass.

Constraints:
- Files: src/kanban.ts, index.ts, src/kanban.test.ts, src/orchestrator.ts, src/orchestrator.test.ts, skills/se-llm-team/SKILL.md.
- HOLD behind 000074 (reviewing: kanban.ts/index.ts/SKILL.md), behind 000078 (queued: kanban.ts/orchestrator.ts), and behind 000075 (queued: orchestrator.ts autoSchedule, same function - sequence after it). Promote after those merge; rebase line numbers on the merged code.
- No webui changes in this task (the webui task renders blockedBy and the id links).

# Notes

- [2026-10-11 17:11] Implemented on feat/80-blockedby-task-attribute, commit 37a8cc7, branched from the main tip d93e444 (000074 and 000078 are merged there; only the 000075 hold was still live - its branch changes one backlog-filter line, my filter sits at the promotion pick ~10 lines below, so the #75 merge stays conflict-free).
  - src/kanban.ts: Task, TaskRef and parseTask carry blockedBy (absent reads as ""); listTasks returns it; updateTask patches it via updateAttrs with replace semantics (the value replaces the whole list, "" clears, omitted stays unchanged); createTask writes it only when provided, so the frontmatter byte-format is unchanged otherwise.
  - src/orchestrator.ts: new blockedByUndone helper. An entry blocks while its task exists and is not done; a ghost ref is ignored; an all-blocked backlog keeps the idle window armed, so the promotion fires as soon as the blocker reaches done.
  - index.ts: kanban_create and kanban_update gained the optional blockedBy param; the kanban_list and kanban_get descriptions mention it.
  - skills/se-llm-team/SKILL.md step 6: never promote a task whose blockers are not done; prune done blocker refs with kanban_update at scheduling time (the PM maintains the list, no auto-clear).
  - Tests: src/kanban.test.ts gained a blockedBy roundtrip section (parse, create with, update replace, clear, list/get inclusion, byte-format without blockedBy). src/orchestrator.test.ts gained part AB, a daemon smoke: a critical task held despite priority, a ghost-only ref promoted (ghost ignored), an unblocked medium task promoted, and the blocked task promoted after its blocker settled done. Full suite green: kanban.test.ts, orchestrator.test.ts (all parts), webui.test.ts. Part AB awaits the daemon's full exit before removing its fixture (a sweep mid-flight still writes into it).
  - Typecheck: no local tsc (the project checks run with node directly). A one-off strict tsc run reports the same two pre-existing errors as main, only at shifted line numbers - no new type errors.

- [2026-10-11 17:40] Reviewed commit 37a8cc7 against the Specs. No defects, no fixes.
  - All six change items match the Specs: Task/TaskRef/parseTask/listTasks carry blockedBy (absent reads as ""), updateTask replaces the whole list via updateAttrs (omitted unchanged, "" clears), createTask writes it only when provided (byte-format unchanged otherwise), kanban_create/kanban_update expose the param, kanban_list/kanban_get descriptions mention it, SKILL.md step 6 never promotes blocked tasks and prunes done refs with kanban_update (no auto-clear).
  - blockedByUndone semantics verified: a ref blocks while its task exists and is not done; ghost, non-numeric and #0 refs are ignored; the `if (!next) return` keeps the idle window armed on an all-blocked backlog, so promotion fires as soon as the blocker reaches done. Combines cleanly with the #75 open-questions skip.
  - Full suite green in this worktree: kanban.test.ts, orchestrator.test.ts (all 20 parts incl. the new blockedBy failsafe smoke), webui.test.ts. The roundtrip asserts byte-identical output without blockedBy.
  - Holds resolved: 000074 and 000078 are merged into the branch base d93e444; 000075 has since merged on main and git merge-tree reports 0 conflicts (the #75 change edits the backlog filter line, this change edits the promotion pick ~10 lines below). No remaining hold.
  - Note: the global tsc on this machine is a stub shim, so the typecheck claim is not locally reproducible; the project's declared checks (the three node suites) pass. Acceptance met -> to-live-test.

- [2026-10-11 17:22] Live-tested the branch in the worktree. No defects found. All three declared suites pass: node src/kanban.test.ts, node src/orchestrator.test.ts (all 20 parts, incl. the blockedBy failsafe smoke), node src/webui.test.ts.
  - User flows exercised against the worktree kanban.ts: create without blockedBy omits the attribute and keeps the known frontmatter order; create with blockedBy "#1, #3" writes `blockedBy: "#1, #3"`; getTask and listTasks expose it (absent reads as ""); kanban_update replaces the whole list; an empty value clears it (`blockedBy: ""`); an omitted blockedBy stays unchanged; unknown attrs survive a blockedBy rewrite; malformed refs ("#0, #999, junk") round-trip without a crash.
  - Failsafe: the daemon smoke holds a critical task despite priority while its blocker is not done, ignores ghost refs, promotes unblocked tasks normally, and promotes the blocked task once its blocker reaches done.
  - PM guidance present in skills/se-llm-team/SKILL.md step 6: never promote a task whose blockers are not done, prune done refs with kanban_update, no auto-clear. Acceptance met -> to-merge.
