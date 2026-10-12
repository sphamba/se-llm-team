---
name: "fix: Inter font does not reach log code and buttons"
blockedBy: "#146"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#141"
complexity: "simple"
shortName: "inter-font-code-buttons"
---

# Summary
Live test of #141 (commit 03c450b) found the Inter font does not reach every element, so the "Inter font everywhere" claim is not met. Measured computed styles on the real board (Chromium) show #m-log-text pre = Inter, but #m-log-text code and #m-body code = "monospace" and #theme, #m-close, .agent-card, .toggle (all <button>) = "Arial" — the browser UA defaults, not inherited Inter. Root cause: src/webui.ts has no rule overriding the UA stylesheet for code and button. The #141 spec wrongly claimed these inherit Inter. Fix is one line each in src/webui.ts: `code { font-family: inherit; }` and `button { font: inherit; }`. Only the font inheritance is in scope: markdown rendering, log streaming and HTML escaping passed the #141 live test.

# Specs
Follow-up to the live test of #141 (worktree feat/141-markdown-log-text-inter-font, commit 03c450b). The task title claims "Inter font everywhere", but the page serves two UA-defaulted font stacks that never inherit the two Inter declarations (body and #m-log-text).

## Reproduction

Serve the board from the #141 worktree and, in Chromium devtools, inspect the computed `font-family` of:

- `#m-log-text pre` → Inter (correct)
- `#m-log-text code` → "monospace" (browser default)
- `#m-body code` → "monospace" (browser default)
- `#theme`, `#m-close`, `.agent-card`, `.toggle` (all `<button>`) → "Arial" (browser default)

## Root cause

The browser UA stylesheet sets `code` to monospace and `button` to Arial. src/webui.ts declares Inter only on `body` and on `#m-log-text` (plus `#m-log-text pre { font: inherit; }`), so `code` and `button` keep the UA defaults instead of inheriting Inter. The #141 spec assumed code and everything else inherit Inter; that assumption is false.

## Suggested fix

One line each in src/webui.ts:

```css
code { font-family: inherit; }
button { font: inherit; }
```

`font: inherit` also pulls in the button's size/weight/line-height; if that changes button appearance (agent cards, column header toggles), use `font-family: inherit` alone.

## Acceptance

Computed `font-family` of `#m-log-text code`, `#m-body code`, `#theme`, `#m-close`, `.agent-card` and `.toggle` matches the page's Inter stack (for `code`, whichever the Open questions resolve to), verified on the real page in Chromium; the rest of the #141 behaviour untouched.

## Out of scope

Markdown rendering, the log streaming and the HTML escaping all passed the #141 live test. This task is only about the font inheritance.

# Notes

# Open questions
1. Should inline code and fenced code blocks in the board, the task body and the agent log use Inter (as the spec claims) or stay monospace (the usual convention for code)?
2. Should the buttons (theme toggle, column header toggles, Close, agent cards) inherit Inter like the rest of the page?
