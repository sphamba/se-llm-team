---
name: "refactor: rebuild the integration Specs body from the board"
priority: "medium"
state: "doing"
worktree: "refactor/309-scope-covered-summaries-specs-body"
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
