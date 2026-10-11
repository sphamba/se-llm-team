---
name: "fix: agent log drops a JSONL record split across two poll windows"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
GET /api/agent-log loses a JSONL record whose bytes arrive across two poll windows. The first poll's reported tail offset points into the middle of the still-unterminated record; the next poll then starts at that offset, the head guard (readRange(log, head - 1, head) !== "\n") treats it as a partial head line and strips the record's continuation, so the completed record never renders in the webui agent log pane. Pre-existing (present before 000068) and noted as non-blocking in the 000068 Notes; no task covered it.

# Specs
Found during the live test of 000068 (worktree fix/68-renderlogchunk-drops-blank). Pre-existing: it exists in the pre-fix code too and is recorded as non-blocking in the 000068 Notes.

Repro (against startWebUi + GET /api/agent-log):
1. Write "start\n" plus the first half of one JSONL record, with no trailing newline. The poll from the first tail returns "" - the trailing partial is dropped by renderLogChunk, which is correct on its own.
2. Append the record's second half plus a newline. The next poll (from the previous tail, which is mid-record) returns "" because the head guard strips the continuation line: in agentLogPayload (src/webui.ts) `if (head > 0 && readRange(log, head - 1, head) !== "\n")` finds no newline before head, takes the window as mid-record, and cuts everything up to the first newline - which is the completed record's continuation.
Result: the complete record is lost on both sides and never renders.

Code pointers:
- src/webui.ts agentLogPayload: `head = off ? Math.min(off, size) : ...; tail = size;` reports tail = current file size even when that byte is mid-record, so the client's next offset starts inside the record.
- src/webui.ts readRange + the head guard: `text = nl === -1 ? "" : text.slice(nl + 1);`.
- src/webui.ts renderLogChunk drops a trailing unterminated record by design (spec of 000054/000068), so the first window cannot render it either.

Suggested direction (pick one, keep the 000054/000067/000068 contracts intact - non-JSON lines pass through, whole records render, a genuinely partial head line is still dropped):
- Report a tail offset at the end of the last newline-terminated record (<= size) so the client re-polls from a record boundary, and/or
- Carry the unterminated partial record across windows (server-side per-log buffer keyed by file+offset) so the completed record renders exactly once when its newline arrives, and/or
- Have the client re-request from its previous offset minus the length of the line it could not consume.
- Whichever approach: no duplicate rendering of the already-served prefix, no lost record when the split lands anywhere inside the record (including mid-multibyte, where readRange already yields one replacement glyph), and no regression for the existing exact-equality chunk-edge and offset-poll tests in src/webui.test.ts.

Ship with a test that reproduces the two-poll split (assert the completed record renders exactly once) and runs the full suite green; per project convention, code changes ship with tests.

# Notes
Implemented the record-boundary tail approach in src/webui.ts, commit 8be9e72.
- readRange now returns [text, byte offset just past the window's last newline-terminated record].
- agentLogPayload reports that boundary as `tail` on forward polls (init and offset polls); the `before=1` history tail is unchanged. The client's next offset then starts at a whole record, so a record split across two windows is re-read from its start and renders once when its newline arrives. The already-served prefix is not re-served.
Test in src/webui.test.ts: split a record at byte 1, 20, half and last byte, plus a mid-multibyte split; asserts only the terminated line renders in the first poll, the completed record renders once in the second, and a third poll from the new tail yields "". Verified red on the pre-fix src/webui.ts (first.tail 13 != 12) and green after.
Full suite green: node src/kanban.test.ts, node src/webui.test.ts (x3), node src/orchestrator.test.ts (all smoke parts).

Review 2026-10-11, no code changes made.
- The design matches the Specs. readRange returns the offset just past the window's last newline. agentLogPayload reports that offset as tail on init polls and offset polls. The client's next offset is then a record boundary, so the head guard never strips a continuation. The before=1 history tail is unchanged.
- Red check repeated in a throwaway copy with main's src/webui.ts. The new test fails at src/webui.test.ts:369 (first.tail 13 != 12). The fixed code is green.
- Suites green in the worktree: node src/kanban.test.ts, node src/webui.test.ts (twice), node src/orchestrator.test.ts (all smoke parts).
- Extra edge checks passed (throwaway script, not committed). A window that completes record R2 and starts a partial R3 reports the tail at the start of R3. R2 renders once and R3 renders once when its newline arrives. An init poll bigger than LOG_CHUNK with an unterminated last record reports the record start as the tail and renders the record once. Empty files and files with no newline report tail 0 and render nothing. They render the record once when the newline arrives.
- No defect found. No open user questions.

Live test 2026-10-11, no code changes made. Ran the webui from the worktree as a user (startWebUi + real HTTP GET /api/agent-log) plus the shipped suites.
- Suites green: node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts (all smoke parts).
- Two-poll split at every one of the record's 128 byte offsets: the first poll serves only the terminated line and reports tail on the record boundary, the second poll from that tail renders the completed record exactly once, a third poll yields "". No offset lost the record and none re-rendered the prefix.
- Live tail: appended one record byte by byte, polled after every byte. Each line rendered exactly once, in order, and the settled stream re-rendered nothing.
- Non-JSON: an unterminated non-JSON line is not rendered and reports tail 0; its continuation appended in a later window renders the whole line once.
- before=1 history poll keeps the requested offset as tail and returns renderable text.
- Regression: a large all-terminated log serves the last LOG_CHUNK unchanged with tail at the file end. A finished log still walks back to renderable content with tail on the last record boundary. An init poll over a huge unterminated record serves no raw JSON.
- Red check repeated: a detached worktree at d56b833 (pre-fix) with the new test file fails at src/webui.test.ts:369 (first.tail 13 != 12); the fix is green.
- One candidate issue investigated and dismissed as a test artifact: rewriting mid-file at an already-consumed offset reports "" (the byte before the offset is no longer a newline). Real agent logs are append-only; append-only growth renders correctly. Not a defect.
- No defect found. No open user questions.
