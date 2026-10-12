---
name: "fix: code blocks stay monospace; buttons use Inter"
blockedBy: "#146"
priority: "low"
state: "backlog"
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
