---
name: "refactor: rebuild the integration Specs body from the board"
priority: "medium"
state: "done"
worktree: ""
issuer: "#308"
complexity: "simple"
shortName: "scope-covered-summaries-specs-body"
---

# Summary
Generate the integration task Specs as a `## Own task` section followed by a `## Covered tasks` section with one `### #<num> <name>` heading and a quoted summary per ref, and rebuild that whole body from the board on append. Remove `integrationBullet` and the tail-line parsing in `integrationBullets`. Reword the three docs that describe the old bullet-per-ref shape.

# Specs
## Scope

This is the pipeline half of #308. The renderer half (blockquote support in the dialog `md`, `#m-body blockquote` CSS) is a separate task and is NOT yours. Your files:

- `src/orchestrator/pipeline.ts`
- `tests/orchestrator/integration.test.ts`
- `agents/integration-tester.md`
- `skills/se-llm-team/SKILL.md`
- `docs/architecture.md`

Touch nothing in `src/webui/` or `tests/webui/`. The quotes in your output render as literal `>` text until the renderer task lands. That is expected, not a defect to work around.

## Problem

`integrationSpecs` (`src/orchestrator/pipeline.ts:59-61`) builds the Specs of an integration task as one flat list: a head line, then one bullet per covered task with its `# Summary` indented by two spaces (`integrationBullet`, `:51-57`), then the four instruction lines of `INTEGRATION_TAIL` (`:44-49`). In the generated file the upstream summaries sit in the same list as the integration task's own instructions, so a reader cannot tell which text is the contract and which is context. Live example: `.kanban/000305_integration_of_303.md:15-25`.

The append path re-parses the old Specs by cutting at the first line equal to a tail line and splitting on `\n(?=- #\d+ )` (`integrationBullets`, `:63-70`). That parsing is why the shape cannot change piecemeal: it must be replaced, not patched.

## Target Specs body

Generated for two covered tasks, with the own instructions first:

```
## Own task

Perform integration testing following the merge of #302, #303.

Run the project test script in the root checkout.
Report defects and coverage gaps in `# Open questions`.
Read the full task file of a covered ref when its summary is not enough.
Do not edit code. Do not commit. Do not create a task. Do not change task states.

## Covered tasks

### #302 <covered task name>

> <covered summary line 1>
> <covered summary line 2>

### #303 <covered task name>

> <covered summary line 1>
```

Rules:

- The first sentence names every covered ref inline, comma-separated, ascending, deduplicated. The `###` headings name the same set in the same order. The two lists must never disagree. Derive both from the one ref array so they cannot drift.
- `## Own task` and `## Covered tasks` are level-2 headings inside `# Specs`. Do not create a new top-level section: `replaceSections` (`src/kanban.ts:339-371`) only rewrites named `# ` sections.
- Every summary line is prefixed with `> `. An empty line inside a summary becomes a lone `>`. Summary text stays verbatim otherwise, trimmed at both ends.
- Nothing from the covered summaries is indented or bulleted any more. `integrationBullet` and the tail-line parsing in `integrationBullets` go away entirely. Keep `INTEGRATION_TAIL` as the source of the four own-instruction lines; the head line `INTEGRATION_HEAD` becomes the first sentence of `## Own task`.

## Append path

`ensureIntegrationTask` (`src/orchestrator/pipeline.ts:100-124`):

- Read the existing refs from the Covered tasks entries (the `### #<num> ` headings), add the new ref, dedupe, sort ascending.
- Rebuild the whole Specs body from that ref set, taking each covered task's name and `# Summary` from the fresh board list the function already reads. Do not parse the old body for names or summaries, and do not match instruction lines.
- The result must be idempotent: adding a ref that is already covered leaves the Specs byte-identical. Appending must leave the previous entries byte-identical, since a done task's name and summary do not change.
- A ref whose task is no longer on the board has no name or summary to quote. Drop it from the rebuilt body rather than emitting an empty entry, and log the drop. The name and summary still list only the refs that survive, so the two lists stay in agreement.
- Keep every other field as today: name, shortName, priority `low`, complexity `simple`, issuer `auto`, notes, no blockedBy, no worktree, state `to-integration-test`. The existing guards stay: skip a ref a waiting or running integration task already names, and create a fresh task when the target left `to-integration-test` between the read and the write.

## Docs and readers

- `agents/integration-tester.md:7` says the covered refs are "one bullet per ref with the covered task's Summary". Reword to the `## Covered tasks` section, one `### #<num> <name>` entry with a quoted summary per ref.
- `skills/se-llm-team/SKILL.md:19` and `docs/architecture.md:28` say "one `# Specs` bullet per new covered ref". Reword the same way.

## Tests

