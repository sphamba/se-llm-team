---
name: "chore: split-test-suite-webui logpane"
priority: "medium"
state: "doing"
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
