---
name: "fix: mobile full-screen task popup has no close affordance while scrolled"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#205"
complexity: "simple"
shortName: "mobile-popup-close-affordance"
---

# Summary
On mobile (<600px) the task details popup #m-box is a full-screen sheet flush with all edges (task #205, commit 5ce5f36 in src/webui/page.ts), which removes every way to close it once the user scrolls: the overlay tap-to-close can never fire and the Close button scrolls away. Restore a close affordance reachable from any scroll position on mobile.

# Specs
Usability regression found in the live test of #205 (feat: mobile task details popup flush with the screen sides).

On mobile viewports (under 600px) the task details popup #m-box is now a full-screen sheet flush with all four screen edges (added by #205, commit 5ce5f36 in src/webui/page.ts). This removes every way to close the popup once the user scrolls the content:

- The popup covers the whole viewport, so the #modal overlay tap-to-close handler (src/webui/page.ts:754, fires only when e.target is #modal) can never fire on mobile.
- The Close button sits in #m-head at the top of the scrolling #m-box (overflow: auto is on #m-box), so it scrolls out of view with long content. The scrolled-away Close button alone is pre-existing behavior (the old page shows it too), but the old page also kept tappable overlay strips (16px side margins plus the bottom 18vh strip from the 82vh cap) that closed the popup from any scroll position.
- Esc is not reachable on phone keyboards.

Verified by a differential live test with Playwright at 390x844, popup scrolled to the end: on the pre-change page (commit 16cc9de) a tap at (5,700) hits #modal and closes the popup; on the merged page the same tap hits #m-box and the popup stays open. Screenshot /tmp/t205lt/mobile.png shows the scrolled sheet with no close affordance on screen.

Desktop behavior stays unchanged.

# Notes

# Open questions
How should the mobile full-screen popup be closable while the content is scrolled: a sticky Close header, a floating close button, tap-to-close on the sheet, or is scroll-back-to-top acceptable?
