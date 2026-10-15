---
name: "fix: issuer task number links to its task card in the detail modal"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "issuer-num-link"
---

# Summary
In the task detail modal, the issuer row shows a plain-text #num when the issuer is another task. Make it a .num-link that opens that task's detail card, reusing the blockedRow resolution pattern.

# Specs
# Specs
- In attrsHtml (src/webui/page.ts:476) the issuer row becomes a link when the issuer is another task: when t.issuer matches #<num>, resolve the number to the task file on the active board (same pattern as blockedRow: parseInt match against each task's file prefix) and render numLinkHtml(target.file). The existing binding loop at page.ts:466 already binds every #m-attrs .num-link to openTask(data-task), so no new binding code.
- Fallbacks: issuer "user" or absent stays plain text; an issuer number whose task is not on the active board stays plain text.
- The board card's issuer badge (board.ts:164) stays unchanged; the .num-link CSS already exists.
- Update the scoped assertion at tests/webui.test.ts:795, which pins the current plain-text expression, to match the new issuer row.

# Acceptance
- Live-UI check: a task-issued task's detail modal shows the issuer #num as a link (link color, pointer) that opens that task's detail card.
- Grep check: the issuer row renders numLinkHtml for task-issued issuers with the blockedRow-style resolution; the tests/webui.test.ts:795 assertion is updated.
- Plain text for "user" and for issuer numbers not on the active board.

# Notes
- Commit 1dc1aec. src/webui/page.ts: attrsHtml renders the issuer row through a new issuerCell(t). A "#<num>" issuer resolves through the new taskByNum(ref) helper (the blockedRow lookup, extracted and shared) and renders numLinkHtml(target.file); "user", an absent issuer, and an off-board number keep the plain text. The existing #m-attrs .num-link binding opens the linked card, no new binding code.
- tests/webui.test.ts: the old issuer-row page.includes assertion is replaced by two, one pinning the issuerCell row and one the link-or-plain expression.
- Before-proof: `node tests/webui.test.ts` failed at "the detail card shows the issuer row" before the source edit. After the edit the suite exits 0 with "webui.test.ts: all assertions passed".
- Live check (fixture /tmp/t231ln/root, per-root webui port 4321, isolated HOME): the modal of 000002_issued (issuer #1) shows one .num-link "#1" (data-task 000001_origin.md, pointer cursor, --link color rgb(230, 180, 80)) and clicking it opens the origin task's card. 000003_user (issuer user) and 000004_offboard (issuer #9, not on the board) show plain text with no .num-link. /tmp/t231ln/check.mjs printed LIVE CHECK PASSED.
- Review: all four spec bullets verified against the diff; tests/webui.test.ts exits 0. t.issuer is a string by construction (typed string in kanban.ts, /^#\d+$|"user"/ at creation, ?? "user" on parse), so taskByNum's ref.replace is safe. The two Open-questions assumptions restated the Specs (active-board-only, the blockedRow numeric-prefix pattern) and are dropped as settled.

## Live test (2026-10-15T21:07Z, live-tester)
- Fixture /tmp/lt231/root: five tasks (000001 origin, 000002 issuer "#1", 000003 issuer "user", 000004 issuer "#9" off-board, 000005 blockedBy "#1"). Hub on port 4331 served the merged worktree (GET /api/hub commit 602dbb8) with an isolated HOME. Checks ran in Chromium with Playwright.
- PASS: the 000002 modal issuer row renders `<span class="num-link" data-task="000001_origin.md">#1</span>` with pointer cursor and the link color rgb(242,151,24), against rgb(92,97,102) for plain text. A click opens the origin card (#m-title "Origin task", number row data-task 000001_origin.md). No new binding code was needed.
- PASS: 000003 (issuer "user") and 000004 (issuer "#9", no task 9 on the board) show plain text without a .num-link.
- PASS: board card keeps its `.chip.issuer` badge "#1" (board.ts unchanged).
- PASS: regression of the shared lookup extraction: the 000005 blockedBy link still resolves to 000001_origin.md and opens the origin card.
- PASS: no page or console errors.
- PASS: differential control. The pre-change hub (git archive HEAD~1 src, port 4332) over the same fixture shows plain "#1" with no .num-link.
- PASS: acceptance grep. issuerCell calls taskByNum and renders numLinkHtml(target.file) on a match; blockedRow uses the same taskByNum. tests/webui.test.ts:795 now pins the issuerCell row plus the link-or-plain expression.
- Assumption: "active board" is the board that the hub serves; the off-board probe is an issuer number with no task file. No behavior contradicts the task's stated assumptions.
- No product findings. One test-script selector bug (a plain issuer value is a bare text node, so lastElementChild is the label span) was fixed in the script and did not reach the report.

# Open questions
