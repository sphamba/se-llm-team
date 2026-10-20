---
name: "feat: render markdown tables in dialog and agent logs"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "markdown-table-render"
---

# Summary
Implement GFM pipe-table rendering in the shared markdown renderer md() (src/webui/logpane.ts), which serves both the task details dialog (client-side) and the agent logs (server-side). Cells stay on one line with inline formatting and ragged-row normalization; each table sits in its own overflow-x container; the leftmost column is pinned with a static right border. No new dependencies, no scroll JS.

# Specs
## Need

Markdown is rendered in the task details dialog and in the agent's logs, but tables are not supported: pipe-table blocks show as loose paragraphs of literal pipes. Implement GFM table rendering in the shared markdown renderer so both sites get tables. Each cell's text stays on a single line; the table overflows horizontally inside its own container (never overflowing the whole markdown block); the leftmost column stays pinned while the rest scrolls.

## Facts (from code inspection, 2026-10-20)

- One shared renderer serves both call sites: `md()` at `src/webui/logpane.ts:87-103`. The dialog renders it client-side (`setBody`, `src/webui/page.ts:537-552`, `md(t.body)` at 539 into `#m-body`); the agent log renders server-side (`renderLogChunk`, logpane.ts:105, called from `agentLogPayload` at `src/webui/payload.ts:778`; the client inserts the HTML via `ingest`, page.ts:803).
- Current constructs: fenced code blocks (``` toggle), headings `#`-`######`, flat `ul/li`, paragraphs; `inline()` (logpane.ts:83-85) renders backticks -> `<code>`, `**bold**` -> `<b>`, `[t](url)` -> `<a target="_blank" rel="noopener">`. `esc()` runs first. There is a ceiling comment: "swap for a full renderer when the subset grows".
- `md()` emits bare elements (no wrappers). CSS lives in the PAGE literal in page.ts: `#m-body pre { overflow: auto }` (L302) is the overflow precedent; `#m-head { position: sticky }` (L292) is the sticky precedent; `#m-log-text` is `white-space: pre-wrap` (L242-243), so a table there needs its own scroll container. Class style is terse (#m-body, .spin, .chip).
- Tests: `tests/webui/logpane.test.ts` pins rendered output with exact strings (e.g. L264-269) and has a DOM stub for logFixups. Check command: `pnpm test`.

## Decisions (interview, settled)

- Syntax: GFM pipe tables only. A header row followed by a `|---|` separator row is required; a block of pipe lines without the separator stays paragraphs. Tables inside fenced code blocks stay code (the fence toggle already handles that).
- Alignment: the separator's colons are honored per column: `:---` left, `:---:` center, `---:` right; bare `---` is left.
- Cells: single line (`white-space: nowrap` on th/td). Cell content goes through `inline()` after escaping, so code, bold and links render inside cells. Ragged rows are normalized to the header's column count: missing cells become empty cells, extra cells are dropped.
- Overflow: `md()` wraps the `<table>` in its own container div (new class, follow the terse naming style, e.g. `.md-table-wrap`) with `overflow-x: auto`, so only the table scrolls and the markdown block keeps its width.
- Pinned column: the first `th`/`td` of every row is `position: sticky; left: 0` with an opaque background (the card/dialog background variable) and a permanent right border as the cue. No scroll listeners and no JS beyond what `md()` emits.
- Scope: both render sites through the one `md()`; no separate dialog-only or log-only behavior.

## Implementation sketch (non-binding)

- In `md()`'s line loop, before the paragraph fallback: detect a table as a line containing `|` whose next line is a separator row matching `/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/`. Collect the header cells (split the header row on unescaped `|`, trim, drop the leading/trailing empty cell when the row starts/ends with `|`), the alignment list from the separator, and subsequent pipe lines as body rows until a non-pipe line.
- Emit: wrapper div (class per the CSS naming style) > table > thead > tr > th (sticky class for the first column), tbody > tr > td. Alignment via a per-column class or inline text-align. Cells: `inline(esc(cell).trim())`, normalized to the header count.
- CSS in the PAGE literal: wrapper `overflow-x: auto`; table `border-collapse: collapse` with the existing border variable; th/td `white-space: nowrap`, padding per the existing density; first-column cells sticky left with opaque background and right border.

## Constraints

- Keep `esc()` first so pipes/cells cannot inject HTML.
- Do not restructure the existing `md()` branches beyond adding the table branch; keep the ceiling comment updated if the subset grows.
- No new dependencies; no scroll-position JS; the fix must work identically in both render sites.

## Acceptance criteria

1. `pnpm test` passes.
2. New exact-string pins in tests/webui/logpane.test.ts prove: a GFM table renders as wrapper > table with thead/tbody; alignment colons produce the three alignments; a ragged row is padded and clipped to the header count; a pipe block without a separator row stays paragraphs; a cell with backticks/bold/links renders inline; a cell containing HTML metacharacters is escaped; a table inside a fence stays `<pre><code>`.
3. A CSS pin proves the wrapper carries `overflow-x: auto` and the first-column rule carries `position: sticky` plus the nowrap rule for th/td.

# Notes