`tests/orchestrator/integration.test.ts` pins the old shape in the `waitingTask` fixture at `:88` and the part-5 fixture at `:281`, and in the assertions at `:191-203`, `:225-226`, `:239`, `:243-245`, `:248`, `:330`. Update every one of them to the new shape and keep all the existing field, state, dedupe and slot assertions. Where an assertion counts `- #<num> ` bullets, count `### #<num> ` headings instead.

Add:

- The generated Specs contain `## Own task` before `## Covered tasks`, and both before the first `### ` heading.
- One `### #<num> ` heading per ref, in ascending order.
- Every non-blank summary line is quoted: it starts with `> ` or is a lone `>`.
- The first sentence after `## Own task` lists exactly the same refs, in the same order, as the `###` headings.
- An append keeps the earlier entry byte-identical (compare the substring of the old body against the new one) and adds exactly one entry.
- A second append of the same ref changes nothing at all: the whole `specs` string is unchanged.

## Acceptance criteria

Run in the worktree:

- `node tests/orchestrator/integration.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0.

## Out of scope

- No change to `agents/integration-tester.md` beyond the wording above, and no change to the role's behaviour.
- No migration of existing integration task files. The next append regenerates `# Specs` from the board.
- No change to the issuer, the `auto` value, the priority or the state machine.
- No blockquote support anywhere. That is the sibling task.

