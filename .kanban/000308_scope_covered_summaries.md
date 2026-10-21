---
name: "refactor: scope the covered task summaries in generated integration Specs"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#301"
complexity: "moderate"
shortName: "scope-covered-summaries"
---

# Summary
Generated integration Specs mix upstream summaries into the instruction list. Give them a level-2 `Own task` section first and a `Covered tasks` section with one `### #<num> <name>` heading and a quoted summary per ref, rebuild that section from the board on append, and teach the dialog renderer blockquotes so the quotes render.

# Specs
## Problem

`integrationSpecs` (`src/orchestrator/pipeline.ts:59-61`) builds the Specs of an integration task as one flat list: a head line, then one bullet per covered task with its `# Summary` indented by two spaces (`integrationBullet`, `:51-57`), then the four instruction lines of `INTEGRATION_TAIL` (`:44-49`). In the generated file the upstream summaries sit in the same list as the integration task's own instructions, so a reader cannot tell which text is the contract and which is context. Live example: `.kanban/000305_integration_of_303.md:15-25`.

Two follow-on facts:

- The append path re-parses the old Specs by cutting at the first line equal to a tail line and splitting on `\n(?=- #\d+ )` (`integrationBullets`, `:63-70`). That parsing is why the shape cannot change piecemeal.
- The dialog's markdown renderer `md` (`src/webui/logpane.ts:134-181`) supports headings, top-level bullets, fenced blocks and pipe tables, but escapes `>` first, so a blockquote renders as literal `&gt;` text.

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

- The first sentence names every covered ref inline, comma-separated, ascending, deduplicated. The `###` headings name the same set in the same order. The two lists must never disagree.
- `## Own task` and `## Covered tasks` are level-2 headings inside `# Specs`. Do not create a new top-level section: `replaceSections` (`src/kanban.ts:339-371`) only rewrites named `# ` sections.
- Every summary line is prefixed with `> `. An empty line inside a summary becomes a lone `>`. Summary text stays verbatim otherwise, trimmed at both ends.
- Nothing from the covered summaries is indented or bulleted any more. `integrationBullet` and the tail-line parsing in `integrationBullets` go away.

## Append path

`ensureIntegrationTask` (`src/orchestrator/pipeline.ts:100-124`):

- Read the existing refs from the Covered tasks entries (the `### #<num> ` headings), add the new ref, dedupe, sort ascending.
- Rebuild the whole Specs body from that ref set, taking each covered task's name and `# Summary` from the fresh board list the function already reads. Do not parse the old body for names or summaries, and do not match instruction lines.
- The result must be idempotent: adding a ref that is already covered leaves the Specs byte-identical. Appending must leave the previous entries byte-identical, since a done task's name and summary do not change.
- Keep every other field as today: name, shortName, priority `low`, complexity `simple`, issuer `auto`, notes, no blockedBy, no worktree, state `to-integration-test`.

## Renderer

Add blockquote support to `md` (`src/webui/logpane.ts:134-181`):

- One or more consecutive lines starting with `> ` form one `<blockquote>`. A line that is exactly `>` is a blank line inside the quote. A blank line ends the quote.
- Inline formatting inside the quote (code, bold, links) works through the existing `inline` helper, and text stays escaped.
- A `>` inside a fenced block stays literal, and headings, top-level bullets, tables and fences keep their current output.
- Add a `#m-body blockquote` rule to the dialog CSS in `src/webui/page.ts` (the block near `:303-318`): a subtle left border, small left padding and the soft text colour, no layout shift for the surrounding paragraphs.

## Docs and readers

- `agents/integration-tester.md:7` says the covered refs are "one bullet per ref with the covered task's Summary". Reword to the `## Covered tasks` section, one `### #<num> <name>` entry with a quoted summary per ref.
- `skills/se-llm-team/SKILL.md:19` and `docs/architecture.md:28` say "one `# Specs` bullet per new covered ref". Reword the same way.

## Tests

- `tests/orchestrator/integration.test.ts` pins the old shape at `:88` and `:281` (fixtures) and at `:191-203`, `:225-226`, `:239`, `:243-245`, `:248`, `:330`. Update them to the new shape and keep the field, state, dedupe and slot assertions.
- Add: the generated Specs contain `## Own task` before `## Covered tasks`; one `### #<num>` heading per ref in ascending order; every summary line is quoted; the first sentence lists the same refs.
- Add: an append keeps the earlier entries byte-identical and adds exactly one entry; a second append of the same ref changes nothing.
- `tests/webui/logpane.test.ts`: add quote cases - one line, two paragraphs separated by `>` alone, inline code inside a quote, a `>` inside a fenced block staying literal.
- `tests/webui/page.test.ts`: add one assertion that the `#m-body blockquote` rule exists.

## Acceptance criteria

Run in the worktree:

- `node tests/orchestrator/integration.test.ts` exits 0.
- `node tests/webui/logpane.test.ts` exits 0.
- `node tests/webui/page.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0. Then, by hand: open an integration task's detail dialog and confirm the `Covered tasks` section shows real quotes, not literal `>` text; read the task file and confirm the own instructions come before the covered summaries and cannot be mistaken for them.

## Out of scope

- No change to `agents/integration-tester.md` beyond the wording above, and no change to the role's behaviour.
- No migration of existing integration task files. The next append regenerates `# Specs` from the board.
- No change to the issuer, the `auto` value, the priority or the state machine.
- No blockquote support anywhere except the detail dialog body.

# Notes
