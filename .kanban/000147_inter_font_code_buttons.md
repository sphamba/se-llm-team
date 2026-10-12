---
name: "fix: code blocks stay monospace; buttons use Inter"
blockedBy: ""
priority: "low"
state: "done"
worktree: ""
issuer: "#141"
complexity: "simple"
shortName: "inter-font-code-buttons"
---

# Summary
Follow-up to the #141 live test (commit 03c450b): code blocks (inline code and fenced code) get an explicit monospace font instead of the UA default or the inherited Inter, and buttons (theme toggle, column header toggles, Close, agent cards) get Inter instead of the UA Arial default. The user answered the open questions: code stays monospace, buttons use Inter.

# Specs
Measured computed styles on the real board (Chromium, from the #141 live test): #m-log-text pre = Inter (fenced code blocks render as pre via md(), so fenced code is Inter today), #m-log-text code and #m-body code = "monospace" (UA default), and #theme, #m-close, .agent-card, .toggle (all button) = "Arial" (UA default). Root cause: src/webui.ts declares Inter only on body and #m-log-text (plus #m-log-text pre { font: inherit; }) and has no rule for code or button, so both keep the UA defaults.

Fix, src/webui.ts plus src/webui.test.ts only:
- Code stays monospace, explicitly: give code elements and fenced code blocks a monospace stack, e.g. `code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }` scoped to the log pane and task body (#m-log-text, #m-body), overriding the #m-log-text pre { font: inherit; } Inter inheritance so fenced code blocks from md() render monospace deliberately instead of the UA default or Inter; inline code keeps monospace explicitly rather than relying on the UA sheet.
- Buttons use Inter: `button { font-family: inherit; }` (font-family alone, not font: inherit, so size/weight/line-height stay as today and only the family changes) so #theme, #m-close, .agent-card and .toggle render Inter.
- Scope is font styling only: markdown rendering, log streaming and HTML escaping passed the #141 live test and stay untouched; the existing logCss assertions (system-ui present, no monospace... note the new code/pre monospace rule introduces "monospace" into the CSS, so the src/webui.test.ts assertion logCss.includes("system-ui") && !logCss.includes("monospace") at :561 needs updating to scope the no-monospace check to the body/#m-log-text font-family declarations rather than the whole CSS).

Tests: extend the flat assertion script - the PAGE ships the code/pre monospace rule scoped to #m-log-text/#m-body and the button font-family: inherit rule; logCss still puts "Inter" first on body and #m-log-text; the updated no-monospace assertion passes; existing suites stay green.

# Notes
- Implemented on the worktree, commit a6a07ec. src/webui.ts: added `button { font-family: inherit; }` right after the body rule, and `#m-log-text code, #m-log-text pre, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }` placed after `#m-log-text pre { font: inherit; }` so it wins the cascade and fenced code in the log pane renders monospace, not Inter. Nothing else in the page changed (markdown rendering, log streaming, escaping untouched).
- src/webui.test.ts: the old no-monospace check `logCss.includes("system-ui") && !logCss.includes("monospace")` was block-scoped already, so it still passed; tightened it to match the `font-family` declaration inside the `#m-log-text { ... }` block so the scope is explicit. Added assertions: the PAGE ships the monospace rule verbatim, the monospace rule sits after the `font: inherit` shorthand (cascade-order guard), and `button { font-family: inherit; }` ships. The `font-family: Inter, system-ui...` count-of-2 assertion is unchanged and passes.
- Full suite green: kanban, orchestrator, webui, extension, index.
- Review (000147, worktree commit a6a07ec): no fixes needed. Verified against the Specs: the monospace rule at src/webui.ts:1155 sits after `#m-log-text pre { font: inherit; }` at :1133 with equal specificity, so it wins the cascade and fenced log code renders monospace, not Inter; `button { font-family: inherit; }` at :1059 sets font-family only, so size/weight/line-height stay unchanged; diff touches only webui.ts CSS and webui.test.ts assertions. Both developer assumptions resolved against the Specs: the mono stack is the spec's own example used verbatim, and the global button rule is the spec's own prescription (the .tab project buttons also pick up Inter, consistent with "buttons use Inter"). Full suite re-run green.
- Live test (worktree fix/147-inter-font-code-buttons, commit a6a07ec): one issue found.
- Method: no unit suite was run, that is the developer and reviewer gate. A hub daemon imported the worktree src/hub.ts and served the worktree src/webui.ts PAGE on a test port, pointed at the real board and the real .kanban/.logs. The hub registry lived in a throwaway HOME, so the production hub on 4242 kept running untouched. Chromium (Playwright) loaded the production hub at 4242 as the pre-fix baseline and the worktree build at 4673. Flows: load the board, toggle the theme, expand collapsed columns, open task #141 (inline code) and task #147, click the Developer agent card, scroll the log pane to the top until a history chunk with a real fenced block loaded, expand a collapsed Thinking block, click the project tabs, and close the modal.
- Passed, measured computed styles in Chromium:
  - Inline and fenced code in the task body: #m-body code and #m-body pre = ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace at 12px. The old UI measured UA monospace for #m-body code.
  - Fenced code in the log pane: a real fenced block in the #147 developer log renders #m-log-text pre code and its parent pre in the mono stack at 10px after 13 scroll-to-top history loads. The old UI measured Inter for the parent pre and UA monospace for the inner code.
  - Buttons use Inter: #theme, .toggle, .tab, #m-close, .agent-card and .agent-sub = Inter, system-ui, ... in the closed and open modal states. The old UI measured Arial. Size, weight and line height stay at 12px / 400 / normal, so only the family moved.
  - body and #m-log-text keep Inter first (exactly two declarations), document.fonts.check("12px Inter") is true, no page error and no failed request in any flow, the theme toggle flips Dark and Light, the tabs switch and return, and the modal closes.
- Issue:
  - The log-pane pre selector is broader than code blocks. #m-log-text pre also matches the Thinking wrapper pre, which holds the md() rendering of the thinking body, so prose inside an expanded Thinking block now renders monospace (details.lg-think > pre p = mono stack, Inter before). It also matches the raw tool-argument and tool-output blocks (pre.lg-args, pre.lg-out), which were Inter before. The #141 spec intended thinking bodies to render markdown in the page's Inter stack. The scope of "code blocks stay monospace" does not cover that prose. A task went to the Project manager.
- Assumptions and contradictions:
  - The Specs repeat the #141 measurement "#m-log-text pre = Inter (fenced code blocks render as pre via md())". On the real logs a markdown fenced block is pre > code, while a plain pre in the log pane is the Thinking wrapper (md output) or a tool args/output block. #m-body has no such wrapper, so there pre is only a fenced block. The test measured both forms, and the discrepancy is the issue above. This contradicts the task assumption that a log-pane pre is a fenced code block.
  - No task body on the board has a real fenced block, so #m-body pre was exercised with a temporary element in the real open task modal. Writing a test task file would touch the shared .kanban board.
  - The fenced-block check needed history: the log pane opens on the tail chunk, so the test scrolled to the top repeatedly, which is a normal user gesture.
- Merged (base branch main): step 1 merged main into fix/147-inter-font-code-buttons in the worktree, already up to date, no conflicts, so no test suites were re-run. Step 2 merged fix/147-inter-font-code-buttons into main in the project root, fast-forward 7a011a1..a6a07ec, clean. main is at a6a07ec with the two changed files (src/webui.ts +4, src/webui.test.ts +9/-1). No unresolvable conflicts, no failing tests.

# Open questions
- Should the log pane's Thinking prose and the tool argument/output blocks stay monospace, or should only inline code and fenced code be monospace? The new rule makes the whole Thinking body monospace, which is more than the Summary asked for.