# Notes
- Rewrote the generated integration Specs body (`src/orchestrator/pipeline.ts`): `## Own task` with one sentence (`INTEGRATION_HEAD` lost its trailing colon) plus the four `INTEGRATION_TAIL` lines, then `## Covered tasks` with one `### #<num> <name>` entry and a `> `-quoted summary per ref. Removed `integrationBullet` and the tail-line parsing in `integrationBullets`; `integrationSpecs` now takes the covered `Task[]` and derives the head refs and the headings from that one array.
- Append path: refs come from the `### #<num> ` headings via the task name (unchanged `integrationRefs`), the body is rebuilt from the fresh `listAll` board. New `coveredOnBoard` drops a ref with no board task and logs `integration specs: dropped #<num>, no such task on the board`; the name, the summary and the body all use the surviving set, so the two lists cannot disagree. Every other field and both existing guards are unchanged.
- Tests (`tests/orchestrator/integration.test.ts`): moved the `waitingTask` and part-5 fixtures and every bullet-counting assertion to the new shape, added shape helpers (`h2`, `entryRefs`, `ownRefs`, `quoted`, `entryOf`). New pins: section order, one heading per ref ascending, every summary line quoted, head sentence refs equal the heading refs, an append keeps the earlier entry byte-identical and adds exactly one entry, a repeat append of the same ref leaves the whole `specs` string unchanged, and a ref that left the board is dropped with no empty entry.
- Reworded `agents/integration-tester.md`, `skills/se-llm-team/SKILL.md` and `docs/architecture.md` to the `## Covered tasks` / `### #<num> <name>` shape.
- Assumption: the blockquote and `## Covered tasks` lines render as literal text until the renderer task (#308 sibling) lands. That is expected per the Specs.
- Noted risk: a rebuild whose every ref left the board would write an empty `test: integration of .` name. Unreachable today, because the appended ref is the task that just reached done and is always on the board.

Review of 1b785f2 (first pass): pass.
- `integrationSpecs` derives the head refs and the `###` headings from one array, so the two lists cannot disagree: src/orchestrator/pipeline.ts:61, :53.
- `coveredOnBoard` drops a ref with no board task and logs it, so name, summary and body rebuild on the survivors only: src/orchestrator/pipeline.ts:69, :128.
- New shape pins (section order, ascending headings, quoted summaries, head refs equal headings, byte-identical earlier entry, repeat append unchanged, vanished ref dropped): tests/orchestrator/integration.test.ts:238, :278, :296, :307.
- Tests: tests/orchestrator/integration.test.ts exit=0, tests/context-symlinks.test.ts exit=0, tests/plugin.test.ts exit=0.
- Non-blocking: `integrationRefs` still takes the ref set from the task name, not from the `###` headings that the Specs name. The outcome is identical for new tasks and better for a legacy body that has no headings yet. Switch to the headings when no legacy integration task remains.
- Non-blocking: the part-3 banner still says "one bullet per ref" (tests/orchestrator/integration.test.ts:246). Reword on the next touch.

## Live test (2026-10-21)

Lane: daemon e2e, fixture state. The driver runs the real orchestrator (`src/orchestrator.ts --root <fixture> --rescan-seconds 1 --poll-minutes 0.01`, `SE_LLM_TEAM_NO_WEBUI=1`, fixture `HOME` and `XDG_CONFIG_HOME`) on a git fixture board, and drives the append path the way the daemon does: a task sits in `live-testing` with a dead pid file and an `exit` file holding `0`, so the liveness poll moves it to `done` and calls `ensureIntegrationTask`. Three tasks finish in sequence (#1 create, #2 append, then #1 deleted and #3 append, with a repeat done of #2 between). Control: the same driver on the parent commit d381ad8 in `/tmp/lt309/pre-fix`.

| Claim | Printed proof, merged 1b785f2 | Control d381ad8 |
| --- | --- | --- |
| C1 the created body opens with `## Own task`, then `## Covered tasks`, both before the first `### ` heading, and adds no top-level section | PASS: own=0 covered=9 firstHeading=11 topLevel=0 | FAIL: own=-1 covered=-1 firstHeading=-1 topLevel=0 |
| C2 one `### #<num> <name>` heading per covered ref, ascending, and no `- #<num>` bullet | PASS: headings=[1] bullets=[] | FAIL: headings=[] bullets=[1] |
| C3 every non-blank summary line in the entry is quoted (`> `), no unquoted line | PASS: quoted=1 unquoted=0 first="> Alpha summary line one. Alpha summary line two." | FAIL: quoted=0 unquoted=0 first="none" |
| C4 the head sentence names exactly the `###` heading refs, in the same order | PASS: head=[1] headings=[1] | FAIL: head=[] headings=[] |
| C5 `## Own task` keeps the four `INTEGRATION_TAIL` lines and a head sentence that names the refs | PASS: tailMissing=0 headOk=true | FAIL: tailMissing=0 headOk=false |
| C6 an append keeps the earlier entry byte-identical and adds exactly one entry | PASS: identical=true entries=[1,2] | FAIL: identical=false entries=[1,2] |
| C7 after an append the refs ascend and the body headings, the head sentence, the name and the Summary name the same set | PASS: body=[1,2] head=[1,2] name=[1,2] summary=[1,2] | FAIL: body=[1,2] head=[] name=[1,2] summary=[1,2] |
| C9 a repeat done of a covered ref leaves the whole `specs` string byte-identical | PASS: sha=32d446b3df23 then=32d446b3df23 | PASS: sha=d9279c9eda7d then=d9279c9eda7d |
| C8 a covered ref that left the board is dropped from the rebuilt body, no empty entry, drop logged, lists still agree | PASS: refs=[2,3] dropped=true emptyEntry=false dropUsesNameAndSummary=true | FAIL: refs=[1,2,3] dropped=false emptyEntry=false dropUsesNameAndSummary=true |
| C10 every other field is kept (name, shortName, priority low, complexity simple, issuer auto, state to-integration-test) | PASS: name="test: integration of #1, #2" shortName=integration-of-1 priority=low complexity=simple issuer=auto | PASS: name="test: integration of #1, #2" shortName=integration-of-1 priority=low complexity=simple issuer=auto |

Assumptions that shaped the checks:
- Covered refs are #1, #2, #3, printed by the driver from the files `createTask` wrote, not assumed.
- The integration lane slot is held by a fixture pid in `.kanban/.pids/integration-tester.pid`, so the one integration task waits in `to-integration-test` through every phase and the append path is the thing under test, not the spawn. The driver records no unexpected agent spawn (`spawns=""`).
- The repeat done of #2 (C9) is a hand state edit back to `live-testing` with a fresh dead pid and exit file, the scenario the code comment names (a dead live-tester bounces the task back to `to-live-test`).
- The quotes and the `## Covered tasks` headings render as literal text in the dialog until the sibling renderer task (#308) lands. That is the Specs' stated expectation, not a defect.

Not exercised:
- The lone `>` line for a blank line inside a summary: the fixture summary parsed as one line (`parsedSummary="Integration test of the merged base branch after #1."`), so real content did not reach a blank summary line.
- A rebuild in which every ref left the board: the appended ref is always the task that just reached `done`, so the empty-body case is unreachable from this lane, as the Notes already say.
- The three reworded docs are a text scan, not a frozen row: `agents/integration-tester.md:7` now says "under `## Covered tasks`, one `### #<num> <name>` entry per ref with the covered task's Summary quoted under it", and `skills/se-llm-team/SKILL.md:19` and `docs/architecture.md:28` say "a `## Covered tasks` section with one `### #<num> <name>` entry and a quoted summary per covered ref". No "one bullet per ref" phrase is left in `agents/`, `skills/` or `docs/`.

Checker note: the first control run aborted on the C8 wait (that tree never logs the drop) and its C4 passed vacuously on two empty lists. Both were checker bugs, fixed before the tally: C8 records a FAIL on a wait timeout, and C4 requires a non-empty pair. No product change.

Result files: `/tmp/lt309/run3.out` (merged, 10/10), `/tmp/lt309/run3-pre.out` (parent, 2/10), `/tmp/lt309-result-merged.json`, `/tmp/lt309-result-parent.json`.
