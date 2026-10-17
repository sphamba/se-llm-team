---
name: "chore: split-test-suite-webui logpane"
priority: "medium"
state: "done"
worktree: "chore/258-split-test-suite-webui-logpane"
issuer: "#256"
complexity: "simple"
shortName: "split-test-suite-webui-logpane"
---

# Summary
Extract the logpane scenario group (old tests/webui.test.ts lines 43-313, 61 assertions) into a standalone tests/webui/logpane.test.ts. The old file is not edited: it is deleted later by parent task #256.

# Specs
Facts: tests/webui.test.ts is a 2,379-line / 739-assertion plain top-level node script (node:assert/strict, top-level awaits, no framework). It stays untouched while you work; parent task #256 deletes it after all five group files land. Your range: lines 43-313 (61 assertions), the logpane group: LogEl stub, logFixups DOM fixups, renderLogChunk chunking/collapsible blocks, md() markdown rendering, sidechain transcripts. Line 43 starts "// minimal element stub for the log-pane fixups"; the range ends with the thinkMd assert ("a thinking body containing markdown renders through md() inside the lg-think details"), right before "// the hub serves the dashboard endpoints". The five subtask ranges are disjoint and sum to all 739 assertions.

Requirements:
1. Create tests/webui/logpane.test.ts holding this range's scenarios, moved verbatim: scenario code and 000NNN comments unchanged, only imports, paths and boot adapted.
2. Self-contained: copy needed helpers (the LogEl stub and friends) inline into your file. Do NOT create tests/webui/helpers.ts, do NOT import from tests/webui.test.ts or root tests/helpers.ts: parallel siblings cannot rely on your file mid-run, and the old file will be deleted.
3. Imports become ../../src/*.ts from tests/webui/: import only what your range uses, e.g. renderLogChunk/logFixups/md (and LOG_LINES if used) from ../../src/webui.ts, esc/LOG_ROLES from ../../src/webui/logpane.ts. This group needs no hub and no temp dirs beyond what the range itself sets up.
4. Standalone runnable: node:assert/strict, top-level awaits, node tests/webui/logpane.test.ts passes.
5. No assertion dropped: your file carries exactly 61 assertions (grep -c "assert\."); the move is verbatim, not rewritten.
6. Ownership: this task owns tests/webui/logpane.test.ts only. Do not touch tests/webui.test.ts, package.json, scripts/test-changed.mjs, tests/helpers.ts or any sibling test file. pnpm test still runs the old file until task #255 lands the glob; that is expected.
7. State the big assumptions affecting the feature.

Acceptance:
- node tests/webui/logpane.test.ts passes standalone.
- The file carries exactly 61 assertions and its scenario text matches the old range (imports/paths/boot apart).
- git status shows only tests/webui/logpane.test.ts as new.

# Notes

- Created tests/webui/logpane.test.ts with lines 43-313 of tests/webui.test.ts moved verbatim (a diff of the range against the new file body is clean): LogEl stub and selector matcher, logFixups promotion and join scenarios, renderLogChunk chunking and collapsible blocks (000122, 000148, 000141), sidechain transcripts and the md() markdown asserts.
- Header imports only assert, logFixups and renderLogChunk from ../../src/webui.ts. md, esc, LOG_ROLES and LOG_LINES occur in the range only in comments and assertion messages, so they are not imported.
- node tests/webui/logpane.test.ts exits 0 standalone. grep -c 'assert\.' gives 61. Committed as 1898b6a. Only the new file is in the commit; tests/webui.test.ts, package.json, scripts/test-changed.mjs and tests/helpers.ts are untouched.
- Review at 1898b6a: old range 43-313 diffed against the new file body is clean apart from one blank line after the imports (boot, allowed by req 1). Imports hold logFixups and renderLogChunk only; md, esc, LOG_ROLES and LOG_LINES occur in the new file only in comments and assertion messages, so not importing them is correct (req 3's list is illustrative). Standalone run exit=0, 61 assertions. No grep of logpane in package.json, scripts/test-changed.mjs or tests/helpers.ts; tests/webui.test.ts untouched, git status shows only tests/webui/logpane.test.ts. No fixes, no open questions.

## Live test (2026-10-17)

- Result: 41 checks, 0 failed (13 static, 28 in the browser). The test file was parsed and inspected, never executed, so the unit suite ban stays in force. No code file was edited.
- Assumption: "node tests/webui/logpane.test.ts passes standalone" is a developer and reviewer gate. The live test applied the same scenarios to the merged production surface: `node --check` on the file, resolution of both import specifiers from the merged src, and a replay of the moved scenarios through the real hub log pane.
- Assumption: the sidechain records sit directly in the run log. The page renders isSidechain records through the same renderLogChunk path as a sub transcript, so the served behavior is the same.
- Verbatim move: the new file body equals old lines 43-313 at branch base a582b65 and old lines 46-316 at merged parent b9ced0d. The 3-line shift comes from b9ced0d, which inserted 3 lines above the group. Both ranges carry 61 assertions. The scenario comments 000122, 000148 and 000141 are in the file.
- Ownership: commit b7f3021 adds only tests/webui/logpane.test.ts. tests/webui.test.ts, tests/helpers.ts, package.json and scripts/test-changed.mjs are untouched by it. Worktree git status is clean.
- Self-contained: exactly two imports (node:assert/strict and ../../src/webui.ts), no reference to the old file or to a helper file, no temp dir, HOME or child_process boot left, and the LogEl stub and logDoc are inlined.
- Served-surface replay (hub on 127.0.0.1:4350, one doing task with a live pid and one developer run log): the log pane shows the prompt and the sidechain prompt lines, the md() paragraphs, the open Thinking block, the closed markdown thinking block with b and li, one tool block per call, the failed tool summary, the args body, the joined tool result, the sidechain tool block and result, the orphan result promoted with the generic summary, the non-JSON line, no raw JSON, and the bold, inline code and fenced code markdown.
- Live poll at the 1 s cadence with appended records: a delta joins the init open block in place, a cross-window thinking_end closes it with the authoritative text, a delta with no open block promotes a new open block, and the next thinking_end closes that block. An `<img ...>` delta stays escaped (0 img elements). A partial trailing record is not rendered, then renders exactly once when its newline arrives. No page errors.
- Finding: the Specs line range 43-313 is stale against the merged parent, because b9ced0d moved the logpane group to 46-316. A reviewer who diffs literal lines 43-313 against the current old file sees the 3-line shift. The extraction follows the semantic boundaries (stub comment to the thinkMd assert) and matches the old range verbatim at both revisions, so the move is correct.
- Open questions: none.

