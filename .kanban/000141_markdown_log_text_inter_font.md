---
name: "feat: markdown-render assistant and thinking log text; Google Inter font everywhere"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
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

# Notes
Implemented in worktree feat/141-markdown-log-text-inter-font, commit 03c450b.
- Moved the minimal markdown renderer md() and its inline() helper out of the PAGE template literal to module scope in src/webui.ts (real escapes now, no doubled template-literal escapes) and exported md; the PAGE script interpolates them, so the server-side renderLogChunk and the client task-card body share the one tested renderer. No new dependency.
- renderLogChunk flush() now emits md(pending), so message_update text deltas and sidechain assistant text blocks render bold, inline code, fences, headings, lists and links. Added the accepted-tradeoff comment at flush(): each chunk renders standalone, a construct split across a chunk boundary renders as two pieces (md auto-closes an open fence, the continuation chunk re-opens its own); upgrade path: carry per-slug render state across polls.
- thinkHtml and the sidechain thinking block render the thinking body through md() inside details.lg-think, keeping the details/summary structure, the inner pre, the #m-log-text details > pre indent and the #140 grey (color rule untouched).
- HTML safety verified: md() escapes HTML (esc) before applying markup; test asserts a delta with <img src=x onerror=alert(1)> renders escaped and cannot inject tags.
- Inter font: PAGE head gained two preconnect links plus the Inter stylesheet (css2, wght 400..700, display=swap) before the style block; body and #m-log-text font-family put Inter first and keep the existing system-ui fallback stack (still exactly two font-family declarations; #m-log-text pre stays font: inherit, so tool args/output and code inherit Inter).
- Tests: src/webui.test.ts extended with the spec cases (rich delta renders b/code/pre, unclosed fence auto-closes, thinking body markdown inside lg-think, plain text unchanged apart from wrapping, Google Fonts links present, Inter first in exactly the two stacks, page ships the tested md). Assertions touched by the wrapping change (think pre content, split-record, walk-back and gzip endpoint expectations) updated to the md-wrapped forms; legacy non-JSON passthrough and lg-tres/lg-cont expectations unchanged and green.
- All four suites pass: extension.test.ts, kanban.test.ts, orchestrator.test.ts, webui.test.ts (webui run twice for stability). No orchestrator changes, no new npm dependencies.

Review (worktree feat/141-markdown-log-text-inter-font, commit 03c450b): no fixes needed.
- Diff touches only src/webui.ts and src/webui.test.ts; worktree clean; package.json untouched (no new dependencies), no orchestrator changes.
- Verified against every spec point: flush() emits md(pending) (sidechain text blocks take the same path); thinkHtml and the sidechain thinking block render through md() with the details.lg-think/summary structure and the #140 grey rule untouched; md() escapes HTML (esc) before applying markup; the accepted-tradeoff comment at flush() names the ceiling (a construct spanning a boundary renders as two pieces) and the upgrade path (per-slug render state across polls); Google Fonts preconnects plus the Inter stylesheet sit in the head before the style block; hub headers stay content-type/cache-control/connection only, so the font links load.
- Verified the PAGE interpolation: the client script parses (node --check), String(md) ships whole with no leaked export keyword, esc and inline are initialized before any runtime md() call, and the page holds exactly two font-family declarations, both Inter first with the system-ui fallback kept (logCss assertion stays true).
- Verified the client paths: task-card bodies share the same md (setBody), ingest inserts server-rendered chunk HTML (md output is escape-safe), logFixups appends lg-cont continuation text via textContent (no double escaping).
- Manual edge checks: bold split across a chunk boundary renders two literal pieces, a chunk beginning inside a fence renders plain paragraphs, headings and lists render. Nothing garbles.
- All four suites re-run green: extension, kanban, orchestrator, webui.

Live test (worktree feat/141-markdown-log-text-inter-font, commit 03c450b): one issue found.
Method: no unit suite was run (that is the developer/reviewer gate). The test ran the real interface: a hub daemon served the worktree src/webui.ts module on a test port, and Chromium loaded the page and clicked the board, the task card, the agent cards, and the log pane. The test used the real board and the real 141 agent logs. A second scratch project supplied one controlled JSON log for the edge cases (markdown, HTML injection, a fence that stays open across a 288 KB window).
Passed:
- The page head holds the two preconnect links and the Inter stylesheet before the style block. The page response has no CSP header, so the font links load.
- Inter loads from Google Fonts (document.fonts.check("12px Inter") is true). The computed font-family of body and #m-log-text is Inter first. The page has exactly two font-family declarations.
- Assistant text renders markdown: bold, inline code, fenced code, headings, lists and links. The task-card body uses the same renderer.
- Thinking bodies render markdown inside details.lg-think. The details/summary structure and the muted grey color (rgb(173,174,177) in the light theme) are intact.
- HTML safety: a delta with <img src=x onerror=alert(1)> renders as text. The pane holds no img and no script element. A javascript: link in model text does not run (the browser blocks it with rel=noopener).
- An unclosed fence at the end of a chunk renders as a closed fenced block. A window that starts inside a construct renders without garbling.
- Live generation: the rendered log pane grew from 4,000 to 20,000 characters in 15 s through the 1 s poll. No page error. A scroll to the top pulled history chunks and kept the scroll position.
- The 13 MB developer log opens, renders thinking blocks, code fences and tool blocks, and history scrolling works.
Issue:
- Inter is not everywhere. The <code> elements render in the browser default monospace, and the <button> elements render in the browser default Arial. Measured computed styles on the real page: #m-log-text pre = Inter, #m-log-text code = monospace, #m-body code = monospace, and #theme, #m-close, .agent-card, .toggle = Arial. The UA stylesheet sets code to monospace and button to Arial, and no rule overrides these. The spec claims that code and everything else inherit Inter from the two font-family declarations. A task for the fix went to the Project manager.

Merge (Merger agent): completed with both merges clean.
- Step 1: resolved the base branch of the root checkout as main; merged main into feat/141-markdown-log-text-inter-font in the worktree. Already up to date (the branch head 03c450b sits directly on main head 18db541), no conflicts, so the test suites were skipped per the merge procedure.
- Step 2: resolved the base branch again as main (unchanged); merged feat/141-markdown-log-text-inter-font into main at the root. Fast-forward 18db541..03c450b, touching only src/webui.ts and src/webui.test.ts. Repo clean after the merge.
- The live-test issue above was resolved by the Project manager as a separate fix task (#147, inter-font-code-buttons), so the branch merged as live-tested.
