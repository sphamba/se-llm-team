---
name: "fix: log pane merges cut tables and streams rows live"
priority: "high"
state: "done"
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

- No split (2026-10-21): this is one protocol, not two workstreams. The open-table marker (S1) and the row absorb (C1/C2) are the two halves of one contract, and neither half shows the user symptom alone: marker without absorb still leaves the rows as paragraphs, absorb without marker never fires. A server subtask and a client subtask would each fail its own live test (T4) and only the parent could verify the fix. All pieces except the S3 holdback edit src/webui/logpane.ts, and both halves would add asserts to tests/webui/logpane.test.ts, on top of the shared element stub at lines 4-87 that the absorb tests must extend (row build, alignment styles, following-sibling walk). The change is roughly 60 source lines over 3 files, so one review, one merge and one live test costs less than two.
- C3 needs no page.ts change: ingest inserts then runs logFixups (page.ts:810-815), and pullLog reads scrollHeight after ingest returns (page.ts:1062-1067), so the absorb already precedes the history scroll compensation. Keep the absorb as a pass inside logFixups.
- Injection constraint, the #292 failure mode: page.ts ships `${md}` (page.ts:364) and `${logFixups}` (page.ts:382) as function source, so neither may read a module-scope name. Define the absorb's table helpers inside logFixups (the way md keeps its table helpers inside itself) and take everything else from the injected doc or a browser global already in use there (CSS.escape).
- Scan the whole pane on every insert: after a history prepend the open table is the new fragment and the paragraphs are the old ones, while on a poll the table is old and the paragraphs are new. A pass over el (as the existing logFixups passes do) covers both orders; a pass over only the inserted nodes does not.
- Test baseline: tests/webui/{logpane,agentlog,page}.test.ts are separate area files (no monolith), and `pnpm test` runs them serially. Extend the existing 000292 served-page md harness in page.test.ts rather than adding a second harness.
- Fixed 2026-10-21 (one change, 3 source files, ~110 lines with comments): `md()` sets `data-open="tbl"` when the table's row run reaches the end of its input (trailing blank lines count as the end), `renderLogChunk` splits the trailing run of records whose text has no newline off `md()`'s input, renders that run as one paragraph and strips the marker, `logFixups` absorbs the following pipe paragraphs into an open table (pad or clip to the thead count, copy each th `text-align`, keep the `\|` escape, insert the rendered html as it is), and `payload.ts` holds that run back on init and poll windows with the tail reported at the record boundary before it, capped at 1 MiB.
- Spec conflict, `# Acceptance` is the arbiter: the spec line said the absorb always clears the marker, it does not. The absorb clears the marker only when a non-row sibling stops it. A run that absorbs the pane's last sibling leaves the table open, because otherwise a table streamed one row per poll merges only once and "streamed rows render as rows as they arrive" fails. Recorded test: "a run that absorbs its last sibling keeps the table open for the next poll".
- `md()` keeps its one-parameter signature. `tests/webui/page.test.ts` extracts the served renderer by the exact string `function md(src) {`, so `renderLogChunk` strips ` data-open="tbl"` from the rest's html with a string replace instead of a second parameter.
- No `page.ts` change, C3 confirmed: `ingest` inserts, then runs `logFixups`, and `pullLog` reads `scrollHeight` only after `ingest` returns (`page.ts:810-815`, `1062-1067`).
- No `docs/architecture.md` change: a grep of that file for `per-chunk`, `log pane`, `logpane`, `renderLogChunk` and `chunk` finds nothing, so no section describes per-chunk log rendering.
- Ceilings kept and named in the code: a `before=1` page that ends mid-line keeps the fragment paragraph and takes no marker (S4), a row cut mid-row at a history page boundary still renders as two fragment paragraphs, a run that reaches the window start renders as before because it has no record boundary to report, and a held run over 1 MiB flushes as a paragraph (guard comment names the upgrade path).
- Tests, red first: the three suites failed on the new asserts before the fix. `tests/webui/logpane.test.ts` pins the marker open and closed (paragraph, fence, fence-wrapped table), the `renderLogChunk` split and marker strip, and the absorb on both pane orders, ragged rows, alignment copy, the `\|` escape, no second escape, and the stop plus clear. `tests/webui/agentlog.test.ts` pins the init holdback, its record-boundary tail, the next poll rendering the line whole once, an empty poll after it, and a `before=1` control with the fragment paragraph. `tests/webui/page.test.ts` extends the 000292 harness and runs the served `logFixups` over a purpose-built stub with the older chunk prepended above row paragraphs already in the pane.
- Suites run serially, all green: `tests/webui/logpane.test.ts`, `tests/webui/agentlog.test.ts`, `tests/webui/page.test.ts`, plus `tests/webui/board.test.ts` and `tests/webui/hub.test.ts` for the shared barrel.

## Review 2026-10-21 (first review of `b6b0a9f`, fixed in `6683c6e`)

