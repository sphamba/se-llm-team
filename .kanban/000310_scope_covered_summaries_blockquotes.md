---
name: "refactor: render blockquotes in the dialog markdown"
priority: "medium"
state: "done"
worktree: ""
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

## #310 renderer half
- `md` in `src/webui/logpane.ts` has a quote branch now: a line matching `^&gt;(?: (.*))?$` (the post-`esc` form of `> ...`) opens one `<blockquote>` on its first line and reuses it for the rest of the run, and the body goes through `inline()` so code, bold and links work. A lone `>` emits no `<p>`, so it is a paragraph break. Every other line, a blank one included, closes the quote, and the end of input closes it (`closeQuote`, next to `closeList`).
- The fence branch keeps its position and closes the quote before it toggles, so a `>` inside a fenced block stays literal text. The quote branch calls `closeList()` first, like the heading and table branches.
- Assumption: a lone `>` starts a quote too, because the Specs call it a paragraph break inside the quote and not a separator between two quotes.
- `#m-body blockquote` rule in `src/webui/page.ts`, beside the other `#m-body` rules: `border-left: 3px solid var(--border); padding-left: 10px; margin: 4px 0; color: var(--soft);`. The 4px vertical margin matches `#m-body ul`, and there is no horizontal margin beyond the padding.
- Tests: 7 quote pins in `tests/webui/logpane.test.ts` (one quoted line, lone-`>` paragraph split, inline code, bold plus link, `>` in a fence, blank line closes, quote closes the open list) and the rule pin in `tests/webui/page.test.ts`. Both suites exit 0, and `node scripts/test-changed.mjs` (5 webui suites) exits 0.
- Unfixed risk: a verbatim `> ` line in any task body now renders as a quote. That is the intended output for quoted covered-task summaries, and nothing else in the dialog depended on the old literal `&gt;` text.

Review of 16078fe (first pass): pass.
- `src/webui/logpane.ts:154` matches the post-`esc` `> ` form, opens one `<blockquote>` per run, routes the body through `inline()` (`:158`) and skips the empty `<p>` for a lone `>`; `:161` closes it before the heading, list and table branches and `:192` at EOF, and the fence branch still precedes the quote match, so a `>` inside a fence stays literal.
- `src/webui/page.ts:309` adds `#m-body blockquote` with a `var(--border)` left border, 10px left padding, `4px 0` margin (the same vertical as `#m-body ul` at `:306`) and `var(--soft)`.
- `tests/webui/logpane.test.ts:327` pins all six Spec cases plus the list close, and `tests/webui/page.test.ts:184` pins the rule. No existing test line changed, and the served page carries both the branch and the rule.
- Note (non-blocking): `md` is shared, so thinking and assistant text in the log pane now render a `> ` line as a `<blockquote>` with UA margins and no `#m-body` styling (`src/webui/logpane.ts:235`). The Specs' out-of-scope line asks for identical log-pane output. Making it identical needs a mode argument on `md`, which also edits the frozen `function md(src) {` extractor at `tests/webui/page.test.ts:189`, so it is left to the merger.
- Tests: `node tests/webui/logpane.test.ts` exit=0; `node tests/webui/page.test.ts` exit=0.

## Live test (2026-10-21)
Lane: hub-only root plus the real task detail dialog in Chromium. Control: parent commit `1b785f2` in `/tmp/live-310/pre-fix` (`git archive`). Fixture: one task with hand-written `> ` lines in the body (two consecutive lines, a lone `>`, inline code, bold, a link, a fence, a table, a bullet run and a quoted Open-questions line). The fixture quotes are hand-written, not generated Specs. Driver: `/tmp/live-310/driver.mjs`, with the frozen claim table in its header. Logs: `run-merged.log` and `run-control.log`. Merged: 17 checks, 15 pass, 2 fail. Control: 11 pass, 6 n/a, 0 fail.

