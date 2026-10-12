---
name: "fix: log pane thinking prose and tool blocks stay Inter"
priority: "low"
state: "done"
worktree: ""
issuer: "#147"
complexity: "simple"
blockedBy: ""
shortName: "log-pre-mono-scope"
---

# Summary
The #147 monospace rule selects every pre in the log pane, so expanded Thinking prose and the tool args/output blocks render monospace although only inline and fenced code should. The fix should narrow the log-pane monospace selector (for example keep `code` mono and stop making the Thinking wrapper pre mono, or scope mono to `#m-log-text code` and `#m-log-text pre code`), while the #m-body scope stays as is.

# Specs
Answer (from the user's #147 order): only inline code and fenced code are monospace. Thinking prose and the tool argument/output blocks are not code, so they must NOT be monospace.

Changes (src/webui.ts CSS only, the rule after '#m-log-text pre { font: inherit; }'):
- Narrow the log-pane monospace selector so it selects only inline code and fenced code (for example scope mono to '#m-log-text code' and '#m-log-text pre code'), and stop making the Thinking-wrapper pre and the tool args/output pres monospace.
- The '#m-body' scope stays as is, and #147's button rules stay untouched.
- Keep the #122 grey colors, the #141 markdown rendering, the #152 sizes and the streaming untouched.

Tests: the webui suite stays green (run it as the check); assert Thinking prose and tool pres are not inside the mono selector.

# Notes

- 59652c3 (worktree fix/153-log-pre-mono-scope): narrowed the 000147 monospace rule in src/webui.ts from `#m-log-text code, #m-log-text pre` to `#m-log-text code, #m-log-text pre code`, so the Thinking-wrapper pre and the tool `lg-args`/`lg-out` pres fall back to the `#m-log-text pre { font: inherit }` Inter stack; `#m-body code, #m-body pre` and the button rules untouched. Updated the mono-rule test in src/webui.test.ts to the new selector and asserted via the parsed selector list that `#m-log-text code` and `#m-log-text pre code` stay in it while the bare `#m-log-text pre` is out. Full npm suite green (kanban, orchestrator, webui, extension, index).
- Review pass (worktree fix/153-log-pre-mono-scope, no fixes): verified the cascade end to end. md() emits `<pre><code>` for fences, so fenced code inside Thinking prose matches `#m-log-text pre code` and stays monospace, while the wrapper pre falls to `font: inherit` (Inter); the tool args/output pres carry esc()d plain text with no code elements, so they also fall to Inter. `#m-body code, #m-body pre` and the button rules untouched; the diff touches only the one CSS rule plus the test block, so #122/#141/#152/streaming are intact. The dropped indexOf order assertion is fine: with the bare pre out of the mono rule the two rules no longer target the same element, so cascade order is irrelevant. Full npm suite green in this pass. Cleared the open questions: both assumptions verified in code (fenced code in Thinking stays mono via pre>code) and in the one-rule diff (untouched areas).
- Live test pass (worktree fix/153-log-pre-mono-scope, no code edits): exercised the real webui in Chromium (Playwright). The worktree PAGE and the worktree payload builders were served on 127.0.0.1:4399 through a minimal server with the same routes as hub.ts, because the board is shared and the running hub serves the main checkout. User flows: board -> task card 000152 -> developer agent card -> expand Thinking and tool blocks; scroll to the top to page log history; then the live card 000153 and its agent log with the 1 s poll.
  - Thinking prose pre rendered `Inter, system-ui, ...` (13 px), not mono. Thinking prose paragraphs and both summary labels also Inter.
  - Tool args `pre.lg-args` and tool output `pre.lg-out` rendered `Inter, system-ui, ...` (13 px), not mono.
  - Inline code in the log rendered `ui-monospace, "SF Mono", Menlo, Consolas, ...` (13 px). A real fenced block inside Thinking rendered as `details.lg-think > pre > pre > code`: the code stayed mono and the wrapper pre stayed Inter. The nested pre survives the HTML parse and the browser keeps the `pre code` match.
  - `#m-body` scope unchanged: body prose Inter, body inline and fenced code mono. The live 153 log pane streamed new records during the poll and the same fonts held. No page errors or console errors.
  - All 11 scripted checks passed. Evidence: /tmp/live153/results.json and the screenshots /tmp/live153/0*.png.
  - Assumptions: the change is CSS in the served page, so a minimal route-compatible server is enough to run the real flow. The fenced-in-Thinking case was reached at history page 9 of the 152 developer log, the one window that holds it. No observed behavior contradicts the task assumptions and no issues were found, so no follow-up tasks were created. Nothing to ask the user, so the task carries no open questions.
- Merge pass (Merger agent): the worktree was already at 59652c3 with `main` fully contained, so step 1 (`git merge main` in the worktree) was a clean no-op "Already up to date" with no conflicts; test suites skipped per the clean-merge rule. Step 2 merged fix/153-log-pre-mono-scope into `main` in the project root as a fast-forward (72fec7f..59652c3, src/webui.ts and src/webui.test.ts). Verified on `main`: the mono rule reads `#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre`, so the Thinking-wrapper pre and the tool args/output pres fall to `font: inherit` (Inter) and only inline plus fenced code stay monospace. Working tree clean after both merges, no open questions.

# Open questions

