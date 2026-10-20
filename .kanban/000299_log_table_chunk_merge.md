---
name: "fix: log pane merges cut tables and streams rows live"
priority: "high"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "log-table-chunk-merge"
---

# Summary
A chunk boundary cutting a markdown table leaves the bottom fragment as paragraphs; streamed table rows never join the table. Fix with an open-table marker, a trailing incomplete-line holdback, and a client-side row absorb.

# Specs
# Problem

The agent log pane loads in chunks, bottom to top. Each chunk renders standalone by renderLogChunk (src/webui/logpane.ts:141-143). md() opens a table only when the separator row sits in the same input (src/webui/logpane.ts:114-115). So a chunk boundary that cuts a table gives: top fragment (header + separator) renders as a table; bottom fragment (body rows, newer chunk, loaded first) renders as <p> paragraphs. The user sees the bottom stay unrendered until scroll-up, then both pieces never join.

Streaming is also wrong. The live tail is a 1 s delta poll, appended as finished HTML, never re-rendered (src/webui/page.ts:991, :1058-1061, ingest at :811-816). A table renders as a table only for rows inside one poll window. Rows in later windows append as paragraphs forever.

# Decided design (user-confirmed)

Mechanism: client-side absorb, tables only. Fences stay as today and are a documented known limit. Partial rows are held back server-side until complete.

## Server

S1. md() marks a table that is still open at the end of its input: the md-table-wrap div gets data-open="tbl" when the row run extends to the final line of the input. Same pattern as the open thinking block (data-open="think", logpane.ts:336). The dialog renders md(t.body) with no following siblings, so the attribute is inert there. Do not change the dialog path.

S2. renderLogChunk: if the chunk's final content line is incomplete (the last record's text has no trailing newline, so the line continues in a later record), split that trailing run off the md() input. Render the rest normally. Because the run left md()'s input, the table ends at its last complete row; suppress the data-open marker in this case so the client never absorbs the run paragraph.

S3. Poll and init windows only (not history, before=1): hold the trailing incomplete line back instead of rendering it. Exclude it from the rendered text and report the tail at the boundary before its records (extends the record-boundary rule at src/webui/payload.ts:771 and the 000158 unterminated-record walk-back). The line then renders whole, exactly once, in a later poll. Add a guard: if the held run exceeds 1 MiB, flush it as a paragraph. Put a comment on the guard naming the ceiling and the upgrade path.

S4. History pages keep today's behavior for a mid-line cut: the trailing run renders as a plain paragraph, no marker. The newer page already rendered the line's second half as a leading fragment paragraph. Result: two fragment paragraphs, same as today. This is a deliberate ceiling; the upgrade path is line-aware page boundaries (carry render state across pages). Name it in a comment.

## Client

C1. After every insert (history prepend and live poll), in the logFixups pass over #m-log-text: for each table with data-open="tbl", absorb immediately following sibling <p> elements into the table as rows. Absorb while the paragraph's text contains "|" (same continuation rule as md()'s row loop). Stop at the first non-matching sibling, then remove the data-open attribute.

C2. Row build: split the paragraph's inner HTML on unescaped pipes (honor the \| escape, like tableCells), normalize to the thead's cell count (pad empty, drop extra), copy each column's alignment from the th style. Insert the inner HTML as-is; it is already escaped and inline-formatted. Never re-escape.

C3. The absorb must run before the prepend scroll compensation reads scrollHeight, so the layout is final. The fixup already runs inside ingest (page.ts:811-816); keep it there.

# Known ceilings (document in comments)

- A row split mid-row across a history page boundary renders as two fragment paragraphs (S4). Between-rows cuts, the reported bug, merge perfectly.
- Absorbing from paragraph inner HTML splits on rendered pipes. A code span containing a pipe inside a table row can split differently from md()'s raw-line split. Same GFM pipe-escape caveat class as task #291. Accepted.

# Tests

T1. tests/webui/logpane.test.ts: md() sets data-open="tbl" when the table runs to input end; a paragraph or fence after the table clears it (no marker). renderLogChunk suppresses the marker when a trailing incomplete line was split off, and renders that line as a paragraph. logFixups absorb: table + pipe paragraphs produce exact <tr> markup; ragged rows normalize; alignment copies; a non-row sibling stops the absorb and clears the marker.

T2. tests/webui/agentlog.test.ts: init and poll holdback. A trailing record whose text has no newline is excluded and the reported tail sits before it; the next poll renders the line whole, exactly once (extend the 000084 and 000158 patterns). History control: a trailing incomplete line on a before=1 page renders as a paragraph with no marker.

T3. tests/webui/page.test.ts: extend the #292 served-page harness. Run the served script against a cut-table fixture: prepend the older chunk (open table) and assert the following paragraphs are absorbed into exact row markup.

T4. Live test: fixture log with (a) a table cut at the init head boundary, bottom fragment paragraphs merge into the table on scroll-up; (b) a table streamed row by row across polls, rows appear as table rows within the 1 s cadence; (c) a row split mid-record across polls, the row renders whole once.

# Acceptance

- Scoped webui suites green (tests/webui/*.test.ts), run serially.
- The user's two symptoms are gone: the bottom fragment of a cut table joins the table on scroll-up; streamed rows render as rows as they arrive.
- If docs/architecture.md describes per-chunk log rendering, add one short sentence about the open-table merge and the holdback. Check first; do not pad.

# Notes
