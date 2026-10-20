---
name: "feat: render markdown tables in dialog and agent logs"
priority: "medium"
state: "done"
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
- Splitter pass, no split (#291, 2026-10-20): the change is one contract slice across the table branch in `md()` (src/webui/logpane.ts), the PAGE CSS literal (src/webui/page.ts) and the exact-string pins (tests/webui/logpane.test.ts). The wrapper class name, the markup the CSS styles and the pinned strings must agree, so a CSS-only or tests-only subtask could not start in parallel. One renderer branch plus a few CSS rules is small; two review, merge and live-test cycles cost more than the saved work. Durable guide for future splitters: a shared-renderer feature whose CSS and exact-string tests bind to the same markup is one slice, not several.
- Developer pass (#291, commit a7b700e): implemented as one slice, no split.
  - `md()` in src/webui/logpane.ts now loops by index over the escaped lines and takes a table branch before the paragraph fallback and after `closeList()`, so the fence, heading and list branches are unchanged. Detection: the line contains `|` and the next line matches `TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/`. Body rows run until the first line without a pipe.
  - Helpers next to `inline()`: `tableCells()` splits on pipes, keeps a `\|` escape inside its cell (placeholder swap, no lookbehind regex in the browser PAGE script), trims, and drops a leading/trailing pipe instead of opening an empty cell; `tableAlign()` turns `:--:`/`--:` into an inline `style="text-align:center|right"` and leaves a bare `---` with no attribute, so left needs no CSS or markup.
  - Markup: `<div class="md-table-wrap"><table><thead><tr><th class="md-pin">...` + `<tbody>`. The first cell of every row carries `md-pin`; the header count is authoritative (missing cells render empty, extra cells drop). Cells run `inline()` after the `esc()` that already covers the whole source, so injection stays impossible.
  - CSS added after the `#m-body a` rule in the PAGE literal, four rules: `.md-table-wrap { overflow-x: auto }`, `table { border-collapse: collapse }`, `th/td { white-space: nowrap; padding: 3px 10px; border-bottom: 1px solid var(--border) }`, `.md-pin { position: sticky; left: 0; background: var(--panel); border-right: 1px solid var(--border) }`. Unscoped, so both the dialog (`#m-body`) and the log pane (`#m-log-text`) get it.
  - Tests: eight exact-string pins appended to tests/webui/logpane.test.ts (wrapper/table/thead/tbody, three alignments, ragged pad plus clip, pipe block without a separator stays paragraphs, inline bold/code/link in a cell, escaped HTML metacharacters, escaped pipe stays in its cell, table inside a fence stays `pre/code`); three CSS pins in tests/webui/page.test.ts next to the existing `#m-body` pins. The logpane pins failed before the branch existed (`<p>| a | b |</p>`), so the fail-then-pass order is confirmed.
  - Scoped runs, all exit 0, each own process: `node tests/webui/logpane.test.ts`, `node tests/webui/page.test.ts`, `node tests/webui/agentlog.test.ts`, `node tests/webui/board.test.ts`, `node tests/webui/hub.test.ts`. The full suite was not run, per role rules.
  - Board file, SPECS.md and AGENTS.md are not in the commit (symlinks into the main checkout).
- Reviewer pass (#291, a7b700e + 8d5df90, 2026-10-20): verdict pass, two CSS fixes, tests green.
  - Need, all four parts hold at both sites through the one `md()`: single-line cells `src/webui/page.ts:312`, own overflow container `src/webui/page.ts:310`, pinned leftmost column with a static right border `src/webui/page.ts:313`, table branch `src/webui/logpane.ts:115-129`.
  - Decisions: GFM pipe + separator detection `src/webui/logpane.ts:91,115` and bodies end at the first pipe-less line `:121`; separator colons per column `src/webui/logpane.ts:99`; ragged rows pad/clip to the header count `src/webui/logpane.ts:124-126`; cells render `inline()` after the whole-source `esc()` `src/webui/logpane.ts:117`; a fence wins because the fence branch runs first `src/webui/logpane.ts:109`.
  - Acceptance 2: eight exact-string pins `tests/webui/logpane.test.ts:276-318` cover wrapper > table with thead/tbody, the three alignment colons, ragged pad plus clip, no-separator pipe block as paragraphs, inline bold/code/link in a cell, escaped HTML metacharacters, an escaped pipe inside its cell, and a table in a fence as `<pre><code>`.
  - Acceptance 3: CSS pins `tests/webui/page.test.ts:179-182` cover the wrapper `overflow-x: auto`, the nowrap rule and the sticky first column.
  - Acceptance 1: union = `tests/webui/logpane` (fast, own process) + `tests/webui/{page,agentlog,board,hub}` (daemon-serial, chained); all five exit 0 on a7b700e and again on 8d5df90. Full `pnpm test` not run, per role rules.
  - Fix 1 (8d5df90): a bare `---` or `:--` column got no inline style, and the UA `th` default is `text-align: center`, so every left column's header sat centered over left body cells, against the "bare `---` is left" decision. Added `text-align: left` to the th/td rule `src/webui/page.ts:312` (inline center/right still win) and strengthened the pin `tests/webui/page.test.ts:180`. The developer note "left needs no CSS or markup" holds for td, not th.
  - Fix 2 (8d5df90): the pin background was `--panel` at both sites, but the log pane sits on `--code-bg` (`src/webui/page.ts:231`), so its pinned column painted a contrasting strip before any scroll. Added `#m-log-text .md-table-wrap .md-pin { background: var(--code-bg); }` `src/webui/page.ts:315` and pinned it `tests/webui/page.test.ts:181`; the dialog keeps `--panel`, the `#m-box` background.
  - total 4 files, +96 from the diff (logpane.ts 43, page.ts 8, logpane.test.ts 46, page.test.ts 5).
  - Durable guidance for future reviewers: a cell alignment default must beat the UA `th { text-align: center }`, and a sticky pin background must use the background variable of each site (`#m-box` is `--panel`, `#m-log` is `--code-bg`), not one variable for all sites.

## Live test (2026-10-20)
- Baseline: merged HEAD `8d5df90` (4 files, +96 against `ee809dd`). `/api/hub` served that commit. Port `4351`, isolated `HOME`, hub-only fixture root (no git, no daemon, no orchestrator), Playwright Chromium.
- Fixture: task `#1` has a GFM table in the body (8 columns, three alignments, one short row and one long row, bold, code, link, an escaped pipe, HTML metacharacters, a pipe block without a separator, and a fenced table). Task `#2` has a table-free body and a developer run log whose `text_delta` record carries a table.
- Result: the log pane holds every table claim. The task details dialog cannot render a table. Tally: `pass=15 fail=1 skip=12 total=28` (the 12 skips are the dialog assertions that the failure makes unreachable).
- Assumptions:
  - A hub-only root is enough for both sites, because `GET /` serves the static page and `/api/task-detail`, `/api/task-history` and `/api/agent-log` read only `.kanban`.
  - One body with the full GFM set closes every decision in the Specs, so the dialog lane has one table and two negative controls.
  - The log lane task keeps a table-free body, because the dialog throw on task `#1` also blocks the history fetch (see Finding 1). Without that split, no UI path opens the task `#1` log.
  - The harness pins the event loop, because `startHub` unrefs its server and a bare launcher exits at once. This is test harness detail, not a product finding.
- Contradiction with the Specs: the Specs say the dialog renders the body client-side through the shared `md()`. The live run shows the browser cannot run the table branch, so the two render sites do not behave the same.

### Finding 1 (dialog): a table body throws in the browser, so the dialog stays empty
The details dialog for task `#1` never shows the body. The page raises `ReferenceError: TABLE_SEP is not defined`, `#m-body` stays on the `Loading task details…` placeholder, and no agent card renders even though the task has a developer log (0 cards).

Cause: the `md()` table branch (`src/webui/logpane.ts:115`) reads the module-scope helpers `TABLE_SEP` (`:91`), `tableCells` (`:92`) and `tableAlign` (`:99`), but the page script injects only the `md` function source (`src/webui/page.ts:364`) plus the `esc` and `inline` consts (`:351`, `:363`). The helper definitions never reach the browser.

Side effect: the throw stops the history fetch that chains after `setBody` in `openTask` (`src/webui/page.ts:608-638`), so the agent cards and the log pane stay unavailable for the same task. The 5 s poll throws again and does not recover.

Why the tests miss it: `tests/webui/page.test.ts` asserts only that the page string contains `String(md)`. A page whose `md` cannot run still passes.

Control that proves the cause: task `#2` (table-free body) renders at once, and its log opens and shows a table. The server-side renderer and the shared CSS are correct.

Repair path: inject the helpers into the page, or move the three helpers into `md()`, then add one check that runs the served page script against a table body.

### What holds (log pane, task #2)

| claim | measurement |
| --- | --- |
| table renders server-side | `#m-log-text` receives `<div class="md-table-wrap"><table><thead>` and `<tbody>` from `renderLogChunk` |
| own overflow container | wrapper `overflow-x: auto`, client 702 px, scroll 1146 px, table 1146 px, pane `#m-log` has no horizontal overflow (722 px client and scroll) |
| cells stay on one line | `white-space: nowrap` on th and td, tallest cell 31 px against a 21.75 px line height |
| alignment from the separator colons | th and td compute `left, left, center, right, left, left` for `---, :---, :--:, --:, ---, ---`, so a bare column header is left (the `8d5df90` fix) |
| ragged row normalization | the 1-cell `done` row renders 6 cells (`["done", "", "", "", "", ""]`) |
| inline formatting in a cell | bold computes 700, a code cell is monospace, the link keeps `href`, `target=_blank` and `rel=noopener` |
| escaping | `<img src=x onerror=alert(1)>` stays text and the pane holds no `img` element |
| pinned column | `position: sticky`, `left: 0px`, `border-right: 1px`, pin and pane both compute `rgb(235, 238, 240)`, so the `#m-log-text` override is in effect |
| pin holds while scrolling | the wrapper scrolls 444 px, the pinned header keeps x 289 px against a wrapper content left of 289 px, the second header moves from 378 px to -65 px |
| no page error on the log path | zero page errors during the log open |

### Served bytes (both sites)
`GET /` carries the four CSS rules (wrapper `overflow-x: auto`, th and td `white-space: nowrap` plus `text-align: left`, the sticky `left: 0` pin, and the log-pane `--code-bg` pin). The dialog-side rules are served but unreachable until Finding 1 is fixed.

### Observation (not a finding)
When the log pane opens under a short body, `#m-box` keeps its earlier height, so the table starts below the visible box until the reader scrolls the dialog. This is the existing modal height behavior and not part of this change.
