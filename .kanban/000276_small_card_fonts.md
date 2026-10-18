---
name: "fix: smaller font size for subagent, splitter and doctor cards"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "small-card-fonts"
blockedBy: "#275"
---

# Summary
Use a smaller font size (85%, rounded) for the subagent, splitter and doctor cards in the task details popup, covering both the name and the stats lines. The developer/reviewer/merger/live-tester agent cards keep their current sizes. Blocked by #275, which rewrites the same card rules and test pins.

# Specs
Goal: shrink the text on the task details popup's subagent, splitter and doctor cards to 85% of the current sizes, rounded; the four role agent cards stay as they are.

Facts (verified 2026-10-17):
- agentCardHtml (src/webui/page.ts:803-806) builds every card: <button class="agent-card ..."> + mark + label text node + optional <span class="agent-stats">. The label (the card name, e.g. "developer run 1" or "Sub-<role>") inherits the button's font-size; the stats span has its own class.
- .agent-card (page.ts:187): font-size: 0.875rem - so the name line is 0.875rem on every card today.
- .agent-stats (page.ts:193): font-size: 0.75rem - the stats line is 0.75rem on every card today.
- Sub cards carry the marker class agent-sub (page.ts:929, label "Sub-<role>"); splitter and doctor cards carry agent-splitter / agent-doctor (page.ts:839, :894).
- #275 (doing) rewrites the .agent-splitter/.agent-doctor rules (role colors) and the page.test.ts pins around them (:283, :318-326, :329-330). This task must run on the post-#275 layout (hence blockedBy #275).

Sizes (85% rounded, the code's 1/16-rem convention):
- Name line: 0.875rem x 0.85 = 0.74375 -> 0.75rem.
- Stats line: 0.75rem x 0.85 = 0.6375 -> 0.625rem.

Change:
- Give the subagent, splitter and doctor cards font-size: 0.75rem on their card classes (.agent-sub gets a new rule; .agent-splitter and .agent-doctor gain font-size in their existing rules - on the post-#275 layout), so the name line inherits the smaller size.
- Shrink the stats within those cards: a combined rule (.agent-sub .agent-stats, .agent-splitter .agent-stats, .agent-doctor .agent-stats { font-size: 0.625rem; }) or the equivalent - specificity must beat the base .agent-stats rule.
- Keep the base .agent-card (page.ts:187) and .agent-stats (page.ts:193) rules unchanged: the developer/reviewer/merger/live-tester cards keep 0.875rem names and 0.75rem stats.
- Out of scope: the log pane, the modal body, the board cards, and everything outside the three card classes.

Tests (tests/webui/page.test.ts):
- New asserts pinning the three card classes' font-size: 0.75rem and the 0.625rem stats override within them, and that the base .agent-card/:145-146 and .agent-stats rules are unchanged.
- Keep #275's updated pins green (role colors, the role-to-class decision).
- Follow the file's existing scenario style (string pins on the extracted page source).

Acceptance: node tests/webui/page.test.ts passes and pnpm test passes.

# Notes