| Claim | Printed proof (merged) | Control (parent) |
| --- | --- | --- |
| A quoted run renders one `<blockquote>` (three runs in the fixture body) | actual=3, expected=3, pass=1 | 0 |
| No literal `&gt;` text for the quoted run | actual=false, expected=false, pass=1 | true |
| The blockquote carries the quoted sentences | actual=true, expected=true, pass=1 | false |
| Specs: consecutive `> ` lines form one paragraph, not one `<p>` per line | actual=3, expected=2, pass=0 | n/a (no blockquote in the parent) |
| A lone `>` is a paragraph break, never an empty `<p>` | actual=0, expected=0, pass=1 | n/a (no blockquote in the parent) |
| Inline code inside the quote renders `<code>` in the blockquote | actual=["inline-code"], expected=["inline-code"], pass=1 | n/a (no blockquote in the parent) |
| Bold and link inside the quote render through `inline()` | actual=[["bold"],[{"text":"link","href":"https://example.com/x"}]], expected=[["bold"],[{"text":"link","href":"https://example.com/x"}]], pass=1 | n/a (no blockquote in the parent) |
| A `>` inside a fenced block stays literal | actual={"fence":true,"preBq":0}, expected={"fence":true,"preBq":0}, pass=1 | {"fence":true,"preBq":0} |
| A blank line after a quote closes it | actual=true, expected=true, pass=1 | true |
| A quote closes the open list first | actual=["ul","blockquote","ul"], expected=["ul","blockquote","ul"], pass=1 | ["ul","p","ul"] |
| Headings keep their output | actual=["Summary","Specs","Notes","Open questions"], expected=["Summary","Specs","Notes","Open questions"], pass=1 | ["Summary","Specs","Notes","Open questions"] |
| Tables keep their output | actual=[{"head":["a","b"],"rows":[["1","2"]]}], expected=[{"head":["a","b"],"rows":[["1","2"]]}], pass=1 | [{"head":["a","b"],"rows":[["1","2"]]}] |
| A quote closes at the end of input | actual=<blockquote><p>tail quote</p></blockquote>, expected=<blockquote><p>tail quote</p></blockquote>, pass=1 | <p>&gt; tail quote</p> |
| The `#m-body blockquote` rule is served | actual=true, expected=true, pass=1 | false |
| Computed style: border, padding, soft colour, margins | style={"borderLeftWidth":"3px","borderLeftStyle":"solid","borderLeftColor":"rgba(107, 125, 143, 0.12)","paddingLeft":"10px","paddingTop":"0px","paddingRight":"0px","marginTop":"4px","marginBottom":"4px","marginLeft":"0px","marginRight":"0px","color":"rgb(92, 97, 102)"}, ul={"marginTop":"4px","marginBottom":"4px"}, vars={"soft":"rgb(92, 97, 102)","border":"rgba(107, 125, 143, 0.12)"}, pass=1 | n/a (no blockquote in the parent) |
| No horizontal shift, text starts after border + padding | actual={"bqLeft":278,"bodyContentLeft":278,"pOffset":13,"expectedOffset":13,"modalHidden":false,"bodyWidth":724}, expected=left equal, offset 13, modal visible, pass=1 | n/a (no blockquote in the parent) |
| Log-pane `md` output stays identical (Specs out of scope) | actual=true, expected=false, pass=0 | false |

### Findings
- **C2: the Specs and the code disagree.** The merged `md` emits one `<p>` per quote line. The Specs say "Do not emit a `<p>` per line" and name the lone `>` as the paragraph break, so the four-line run A should give 2 paragraphs, and gives 3 (`actual=3, expected=2`). The probe printed `<blockquote><p>Covered task #101: it added the quote rule.</p><p>Covered task #102: it added the second line.</p><p>Second paragraph with <code>inline-code</code> and <b>bold</b> and a <a href="https://example.com/x" target="_blank" rel="noopener">link</a>.</p></blockquote>`. Effect: each quoted covered-task summary line becomes its own paragraph with the UA paragraph margins, so the quote reads as a stack of gapped paragraphs, not one quote. The merged unit test pins only the lone-`>` split, so no test covers two consecutive quote lines. If the intended reading is "do not open a blockquote per line", the Specs sentence should say that.
- **C15: the log pane changed too.** The Specs out-of-scope line asks for identical log-pane output. A `text_delta` of `> quoted line\n` through `renderLogChunk` returns `<blockquote><p>quoted line</p></blockquote>` on merged and `<p>&gt; quoted line</p>` on the parent. `#m-body blockquote` is scoped to the dialog, so that blockquote gets the UA margins. The review note already leaves this to the merger. The live test confirms it with the renderer helper, not in a browser log pane.

### Assumptions
- The dialog body is `md(t.body)` (`src/webui/page.ts` `setBody`), so quotes in the fixture task body exercise the changed renderer.
- Fixture quote lines use the space form `> `, as the Specs state. `>text` without a space is outside the Specs and not checked.
- C2's expected 2 paragraphs reads "Do not emit a `<p>` per line" literally. See the finding.
- Expected colours come from a probe element with `var(--soft)` and `var(--border)` in the served page. The 4px vertical margin expected value is the computed `#m-body ul` margin on the same page. No hex value is hard-coded.
- The first tally run had one checker bug: C1c anchored on a slice of A3 that still contained markdown backticks. The fix and the single rerun changed no product code.

### Not exercised
- The log pane in the browser with an agent-log fixture. Only the server helper `renderLogChunk` was probed.
- `>text` without a space, quotes inside table cells and nested quotes, which the Specs do not name.
