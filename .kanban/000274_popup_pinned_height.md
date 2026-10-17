---
name: "fix: task popup keeps its small pinned height when content lands via the poll path"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "popup-pinned-height"
---

# Summary
The task detail popup can stay at its small loading height after content arrives: openTask pins the popup height before its /api/task-detail fetch, and the poll's pollDetail can deliver the same detail first without ever adjusting the height. Fix so any content landing while the height is pinned re-runs the established grow. The user's load-ordering requirement (markdown fetched before agent cards/stats, fetch priority) is already satisfied and gets a test pin.

# Specs
Goal: the task detail popup must grow when its content lands, regardless of which fetch path delivers the content, and the markdown-before-cards ordering must be pinned by a test.

Root cause (verified 2026-10-17 by a read-only fact-finder):
- openTask (src/webui/page.ts:545) writes head + attrs, puts a loading placeholder into #m-body (:555-558), un-hides the modal, then pins the box height at :570-577: box.classList.add("grow"); box.style.height = box.offsetHeight + "px". Only afterwards does it fetch /api/task-detail (:584).
- The 5 s poll refresh() calls pollDetail (:1117) whenever the modal is open; pollDetail re-fetches the same /api/task-detail (:1119) and calls writeHead(d); setBody(d) (:1123-1124), later updateOpenTask -> renderAgent/renderDoctor — and NEVER touches box.style.height or the .grow class.
- The race: if the poll's response resolves first (more likely while a live agent runs, cadence 1 s via refreshMs at :76-78, or right after a tab wake via the visibilitychange refresh at :1137), setBody replaces the placeholder with real markdown while the inline height is still pinned to the small loading height. The popup then sits as a small scrollable box (#m-box has overflow:auto and max-height:82vh at :279) instead of growing. It self-corrects only when the open's own fetch resolves: success grows the box (:601-606: box.style.height = box.scrollHeight + "px" plus a 400 ms timer restoring height="" and removing .grow), failure unpins (:589-590). If the open's request hangs, the popup stays small indefinitely - hence "sometimes".
- Established behavior to keep (settled history, do not re-litigate): #246 chose the animated height grow while details load (#m-box.grow transition at :282, disabled under reduced motion at :283); #248 chose detail text served before heavy history; #251 chose stable detail cards, writes gated by modal state, explicitly NO generation counter (test :437 asserts !page.includes("detailGen") - do not introduce one).

Fix:
- Make any content landing while the height is pinned re-run the established grow. Recommended site: setBody (page.ts:528) so both the open path and the poll path are covered by one change; alternatively pollDetail/updateOpenTask. Reuse the :601-606 grow block.
- Grow only when the body content actually changed while the height is pinned, so repeated identical poll deliveries do not restart the 400 ms unpin timer forever (the popup must still reach height="" when content stops changing).
- Guard the mobile branch: at <= 600px the modal is a full-screen sheet with height:100dvh; max-height:none (:333) - the grow must not fight it (the same matchMedia("(max-width: 600px)") check the existing code uses).
- Keep the failure-unpin at :589-590 and the 400 ms unpin timer.
- closeModal (:653) may clear a leftover inline height for hygiene, but it is optional (every open re-pins at :577); do not restructure.

Load order (user requirement, decided as fetch priority only):
- Already satisfied: the open path chains detail (:584) -> on success grow + fetch history (:610) -> renderAgent/renderDoctor (:615-616) -> per-run sub-list fetches (:908); the poll path mirrors the chain (:1119 -> :1125 -> :1129). The markdown fetch is requested before the agent cards/stats on both paths.
- Add NO render gating (the user explicitly chose fetch priority only, not a hard gate). Pin the existing order with a test so a future change cannot silently reorder.

Tests (tests/webui/page.test.ts):
- A new scenario: the poll path delivers detail content while the popup height is pinned -> the box grows (the inline height updates / the grow re-runs), and repeated identical deliveries do not keep the height pinned forever.
- The 000246 grow block at :422-429 pins exact strings a fix may move ('box.style.height = box.offsetHeight + "px"', 'box.style.height = box.scrollHeight + "px";', 'box.style.height = "";', the failure-unpin regex) - update the pins to the new sites, keeping the same properties asserted.
- A pin that the detail fetch precedes the history fetch on both paths (the sequential chaining strings from :584/:610 and :1119/:1125).
- openTaskSrc is extracted at :416 for string pins; follow the file's existing scenario style.

