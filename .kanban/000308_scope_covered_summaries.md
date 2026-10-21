---
name: "refactor: scope the covered task summaries in generated integration Specs"
priority: "medium"
state: "live-testing"
worktree: "refactor/308-scope-covered-summaries"
issuer: "#301"
complexity: "simple"
shortName: "scope-covered-summaries"
blockedBy: ""
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

## Verification result (developer)

- The worktree branch started at `d381ad8`, before both blockers. `git merge --ff-only main` in this worktree brought in #309 (`1b785f2`) and #310 (`cf34d85`), no merge commit.
- `node tests/orchestrator/integration.test.ts`, `node tests/webui/logpane.test.ts`, `node tests/webui/page.test.ts`: exit 0 each. Full `pnpm test` left to the live tester.
- Throwaway seam probe (`tests/scratch-308-seam.ts` plus a copy of the pre-#310 `logpane.ts` as `src/webui/logpane-old-308.ts`; both deleted after the run). It generated two refs through `ensureIntegrationTask`, then a third after a board-side rename and summary rewrite, and fed the same Specs text to `md`:
  - Shape: `## Own task` before `## Covered tasks`, both level 2; one `### #<num> <name>` entry per ref in ascending order; the first-sentence ref list equals the heading ref order; every summary line is quoted; no indentation, no bullets; a blank summary line is a lone `>`.
  - Render: one `<blockquote>` per summary, no `&gt;` in the HTML, `<h2>`/`<h3>` as expected, the lone `>` is a paragraph break inside one blockquote, no `<h1>`.
  - `replaceSections` seam: the raw file has exactly `# Summary`, `# Specs`, `# Notes` top-level; both `##` headings round-trip inside `task.specs`; re-covering a queued ref leaves the file byte-identical.
  - Board-driven append: the board-side rename and summary rewrite appear in the rebuilt body and the old summary text is gone.
  - Field contract: name `test: integration of #1, #2`, shortName from the first ref, priority low, complexity simple, issuer auto, generated notes, no blockedBy, no worktree, state to-integration-test.
- Log pane: `renderLogChunk` source is unchanged (the `d381ad8..HEAD` diff touches only `md`), and a corpus of prose, table, fence, heading and bullet chunks renders byte-identically to the pre-#310 renderer. A log line starting with `> ` does change, because `renderLogChunk` shares `md`: before `<p>&gt; quoted log line</p>`, now `<blockquote><p>quoted log line</p></blockquote>`. So the What-to-check line "renderLogChunk output for a quote-containing log stays as it was" cannot hold together with the dialog blockquote change (#310's contract says keep the log pane identical). Not fixed: it is #310's scope, and escaping the log pane would break the dialog quote rendering. Non-quote log branches are unaffected.
- Leftover: `tests/orchestrator/integration.test.ts:246` still says "one bullet per ref" in the part-3 comment. That file is #309's, not changed here.
- No source, test, or doc edit. The worktree is clean after removing the scratch files, so there is nothing to commit beyond the fast-forward.

Review of cf34d85 (first pass): PASS, no fixes. Verification-only task, empty diff on a clean tree, both blockers already in `main`.

- `src/orchestrator/pipeline.ts:64` emits `## Own task` before `## Covered tasks`, both level 2, and the head refs and the `### ` headings both come from the one `covered` array, so they cannot disagree.
- `src/webui/logpane.ts:152` renders the quote branch and `src/webui/logpane.ts:205` feeds the same `md` to the log pane, which is the root of the one clause below that cannot hold.
- `src/kanban.ts:142` matches `^# ` only, so the level-2 sections round-trip inside `task.specs` and `replaceSections` (`src/kanban.ts:339`) still rewrites `# Specs` as a whole with no stray top-level section.
- `src/webui/page.ts:309` carries the `#m-body blockquote` CSS; the table, fence, heading and bullet branches are unchanged in `cf34d85` apart from the added `closeQuote()` calls, and a quoted line inside a fence stays literal (pinned at `tests/webui/logpane.test.ts:352`).

Tests: exit=0 tests/orchestrator/integration.test.ts, exit=0 tests/webui/logpane.test.ts, exit=0 tests/webui/page.test.ts. No source edit, so no red proof is owed.

- Seam proven independently with my own probe rather than the developer's: the generated body renders as 2 `<h2>`, 2 `<h3>`, 0 `<h1>`, 2 `<blockquote>`, no literal `&gt;`, and a lone `>` becomes a paragraph break inside one blockquote. The ref list is `1,2` in the head sentence and `1,2` in the headings. The field contract holds at `src/orchestrator/pipeline.ts:88-99`.
- Non-blocking: the What-to-check clause "`renderLogChunk` output for a quote-containing log stays as it was" does not hold, and the developer was right to report it instead of fixing it. Probed with a real record: a `text_delta` of `> quoted log line` now yields `<blockquote><p>quoted log line</p></blockquote>`, and the pre-#310 `md` at `d381ad8` had no quote branch, so it yielded `<p>&gt; quoted log line</p>`. Both contracts cannot hold while `md` is shared by the dialog and the pane. Upgrade path, only if literal `>` in agent prose ever matters: an option flag on `md` that the dialog passes and the pane does not.
- Non-blocking: `tests/orchestrator/integration.test.ts:246` still says "one bullet per ref" and the body is quotes now. That is #309's file, unchanged here. Upgrade path: reword it on the next touch of that file.
- Method: a claim in a previous Notes entry can be right while a grep for it comes back empty, because a comment wraps the phrase across a line break. Read the window before doubting the claim.

# Open questions

- Agent text in the run log that starts with `> ` now renders as a real blockquote, not literal `>` text. #308 asked for the log pane to stay as it was and #310's contract said the same, but the dialog and the pane share one `md`, so the two cannot both hold. Keep the blockquote in the pane (current, simpler), or give `md` an option so the pane keeps literal text?


