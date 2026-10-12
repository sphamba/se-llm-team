---
name: "feat: markdown-render assistant and thinking log text; Google Inter font everywhere"
priority: "medium"
state: "backlog"
worktree: ""
blockedBy: "#140"
issuer: "user"
complexity: "moderate"
shortName: "markdown-log-text-inter-font"
---

# Summary
Assistant and thinking text in the agent log pane render as markdown, tolerant of partial unclosed constructs at chunk boundaries (scrolling or live generation), and the page uses the Google Inter font everywhere.

# Specs
Reuse what exists: a minimal markdown renderer md() is already in the client at src/webui.ts:1043-1062 (used for task-card bodies at :1207; covers headings, lists, fenced code, inline code, bold, links; auto-closes an open fence at the end of its input). Extend and reuse it, no new dependency.

Markdown rendering, src/webui.ts plus src/webui.test.ts only:
- Assistant text: the message_update text_delta accumulation path flush() at src/webui.ts:315-321 currently emits esc(pending) lines directly into #m-log-text; emit md(pending) instead. Sidechain assistant text blocks (webui.ts:459-468) take the same path and render markdown too.
- Thinking bodies: thinkHtml (webui.ts:339-340) currently puts escaped text in a pre inside details.lg-think; render the thinking body through md() as well, keeping the details.lg-think/summary structure and the #140 grey color.
- HTML safety: the markdown path must escape HTML before applying markdown so log text can never inject markup; verify md()'s escaping order on the log path (task bodies already go through it).
- Partial unclosed constructs: each chunk renders standalone (client ingest inserts chunk HTML; no shared render state), so a construct split across a chunk boundary - an unclosed ``` fence at the end of a chunk while generating, or a history chunk that begins or ends mid-construct when scrolling - is handled by md()'s auto-close of an open fence at the end of its input: the partial construct renders as a closed block instead of garbled text and the continuation chunk re-opens its own. Mark this accepted tradeoff in a comment naming the ceiling (a construct spanning a boundary renders as two pieces) and the upgrade path (carry per-slug render state across polls).
- Inter font: add preconnect links plus the Inter stylesheet from fonts.googleapis.com in the PAGE head before the style block at webui.ts:900 (no CSP exists; hub headers are only content-type/cache-control/connection at src/hub.ts:199). body (:907) and #m-log-text (:976) font-family put "Inter" first and keep the existing system-ui fallback stack, so the test assertion logCss.includes("system-ui") && !logCss.includes("monospace") at src/webui.test.ts:561 stays true. Tool args/output, code, and everything else inherit Inter via the same two font-family declarations (there are exactly two; #m-log-text pre is font: inherit).

Tests (extend the flat assertion script in src/webui.test.ts):
- A text delta containing **bold**, `inline code` and a ``` fenced block renders strong/code/pre via md().
- A chunk ending with an unclosed ``` fence renders the partial as a closed fenced block (auto-close).
- A thinking body containing markdown renders through md() inside the lg-think details.
- Plain-text deltas and blank-line passthrough assertions stay green (plain text without markers renders unchanged apart from wrapping).
- The PAGE contains the Google Fonts links and "Inter" first in both font-family declarations; the existing client-ship assertions (dedupe, .lg-tres/.lg-cont display, #m-log-text CSS regexes, #m-agent-btns) stay green.
- No orchestrator changes, no new npm dependencies.