- Verdict per spec line, on `6683c6e`. S1 `logpane.ts:172` (the marker opens only when the row run reaches the input end, a paragraph or a fence clears it, the dialog path is untouched). S2 `logpane.ts:203-204`, `:387` (the trailing run leaves the `md()` input, renders as one paragraph, and the marker string is stripped). S4 `agentlog.test.ts:222-225` (a `before=1` page keeps the fragment and takes no marker). C1/C2 `logpane.ts:466-493` (the absorb walks the following siblings, pads or clips to the thead count, copies the th alignment, keeps the `\|` escape, never escapes twice, clears the marker only at the first other sibling). C3 confirmed on the code: `ingest` runs `logFixups` at `page.ts:815` and `pullLog` reads `scrollHeight` at `page.ts:1046-1048`. T1 to T3 are present and green, T4 is the live tester's. Acceptance: no `docs/architecture.md` section describes per-chunk log rendering (`grep -c` for `logpane`, `renderLogChunk`, `per-chunk`, `chunk` is 0).
- Blocking finding, fixed. S3 failed for every poll after the first. `openRun` returned 0 when the run reached the window start, and a poll window starts exactly at the held line, so the steady state was a whole window of open-line records: each poll rendered the row as a fragment paragraph and the client absorbed every fragment as its own row. The Notes claim that such a run "has no record boundary to report" is wrong: the window start is the record boundary, and a held poll reports a stable offset, not a backwards step. End-to-end proof of the failing state (`agentLogPayload`, init then three polls of one streaming row): init held it (`tail=148`), `POLL1 "<p>| 3 | 4 </p>"`, `POLL2 "<p>| 5 </p>"`, `POLL3 "<p>|</p>"`.
- The fix (`6683c6e`). `openRun` returns the window-start run. The hold then needs a flush condition, so the payload holds only while the run is alive (`agentAlive(root, slug)` on the per-task pid; `agentLogPath` now returns `{path, slug}`). A dead run's open line renders through S2 as a paragraph with no marker. A held window that the run covers serves empty text, never a bare `"\n"`.
- Red first proof: with the source change stashed, `node tests/webui/agentlog.test.ts` exited 1 with "a poll whose window is the open row holds it, never a fragment". After the fix the same suite exits 0 and the row lands whole exactly once (`<p>| 3 | 4 |</p>`, then an empty poll).
- Spec deviation, deliberate: S3 asks for the hold with no liveness condition. A finished run never writes the closing newline, so an unconditional hold lost a killed run's last partial line, and the client's idle rule stops a past log's poll timer on the first empty poll. The dead-run case is pinned by "a finished run's open line renders as a fragment paragraph instead of holding forever". Ceiling named in the code: liveness is per task slug, so a killed run's log polled while another run of the same task is alive still holds. Upgrade path: the run's own `.dead` marker, or its newest-run index as `agentHistory` decides the live run.
- The developer's `cutPoll` assert passed for the wrong reason before the fix: the record that closes the line was already in the log, so it held with or without the holdback. The new two-poll assert is the one that pins S3.
- Tests, all green, run serially after the fix: `tests/webui/logpane.test.ts` exit 0, `tests/webui/agentlog.test.ts` exit 0, `tests/webui/page.test.ts` exit 0, `tests/webui/board.test.ts` exit 0, `tests/webui/hub.test.ts` exit 0.
- Durable guidance: a server-side hold that can report the same offset needs a flush condition (liveness or freshness), else a dead run's final partial line never renders. Test a hold with two polls whose window is exactly the held line: a window-start guard silently disables the hold after the first poll, and a one-poll test stays green.

## Re-review 2026-10-21 (re-review of `6683c6e`, no fixes)

