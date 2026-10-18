---
name: "fix: smaller font size for subagent, splitter and doctor cards"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "small-card-fonts"
blockedBy: ""
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
- Shrank the subagent, splitter and doctor popup cards to 85%: `.agent-sub, .agent-splitter, .agent-doctor { font-size: 0.75rem; }` for the name line (inherited by the button label) and `.agent-sub .agent-stats, .agent-splitter .agent-stats, .agent-doctor .agent-stats { font-size: 0.625rem; }` for the stats line (0,2,0 specificity, beats the base .agent-stats 0,1,0). The four role agent cards and the base .agent-card (0.875rem) / .agent-stats (0.75rem) rules are unchanged.
- Deviation from the Specs: the three classes share one combined rule for the name line instead of a new .agent-sub rule plus font-size added inside the existing .agent-splitter/.agent-doctor rules. #275's exact-string pins (`.agent-splitter { color: #94a3b8; }`, `.agent-doctor { color: #22c55e; }`) would break. The rendered sizes are the same.
- Tests: tests/webui/page.test.ts gained three pins (both new rules and the unchanged base sizes) and the font-size census now expects 0.625 x1, 0.75 x5. Red before the source edit (census assert), green after.
- Scoped runs green: tests/webui/page.test.ts, tests/webui/board.test.ts, tests/webui/logpane.test.ts, tests/webui/agentlog.test.ts, tests/webui/hub.test.ts. Committed as d7f09ce.

- Re-review at d7f09ce (HEAD, no later commits): the diff meets the Specs. Name line: the combined `.agent-sub, .agent-splitter, .agent-doctor { font-size: 0.75rem; }` rule (page.ts:218) is inherited by the button label. Stats: `.agent-sub .agent-stats, .agent-splitter .agent-stats, .agent-doctor .agent-stats { font-size: 0.625rem; }` (page.ts:219), 0,2,0 specificity beats the base 0,1,0. Base `.agent-card` (0.875rem) and `.agent-stats` (0.75rem) rules unchanged, pinned by the new assert (page.test.ts:331). Out of scope untouched: the diff touches only page.ts CSS and page.test.ts.
- Tests: three new string pins (page.test.ts:329-331) plus the census now {"0.625": 1, "0.75": 5} (page.test.ts:155, +2 from the diff). Scoped runs green in Notes at d7f09ce, zero later commits, zero re-runs. #275's role-color pins are untouched and its commit (ec03af9) is already in main, so the task ran on the post-#275 layout as required.
- Open question kept: combined name-size rule vs the spec's per-class sketch is a user call (the alternative loosens #275's landed pins).

## Live test (2026-10-18)
- Hub-only fixture at /tmp/lt276: task `000276_fixture` (to-review) with five run logs (splitter, developer, reviewer, live-tester, merger), one developer doctor log, and one subagent transcript named by a `tool_execution_end` result (/tmp/pi-subagents-1000/sub276.output). Served by `startHub` from the worktree on port 4350 with an isolated HOME.
- Preflight: /api/task-history?num=276 returns the 5 runs plus the doctor; /api/agent-log?file=...developer.0&sub=list returns the 1 sub. The served page carries both new rules and the unchanged base `.agent-card` (0.875rem) and `.agent-stats` (0.75rem) rules.
- Playwright at 1280x900 (1rem = 16px), computed styles in the open popup: splitter, subagent and doctor cards 12px name / 10px stats; developer, reviewer, merger and live-tester cards 14px name / 12px stats. The ratios 12/14 and 10/12 match the 85% rounded sizes. 24 checks, 0 failed (/tmp/lt276/probe.log).
- Assumptions: a 1280px desktop viewport (the 600px breakpoint scales the root, not tested); a finished task, so no poll refresh ran between the open and the sample; the name line read from the card button's computed font-size because the label is a bare text node.
- The Notes' recorded deviation (one combined name-size rule instead of the Specs' per-class sketch) produces the specified rendered sizes. No contradiction of the task's stated assumptions observed.
- The acceptance's `node tests/webui/page.test.ts` and `pnpm test` were not run: the live test does not run the unit suites. The served CSS and the rendered card sizes cover the Specs behavior.

# Open questions
- Confirm the combined name-size rule instead of the per-class edits sketched in the Specs (forced by #275's exact-string color pins), or loosen those pins and split the rule.
