---
name: "refactor: render blockquotes in the dialog markdown"
priority: "medium"
state: "doing"
worktree: "refactor/310-scope-covered-summaries-blockquotes"
issuer: "#308"
complexity: "moderate"
shortName: "scope-covered-summaries-blockquotes"
---

# Summary
Teach the detail dialog's markdown renderer `md` blockquote blocks so quoted covered-task summaries render as real quotes instead of literal `&gt;` text, and add the matching `#m-body blockquote` CSS rule.

# Specs
## Scope

This is the renderer half of #308. The pipeline half (generating `## Own task` / `## Covered tasks` with quoted summaries) is a separate task and is NOT yours. Your files:

- `src/webui/logpane.ts`
- `src/webui/page.ts`
- `tests/webui/logpane.test.ts`
- `tests/webui/page.test.ts`

Touch nothing in `src/orchestrator/` or `tests/orchestrator/`. Do not change what the integration Specs body looks like. Your tests use hand-written quote input, not generated Specs.

## Problem

The detail dialog renders the task body through `md` (`src/webui/logpane.ts:134-181`). It supports headings, top-level bullets, fenced blocks and GFM pipe tables, but it escapes `>` first (the input goes through `esc`), so a blockquote line renders as a paragraph of literal `&gt;` text. Covered-task summaries are about to be emitted as quoted lines, so they currently show as a wall of `> ...`.

## Blockquote rules

Add blockquote support to `md`:

- One or more consecutive lines starting with `> ` form ONE `<blockquote>`. Push a flag and open the tag on the first such line, close it when the block ends. Do not emit a `<p>` per line.
- A line that is exactly `>` is a blank line inside the quote: it separates paragraphs inside the same blockquote. Render it as a paragraph break, not as an empty `<p>`.
- A blank line (no `>`) ends the quote.
- Inline formatting inside the quote (code, bold, links) works through the existing `inline` helper, and text stays escaped. Strip the leading `> ` before handing the remainder to `inline`.
- A `>` inside a fenced block stays literal: the fence branch keeps its position before the quote branch, or the quote branch is skipped while `fence` is true.
- Headings, top-level bullets, tables and fences keep their current output exactly. A quote must close the open list first, like the heading and table branches do.
- The blockquote closes at the end of input, in the same way `closeList` and the open fence are closed, so an unclosed quote never leaks markup.
- Keep the helpers inside `md`, because the page injects the function source and every name it reads must travel with it.

## CSS

Add a `#m-body blockquote` rule to the dialog CSS in `src/webui/page.ts`, in the block near `:303-318` where the other `#m-body` rules live:

- A subtle left border, small left padding, and the soft text colour (`var(--soft)`), which the dialog already uses.
- No layout shift for the surrounding paragraphs: give it a vertical margin consistent with the neighbouring `#m-body` rules, and no horizontal margin beyond the padding.

## Tests

`tests/webui/logpane.test.ts` - add quote cases:

- One quoted line renders one `<blockquote>` with the text, not `&gt;`.
- Two paragraphs separated by a lone `>` render one blockquote with two paragraphs inside it.
- Inline code inside a quote renders a `<code>` element inside the blockquote.
- A `>` inside a fenced block stays literal text.
- A blank line after a quote closes it, so a following line renders as a normal paragraph.
- Bold or a link inside a quote renders through `inline`.

`tests/webui/page.test.ts` - add one assertion that the `#m-body blockquote` rule exists in the page CSS. Follow the existing style of the rule assertions in that file.

Keep every existing test passing unchanged.

## Acceptance criteria

Run in the worktree:

- `node tests/webui/logpane.test.ts` exits 0.
- `node tests/webui/page.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0. Then, by hand: open a task detail dialog whose body contains quoted lines and confirm they render as real quotes, not literal `>` text.

## Out of scope

- No blockquote support anywhere except the detail dialog body: leave `renderLogChunk` and the log-pane fixups alone unless a shared helper forces a touch, and if it does, keep the log pane's output identical.
- No change to the table, fence, heading or bullet branches beyond closing the quote as they close the list.
- No new CSS beyond the one blockquote rule.
- No change to the integration Specs body. That is the sibling task.

# Notes
## Splitter decision: no split
This task is already the renderer half of #308, and the pipeline half is a separate task. The remaining work is one `md` branch, one CSS rule and two small test additions in two tightly coupled files. A separate CSS subtask would not save enough time to pay for its own review, merge and live-test cycle.

Durable guidance: do not split a small webui renderer change that also needs one CSS rule and a matching test assertion. Split only when each independent file set carries substantial work.
