---
name: "fix: agent log drops a JSONL record split across two poll windows"
priority: "medium"
state: "doing"
worktree: "fix/84-agent-log-drops"
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
