---
name: "fix: log pane text at card text size; log height 70vh"
priority: "medium"
state: "done"
worktree: ""
blockedBy: ""
issuer: "user"
complexity: "simple"
shortName: "log-text-size-log-height"
---

# Summary
The agent log text renders too small next to the rest of the task card, and the log pane is too short. Make the log text the same size as the card's other text and grow the log pane height to 70vh.

# Specs
Changes (src/webui.ts + src/webui.test.ts only):
- The log pane text (#m-log-text and its pre/code children) renders at a smaller size than the card's body text today; drop the smaller font-size so the log text matches the card text size exactly (line-height may stay tuned for logs, only the size must match).
- The log pane height (#m-log or its scroll container, currently capped well below the viewport) grows to 70vh so long logs show more content.
- Keep markdown rendering, the Inter/monospace font rules from #147, the #122/#140 collapsed-block rules, the model meta line from #146, chunk walk-back, offsets, dedupe and live streaming untouched.
- Update any src/webui.test.ts assertions that pin the old font-size or height values.

Tests: the webui suite stays green (run it as the check); assert the new height value and the absence of a smaller log font-size where the existing CSS regexes are.

# Notes
- src/webui.ts: #m-log-text font-size 10px to 13px, the card body size (#m-body), line-height stays 1.45; pre/code children follow through the existing font: inherit and monospace rules. #m-log max-height 300px to 70vh. Meta line (#m-log-meta) untouched.
- src/webui.test.ts: replaced the 10px pin with an assertion for font-size: 13px and no smaller size in the #m-log-text rule; added an assertion for max-height: 70vh in the #m-log rule. webui suite, index and extension suites green (commit 72fec7f).
- Review: verified #m-body renders 13px so the log text now matches the card body size exactly; line-height 1.45 kept as the spec allows. The #147 monospace rule comes after font: inherit, so pre/code children inherit the 13px size and only the family flips to monospace. The #m-log test regex requires a literal space, so it cannot match #m-log-meta or #m-log-text. Diff touches only the two rules plus comments; meta line, collapsed blocks, chunk walk-back, offsets, dedupe and streaming untouched. Re-ran webui, extension and index suites: green. No fixes; assumptions were documented, none silent.
- Live test (worktree daemon + headless Chromium/Playwright, scratch board with copies of real task files and the real 3.4 MB developer log, hub on 127.0.0.1:4399): opened the task 152 card, opened the developer log pane, 17/17 checks passed. Computed #m-log-text 13px equals #m-body 13px and .card .name 13px. pre children 13px and ui-monospace. #m-log computed max-height 630px at a 900px viewport (70vh) and 420px at a 600px viewport, rendered pane 630/628 and 420/418. The long log scrolls (scrollHeight 672 > clientHeight 628). #m-log-meta stays 10px. A gzipped shorter log on task 151 shrank to 542px, below the 630px cap, so the pane is a cap and not a fixed height. No console errors. No user-visible issue found.
- Live-test assumptions: a scratch board was used because the worktree board must not be driven by a live daemon, so live streaming, offsets, chunk walk-back and dedupe were not exercised (the developer/reviewer suites cover those). "Card text size" was verified against #m-body and .card .name. "70vh" was verified in the computed style and in the rendered height at two viewport heights. No observed behavior contradicts the task assumptions. Note: with the pane at 70vh and the modal capped at 82vh (#m-box, overflow auto), an open log makes the modal scroll to reach the body below the pane. This follows from the requested 70vh and is not a defect.
- Merge: base branch was main at both steps. Step 1 (worktree): merge main into fix/152-log-text-size-log-height was already up to date, clean, no conflicts, no test suites run. Step 2 (root): merge fix/152-log-text-size-log-height into main fast-forwarded c22ec3e..72fec7f (src/webui.ts, src/webui.test.ts), clean, no conflicts, no test suites run.

# Open questions
None. Assumptions made:
- "the card text size" means the 13px the modal body (#m-body) renders at; dropping the 10px size outright would inherit the UA 16px and overshoot, so 13px is set explicitly.
- "grows to 70vh" is a max-height cap (max-height: 70vh), so short logs keep shrinking to fit and only long logs reach 70vh.
- The 10px meta line (#m-log-meta) stays at 10px, since the spec keeps the #146 model meta line untouched.
