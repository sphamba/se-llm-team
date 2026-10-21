---
name: "refactor: scope the covered task summaries in generated integration Specs"
priority: "medium"
state: "backlog"
worktree: "refactor/308-scope-covered-summaries"
issuer: "#301"
complexity: "simple"
shortName: "scope-covered-summaries"
blockedBy: "#309, #310"
---

# Summary
Verification only. Once #309 and #310 have landed, confirm the generated integration Specs carry an `Own task` section before a quoted `Covered tasks` section, the append path rebuilds it from the board, and the detail dialog renders those quotes as real blockquotes rather than literal `>` text.

# Specs
## Scope

The work is split and landed by the blockers:

- #309 - `src/orchestrator/pipeline.ts` + `tests/orchestrator/integration.test.ts` + the three docs: the `## Own task` / `## Covered tasks` shape and the board-driven append rebuild.
- #310 - `src/webui/logpane.ts` + `src/webui/page.ts` + `tests/webui/logpane.test.ts` + `tests/webui/page.test.ts`: blockquote rendering in the dialog `md` and the `#m-body blockquote` CSS.

This task now verifies the seam BETWEEN them, which neither blocker can test alone. Do not re-do their work.

## What to check

- Run `node tests/orchestrator/integration.test.ts`, `node tests/webui/logpane.test.ts` and `node tests/webui/page.test.ts`: all exit 0.
- Prove the two halves meet end to end with a throwaway script or a temporary fixture, then remove it: generate an integration task's Specs the way `integrationSpecs` does, feed the same text to `md`, and confirm the output holds a `## Covered tasks` heading followed by `### #<num> <name>` headings and a `<blockquote>` per covered summary, with no literal `&gt;` anywhere.
- Confirm the two ref lists agree: the refs in the first sentence of `## Own task` and the refs of the `### ` headings are the same set, in the same order.
- Confirm no summary text is indented or bulleted, and that an empty line inside a summary renders as a lone `>` in the file and a paragraph break in the HTML.
- Confirm `## Own task` and `## Covered tasks` are level-2 headings, so `replaceSections` (`src/kanban.ts:339-371`) still rewrites `# Specs` as a whole and the append does not emit a stray top-level section.
- Confirm the renderer change did not alter the log pane: `renderLogChunk` output for a quote-containing log stays as it was, and the table, fence, heading and bullet branches are unchanged.
- Confirm the field contract still holds: name, shortName, priority `low`, complexity `simple`, issuer `auto`, notes, no blockedBy, no worktree, state `to-integration-test`.

## Acceptance criteria

Run in the worktree:

- `pnpm test` exits 0.

At live test, in the repo root: `pnpm test` exits 0. Then, by hand: open an integration task's detail dialog and confirm the `Covered tasks` section shows real quotes, not literal `>` text. Read the task file and confirm the own instructions come before the covered summaries and cannot be mistaken for them.

## Out of scope

- No migration of existing integration task files. The next append regenerates `# Specs` from the board.
- No change to the issuer, the `auto` value, the priority or the state machine.
- No new feature work in this task. If a blocker's contract is wrong, report it.

# Notes
Split into #309 (pipeline + docs) and #310 (webui renderer). The two pieces touch disjoint files and share no module, so they run in parallel. #308 stays in backlog until both land, then verifies the seam: the generated quoted body rendered by the updated `md`.

Guidance for future Splitters:

- The pieces of a renderer-plus-data change parallelize along the file boundary, not along the feature boundary. Check that the two subsets share no module before you split; here `src/orchestrator/pipeline.ts` is never imported by `src/webui/logpane.ts`.
- A piece that only updates pinned test fixtures is not its own subtask. The fixture updates belong to the task that changes the shape, because splitting them leaves the shape change unbuildable.
- Do not mark a piece `moderate` only because the parent was. Each piece was judged on its own: #309 has the exact target body in its spec and a test gate, so it is `simple`; #310 carries escaping and fence-interaction edge cases with no exact expected HTML, so it is `moderate` and gets its own Splitter pass.
- Cwd `SPECS.md` in the main checkout is shared mutable state: a sibling Splitter spawned for a subtask repoints it. Pass `file` explicitly on every kanban call that targets this task, and edit `.kanban/000308_scope_covered_summaries.md` directly for notes.