Acceptance: node tests/webui/page.test.ts passes and pnpm test passes.

Out of scope: the board card rendering, the hub/endpoint side (hub.ts, payload.ts), and any localStorage/prefetch work.

# Notes
- Fixed in src/webui/page.ts (ef81f44): setBody re-runs the 000246 grow when the body html changes while #m-box carries the .grow pin, so whichever fetch path lands the detail first grows the box; the open path's duplicate grow block is removed, one site now covers both.
- The html gate keeps an identical poll delivery from restarting the 400 ms unpin, so the height still reaches auto; the openTask pin, the failure-unpin and the <=600px sheet guard (same matchMedia check) are unchanged.
- Tests (tests/webui/page.test.ts): new served-setBody scenario (pinned delivery grows to scrollHeight, a changed body re-runs the grow, an identical repeat does not re-arm the unpin, an unpinned body writes no height, the mobile sheet keeps no inline height); a pin that the detail fetch precedes the history fetch on both the open and poll paths; the 000246 grow-string pins moved from openTaskSrc to setBodySrc.
- Verified: node tests/webui/page.test.ts passes (red first on the new setBody pin, green after the fix), plus the four sibling webui group files hub, board, logpane, agentlog pass. Full pnpm test not run (scoped-suite rule); the acceptance names it, this is the one deviation.
- Re-review at ef81f44 (base=main, single diff commit): setBody grows at page.ts:536-542 only while #m-box carries the .grow pin and the viewport is not the <=600px sheet (same matchMedia check), so a pinned delivery reaches scrollHeight and an identical repeat is gated by el.__html; the 400 ms unpin is kept (:542). openTask's pin (:579-587), the failure-unpin (:597-599) and the `grow` variable (:583-584, still used) are intact; the duplicate grow block is gone with no dead code left.
- Order pins verified: page.test.ts asserts fetch(detailUrl) before fetch(historyUrl) inside openTaskSrc and pollDetailSrc (:466-470); the 000246 scrollHeight/height="" pins moved to setBodySrc keeping the same properties, the offsetHeight pin and failure-unpin regex stay on openTaskSrc.
- Tests: node tests/webui/page.test.ts exit=0 on the current tree; 281 asserts in the suite, +13 from the diff. Scoped union (src/webui/page.ts -> page.test.ts) is the whole run; the acceptance's full pnpm test stays unrun per the scoped-suite rule. Verdict: pass, to-merge.

## Live test (2026-10-18)

- Hub-only fixture: a temporary .kanban root with a `doing` task (long body, live agent pid plus a developer run log, so the open modal polls at 1 s) and a `backlog` task, served by startHub from the merged worktree. Desktop probe 22 checks, 0 failed; mobile probe 390x844 9 checks, 0 failed.
- Race forced deterministically: the first `/api/task-detail?num=1` request (open path) is held 9 s while the 1 s poll delivers the same detail first. The poll delivery re-ran the grow: inline height == `scrollHeight` (279 px pinned loading height -> 877 px target), then the 400 ms unpin released to `height=""` at the content height (656 px, the 82vh cap).
- Repeated identical deliveries do not restart the unpin: 4 identical poll deliveries after the unpin produced zero `.grow` re-pins (MutationObserver on `#m-box` attributes) and the height stayed released. The late identical open delivery also did not re-pin.
- Load order: every history (cards) fetch follows a detail (markdown) response on both paths, one history fetch per detail delivery, and the first detail request precedes the first history request.
- Mobile guard: at 390x844 the sheet fills the viewport (390x844, `max-height: none`) and gets no `.grow` and no inline height at open or after poll deliveries.
- Failure path kept: it pins first, then unpins with `height=""` and shows "Task details failed to load". No browser page or console errors in any phase.
- Assumptions: the open response is held to make the race deterministic, in the wild it needs a slow open fetch racing a poll tick; the "small loading height" measured 279 px on this fixture, which is the head plus attrs plus placeholder shell.
- Technical difficulties: two probe-side corrections, no product findings. A hardcoded <200 px threshold misjudged the 279 px loading pin (replaced by the measured grow comparison); the mobile viewport read taken immediately after the click caught the in-flight 200 ms `boxIn` entrance (384.9x833.1, about 98.7% scale) and moved to +350 ms.
- Tests not run: node tests/webui/page.test.ts and pnpm test are the developer/reviewer gate, not the live test; this run exercised the served production page instead.