- Mode: re-review of `6683c6e`, the fix for the first review's blocking finding. Delta only: the `openRun` window-start run, the `alive` gate, `agentLogPath`'s return shape, the empty-window build, the absorb ceiling comment, the new test block.
- Verdict per claim, on `6683c6e`. `logpane.ts:118-128`: `openRun` returns the window-start run, still 0 when the last text record closes its line, still 0 when a record carries a closed line before the open one. `payload.ts:789`: the gate is `before !== "1" && alive`, so history pages keep S4. `payload.ts:801-803`: a run that covers the whole window serves `""`, never a bare `"\n"`. `payload.ts:252-267`: `agentLogPath` returns `{path, slug}`, and `agentLogPayload` (`:692-694`) is its only caller. `payload.ts:755-759`: the ceiling comment sits on the gate it describes. S1, S2, C1 to C3 and their pins are untouched by the delta and stand from the first review. The absorb now names the rendered-html pipe ceiling (`logpane.ts:472-475`), which `# Known ceilings` asks for.
- Proof of the corrected claim, one probe over the payload directly (temp file under `tests/`, run, deleted): a poll whose window is only open-line records serves `""` and reports the same offset. Developer role log measured: init holds, `tail=148`, the held poll empty and at the same offset. The red-first proof recorded for the same assert in the first review stands.
- Non-blocking finding: the liveness gate does not cover the splitter and the merger. `agentAlive(root, found.slug)` reads `.pids/<slug>.pid`, but the splitter spawns under `${slug}.splitter` (`pipeline.ts:56`) and the merger under the project-wide `merger` (`pipeline.ts:197`). Same probe, one log per role, each with the role's own pid file holding `process.pid`: splitter `init holds open line: false, tail=263`, merger `init holds open line: false, tail=263`, developer `init holds open line: true, tail=148` (263 is the file size, so the open line rendered as a fragment). A splitter or merger row that streams across polls therefore still fragments: the pre-fix behaviour for those two roles, no data lost. Not fixed here on purpose, because holding them needs `agentHistory`'s `live` flag (`payload.ts:179`, also slug-keyed) to agree. The pane clears the log timer on the first empty poll (`page.ts:1015-1018`) and a held window serves empty text, so a hold with a stale `live` flag loses the line instead of fragmenting it. Upgrade path: one change in both places, with `readMergerSlug(root) === slug` for the shared merger pid. The gate comment (`payload.ts:755-758`) names only the "another run of the same task" imprecision, not this direction.
- Tests, run serially, one exit each: `tests/webui/agentlog.test.ts` exit 0, `tests/webui/logpane.test.ts` exit 0, `tests/webui/page.test.ts` exit 0. The union stands as the first review built it: the delta touches neither `hub.ts` nor `kanban.ts`, so the `board` and `hub` runs recorded there still apply.
- Acceptance, first review evidence plus this delta: symptom (a) rides the client absorb over history pages, which the gate never reaches, so it holds for every role. Symptoms (b) and (c) hold for developer, reviewer and live-tester runs, and for merger and splitter runs they stay at today's fragment behaviour (finding above). The `docs/architecture.md` check stands from the first review.
- `# Open questions` stays empty: no user decision is open. The role gap above is technical and has its upgrade path named.

## Live test (2026-10-21)

Lane: hub-only fixture root (no git, no daemon), the served page from the merged tree in headless Chromium, plus a control page from the parent commit `dc09fc0` over an identical fixture. Result: 45 of 45 checks pass, driver exit 0.

Assumptions:
- The user path is the real clicks: board card, then run card, then the log pane, then scroll up. The driver clicks the served DOM buttons. It does not call `openLog` or `logFixups` directly.
- The fixture task `000001-logtable` is in state `doing` and has three developer logs. A live `sleep` pid sits in `.pids/000001-logtable.pid`, because S3 holds an open line only while the run is alive.
- `LOG_LINES` is 100. The cut-table fixture has 134 content lines, so the init window is 100 body rows and the 100-line history page starts at the table header.
- The poll cadence is 1000 ms. A row that arrives under 3500 ms counts as within the cadence.

Claim, printed proof, control:

| Claim | Merged proof (printed) | Control proof on `dc09fc0` |
| --- | --- | --- |
| A. A table cut by the init head boundary merges on scroll-up (S1, C1) | init: 0 tables, 100 pipe paragraphs. After the scroll-up prepend: tbody 130 rows, 0 pipe paragraphs, marker `tbl` stays | init: 0 tables, 100 pipe paragraphs. After the prepend: tbody 30 rows, 100 paragraphs stay, no marker |
| B. A streamed row renders as a row within the 1 s cadence (C1, C2) | beta arrives at 991 ms as a `<tr>` with cells `beta`, `2`, the head's right alignment copied. Gamma arrives at 976 ms, 3 rows, 0 pipe paragraphs | beta arrives at 990 ms as a pipe paragraph with the row text. The table stays at 1 row |
| C. A row split mid-record renders whole once (S3, S2) | init holds it: no `beta`, no `done`, 1 row, marker `tbl`. The close renders 2 rows with cells `beta`, `done`, `shipped`, center and right alignment, still 2 rows after 1.6 s, 0 stray paragraphs | init: 2 rows, the fragment row has cells `beta`, `done`, empty. The close keeps 2 rows and leaves a stray paragraph with the row text |

Checks that matter:
- A: the absorbed last row has the exact cell texts `row-130`, `ok`, `n-130`, computed `text-align` center and right, and the first cell class `md-pin`. The history page had 30 rows and the init had 100 paragraphs, so 130 rows prove the merge.
- B: the absorbed `td` takes `text-align: right` from the second `th`. No pipe paragraph stays.
- C: the poll window that closed the row served it whole and once. A later poll did not repeat it.

Technical difficulties:
- First run had 3 failures, all checker bugs, fixed before the tally. The control pane stops its log timer on the first empty poll, so a control wait keyed on `<tr>` rows timed out and the second append never polled. The sleep-exit probe read the pid before the process died. The fix waits on the rendered text for the control and polls the pid for exit. The rerun had 0 failures.
- Not exercised: a splitter or merger run that streams a row across polls. The fixture used the developer role only. The re-review of `6683c6e` records that this case stays at the fragment behaviour, because the liveness gate reads the per-slug pid file. This test did not repeat that probe.

Cleanup: both hub pids exited (`alive:false`), both ports show no listener in `ss -ltn`, and the fixture sleep pid is gone. `git status --short` in the worktree is clean.
