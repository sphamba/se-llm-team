---
name: "fix: log pane thinking prose and tool blocks stay Inter"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#147"
complexity: "simple"
blockedBy: "#147, #152"
shortName: "log-pre-mono-scope"
---

# Summary
The #147 monospace rule selects every pre in the log pane, so expanded Thinking prose and the tool args/output blocks render monospace although only inline and fenced code should. The fix should narrow the log-pane monospace selector (for example keep `code` mono and stop making the Thinking wrapper pre mono, or scope mono to `#m-log-text code` and `#m-log-text pre code`), while the #m-body scope stays as is.

# Specs
Source: live test of #147 (worktree fix/147-inter-font-code-buttons, commit a6a07ec); evidence in the # Notes of .kanban/000147_inter_font_code_buttons.md. Everything else in #147 passed the live test and is out of scope here.

Problem: #147 added `#m-log-text code, #m-log-text pre, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }` in src/webui.ts, placed after `#m-log-text pre { font: inherit; }`. In the log pane a pre is not only a fenced code block: src/webui.ts wraps each Thinking body in a pre (details.lg-think > pre) that holds the md() rendering of the thinking text, and it renders tool arguments/output as pre.lg-args / pre.lg-out. `#m-log-text pre` matches all of them, so expanded Thinking prose and the tool arg/output blocks now render monospace. That is broader than the #147 Summary ("code blocks (inline code and fenced code) get an explicit monospace font") and reverses the #141 intent that thinking bodies render markdown in the page's Inter stack.

Measured evidence (Chromium, real board, from the #147 live test):
- details.lg-think > pre p computed font-family is the mono stack now; it was `Inter, system-ui, ...` in the pre-fix baseline (production hub on 4242).
- pre.lg-args was Inter before and is the mono stack now.
- Inline code and real fenced blocks (pre > code) are correctly monospace in #m-body and #m-log-text.

Fix area: src/webui.ts CSS only, the rule after `#m-log-text pre { font: inherit; }`. Narrow the log-pane monospace selector so it no longer selects the Thinking-wrapper pre and the tool args/output pres while inline and fenced code stay monospace (for example keep `code` mono and stop making the Thinking wrapper pre mono, or scope mono to `#m-log-text code` and `#m-log-text pre code`). Do not prescribe the exact scope: the exact intended behavior is the Open questions item, the user decides it. The `#m-body` scope stays as is, and #147's button rules stay untouched.

Constraints: font styling only. Do not change markdown rendering, log streaming or HTML escaping. Do not touch the board apart from this task.

Tests (repo convention: extend src/webui.test.ts assertions, the flat assertion script): update the #147 assertions so the test pins the narrowed selector (or the accepted scope once the open question is answered), keeping the intent of the existing checks (Inter stays first on body and #m-log-text, buttons stay `font-family: inherit`); keep the existing suites green (node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts).

# Notes

# Open questions
Should the log pane's Thinking prose and the tool argument/output blocks stay monospace, or should only inline code and fenced code be monospace? The new rule makes the whole Thinking body monospace, which is more than the Summary asked for.
