---
name: "feat: issuer attribute on tasks; webui differentiates task-issued from user-issued"
priority: "high"
state: "live-testing"
worktree: "feat/72-issuer-attribute-on"
---

# Summary
Tasks gain an issuer attribute: "user" when the user requested the task, or "#<num>" when it was created after live-testing of task #<num>. The webui displays the issuer and makes task-issued tasks visually quieter while user-issued tasks stay visually more prominent.

# Specs
Track who issued each kanban task and reflect it in the webui (user feedback). User-issued tasks are somewhat more important visually; tasks issued by another task (created after its live-testing) are displayed visually quieter.

Facts:
- Task files are .kanban/*.md with YAML frontmatter (name, priority, state, worktree) plus # Summary, # Specs, # Notes sections. Frontmatter parse/serialize and createTask live in src/kanban.ts; the kanban_create/kanban_update/kanban_list/kanban_get tools live in src/index.ts.
- Live-test issues flow through the live-tester agent's task notes; follow-up tasks are then created by the project manager with kanban_create (see task 000034 notes: "Issues found (passed to the PM for new tasks)"). So the issuer is known at kanban_create time.
- Webui: task cards are rendered from GET /api/tasks; the detail card has an #m-attrs block for attributes. Active lane 000070 (reviewing) rewrites src/webui.ts and src/webui.test.ts (agent log pane only).
- Existing task files have no issuer attribute.

Changes:
1. Frontmatter: new optional "issuer" attribute. Value "user" when the user requested the task, or "#<num>" when the task was created after live-testing of task #<num>, for example issuer: "#42" (store as a quoted YAML string; the serializer must quote it, # starts a YAML comment otherwise).
2. kanban_create gains an optional issuer parameter accepting "user" or "#<num>", default "user". createTask writes it into the frontmatter. The issuer is set at creation only and never changed afterwards.
3. kanban_list and kanban_get include issuer in their output.
4. Webui: task cards and the detail card show the issuer. Tasks issued by another task (issuer "#<num>") are visually quieter (for example dimmed text or a small #<num> badge); user-issued tasks are visually more prominent (for example an accent left border or full-contrast styling). The differentiation must be subtle but noticeable and consistent in both light and dark themes; exact styling is the developer's choice within these constraints.
5. Absent issuer (all existing task files) is treated as "user". Existing files are never rewritten to add the attribute.
6. Tests: src/kanban.test.ts (createTask writes issuer "user" by default and "#42" when passed; frontmatter round-trips the quoted value), src/webui.test.ts (issuer renders on cards and the detail card; the differentiation classes exist), extend other tests as needed. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- kanban_create with issuer "#42" produces a task whose frontmatter, kanban_get, kanban_list and /api/tasks all carry issuer "#42"; without it, "user".
- The webui shows the issuer and visually differentiates task-issued from user-issued tasks in both themes.
- Existing task files are untouched.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/kanban.ts, src/index.ts, src/webui.ts, src/kanban.test.ts, src/webui.test.ts.
- HOLD behind 000070 (reviewing): both rewrite src/webui.ts. Promote only after 000070 is done and merged, and rebase line numbers on the merged code.
- Note: 000047 and 000058 (backlog) also touch src/webui.ts, and 000064 touches src/index.ts/src/kanban.ts - promote them after this task merges, in priority order.

# Notes

- Rebased the branch onto main before starting: the hold 000070 is done and merged, and main had moved (000047's stacked webui columns, fix/69), so the webui changes sit on the merged code. No conflicts.
- src/kanban.ts: Task and TaskRef carry issuer. parseTask reads it, absent -> "user" (existing files are never rewritten). createTask writes it at creation only: values "user" or "#<num>", anything else (including absent) falls back to "user". serializeFrontmatter quotes every value, so issuer: "#42" stays a string and cannot start a YAML comment. kanban_update/setState/setWorktree never touch issuer.
- index.ts (kanban tools, file is at the repo root, not src/): kanban_create gained the optional issuer param with the rule in its description; kanban_list/kanban_get descriptions now name issuer. kanban_create passes params straight to createTask, so the tool accepts "user" or "#<num>".
- src/webui.ts: taskPayload carries issuer (the hub's per-project variant inherits it, no hub.ts change). Cards show an issuer chip after the priority chip: user-issued cards render a plain "user" chip and keep full-contrast styling; task-issued cards render the "#<num>" badge and a dimmed name (.issued). The detail card gained an issuer row in #m-attrs. The css uses var(--muted) and var(--code-bg), defined in both the light and dark palettes, so the differentiation is consistent across themes.
- Tests: kanban.test.ts covers the default, "#42" write and quoted round-trip, invalid-value fallback, absent -> "user" on a hand-written pre-change file, creation-only (state + section rewrites leave it), and list refs. webui.test.ts covers the payload issuer ("user" default, "#42" for the issued task), the card markup classes, the shipped css and the detail row. All three suites pass (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts) and strict tsc --noEmit (flags per 000071's notes) reports no error in the touched files.
- Pre-existing env-dependent failure fixed in src/orchestrator.test.ts (outside the listed files, needed for the full-suite-green acceptance): parts X and Y failed on pristine main on this machine because runDaemon inherits HOME and this machine's ~/.pi/agent/se-llm-team.json sets provider/model/thinking, leaking --provider RCP into the expected spawn flags (verified on a clean main clone before touching anything). Fix: runDaemon gained an extraEnv param and parts X and Y run with HOME at an empty temp dir, so the board config is the whole config surface. Part Y never ran before because part X failed first; it has the same leak (the user-level model fills the provider-without-model warning case).
- The real board's existing task files are untouched: all tests and the smoke run used temp dirs.
- Commit b5e8466 in the worktree feat/72-issuer-attribute-on, based on main 4d79759.
- Review (commit b5e8466): no fixes needed. Verified the Specs end to end. Frontmatter: serializeFrontmatter quotes every value, so issuer: "#42" cannot start a YAML comment, and the value round-trips. parseTask maps absent -> "user"; createTask accepts only "user" or "#<num>" and falls back to "user". updateAttrs reads all keys and patches only the requested ones, and replaceSections/appendNote write the body only, so an existing issuer survives a rename, a priority change, setState, setWorktree and a notes append, and an existing file with no issuer never gains one. Nothing but createTask writes the key, so the attribute is creation-only. index.ts declares the optional issuer param and passes params straight to createTask; kanban_get returns the whole Task as JSON and kanban_list returns the TaskRef, both with issuer. Webui: taskPayload carries issuer; hub.ts imports taskPayload and PAGE from webui.ts, so the hub view inherits the chip and the detail row; cards render a plain "user" chip or the dimmed .issued name plus the .chip.issuer "#<num>" badge; both classes are in the shipped page css and neither selector can collide with .p-* priority chips.
- Ran the full suite twice in the worktree (node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts): green both times, no flakiness. Strict tsc (typescript 7, the 000071 flags) on index.ts + src/{kanban,webui,hub}.ts shows no new error versus main. Correction to the line above: the new webui.test.ts lines add three strict errors in the test file itself (two cardHtml partial-object calls, the same pre-existing pattern as the older call right above them, plus one implicit-any callback (t) while the same file annotates such callbacks elsewhere, e.g. (e: any) in part U). Test-file only, no runtime effect, the repo has no tsconfig or typecheck script and main already carries 198 strict errors. Not worth a fix cycle.
- Light-theme legibility, for the live test to eyeball: .chip.issuer is --muted on --code-bg = 1.9:1 and .issued is --muted on the white panel = 2.2:1 in Ayu Light (dark: 3.6:1 and 3.0:1). This is the faintest de-emphasis pair the codebase already ships (#updated uses exactly --muted on --code-bg; .num uses --faint, the same #adaeb1, on the panel) and the Specs allow dimmed text, so it is not a defect, but a human should confirm the badge reads in light theme.
- The src/orchestrator.test.ts change is outside the Specs' file list but is a real pre-existing failure fix, not scope creep: on a pristine main copy in /tmp, part X stops at orchestrator.test.ts:1051 with actual ['--provider','RCP','--model','dev-model','--thinking','low'] because the daemon reads the user-level ~/.pi/agent/se-llm-team.json (src/orchestrator.ts:66) and this machine's sets provider/model/thinking. The extraEnv HOME isolation follows the file's existing pattern (homeS/homeU/homeV/homeW) and keeps every assertion in parts X and Y intact, now against the board config alone.
- Accepted as-is: parseTask does not validate a hand-written issuer value, so issuer: "bogus" would render a "bogus" chip; the Specs require only absent -> "user" and only createTask writes the key. SPECS.md and README.md still describe the frontmatter as name/priority/state/worktree; the Specs' file list excludes docs, so they are unchanged (fold into a later docs task if wanted).
- Live-test focus: a task only gets issuer "#<num>" if the Project manager actually passes it to kanban_create. Only the kanban_create tool description carries that rule; skills/se-llm-team/SKILL.md and agents/live-tester.md never mention issuer and the Specs' file list excludes them. Confirm a live-tester -> PM follow-up task lands as issuer "#<num>" and renders quieter, and that the hub view (GET /api/tasks?project=NAME) shows the chip too.