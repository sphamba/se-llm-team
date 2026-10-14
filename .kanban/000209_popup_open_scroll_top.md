---
name: "fix: task details popup opens showing the top"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "popup-open-scroll-top"
---

# Summary
Reset the task details popup's scroll to the top on every open: in openTask (src/webui/page.ts:472-484), set #m-box.scrollTop = 0 in the open path. Runs on every open including same-task reopens, where setBody's html-gate skips the rewrite. The log popup and log scroll logic stay untouched.

# Specs
## Need

When a task details card opens, the popup must show the top: the scroll position resets to the top on every open. Today, tall content or a previous open can leave the popup scrolled mid-way.

Facts (verified):
- The open path is `openTask(file)` at src/webui/page.ts:472-484: it resolves the task, calls `closeLog()`, sets `modalFile`, `writeHead(t)`, `renderAgent(t)`, `setBody(t)`, then un-hides #modal (`classList.remove("closing")`, `classList.remove("hidden")`). No scroll reset exists anywhere in the page.
- `setBody` (:465-470) is html-gated: `if (el.__html === html) return;` — it skips the rewrite when the html is unchanged (deliberate, preserves reader scroll). So reopening the SAME task never rewrites the body; a scroll reset must therefore live in `openTask`, not in `setBody`, to run on every open.
- `#m-box` is the scroll container: src/webui/page.ts:240 `#m-box { ... max-height: 82vh; overflow: auto; }`; #m-body (:252) has no overflow/max-height. Mobile (:272) lifts the cap (`height: 100dvh`). The reset target is #m-box's scrollTop, not #m-body's.
- Test coupling: no test asserts openTask's body or scroll behavior. The nearby pinned script lines (tests/webui.test.ts:872-879, :1019) are untouched by this change; the setBody html-gate pin must keep passing.

## Changes

- In `openTask` (src/webui/page.ts:472-484), add a scroll reset so the popup shows the top on every open: fetch #m-box (the scroll container) and set its `scrollTop = 0` in the open path, after the content calls and alongside showing the modal. One line, no helper.
- It must run on every open, including reopening the same task (where setBody's html-gate skips the rewrite) — do not move the reset into setBody or make it conditional on content changes.
- Do not touch the log popup's open path (openLog :670-695), the log pane's scroll logic (:565-764), setBody's html-gate, or the #194 close/reopen handling comment.

## Acceptance criteria

- `rg -n "scrollTop = 0" src/webui/page.ts` shows the reset inside openTask (between lines 472-484).
- `rg -n "function openTask" -A 14 src/webui/page.ts` shows content set, then the reset, then the un-hide.
- `npm test` passes (five suites), including the setBody html-gate pin.

# Notes
