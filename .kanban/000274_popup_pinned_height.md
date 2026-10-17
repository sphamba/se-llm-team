---
name: "fix: task popup keeps its small pinned height when content lands via the poll path"
priority: "medium"
state: "backlog"
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
