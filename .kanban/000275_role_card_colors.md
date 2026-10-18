---
name: "fix: popup agent cards take their board-column accent colors per role"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "role-card-colors"
---

# Summary
In the task details popup all agent and subagent cards share one color and the splitter/doctor cards another. Make the developer, reviewer, merger and live-tester agent/subagent cards use the same accent colors as their corresponding board columns; the splitter card takes the backlog accent and the doctor card the done accent.

# Specs
Goal: per-role accent colors on the task details popup's agent and subagent cards, taken from the main ui board's column palette; splitter and doctor move to the backlog and done column colors.

Facts (verified 2026-10-17 by a read-only fact-finder; all references src/webui/page.ts unless noted):
- All run/agent/sub cards share one class .agent-card (L187): color: var(--link) (gold #e6b450 dark L85 / orange #f29718 light L109), border 1px solid var(--border), background color-mix(in srgb, var(--panel) 85%, transparent). Hover L188: .agent-card:hover { background: var(--hover); }. .agent-dead (L192) is status, not role. Sub cards get only the marker class agent-sub (L929), which has no CSS rule.
- Splitter/doctor cards use --doctor-fg (blue #59a7ff dark L86+L91 / #2f6fdd light L114): .agent-doctor and .agent-splitter rules at L205-211 (text color, active override, .check). --doctor-bg-strong is defined but never consumed.
- Board column accents (L301-310): static hex, identical in both themes, consumed as a 3px border (.col L145, .card L151): .c-backlog { --ac: #94a3b8; } .c-to-do { --ac: #60a5fa; } .c-doing { --ac: #818cf8; } .c-to-review { --ac: #f59e0b; } .c-reviewing { --ac: #d97706; } .c-to-merge { --ac: #d946ef; } .c-merging { --ac: #c026d3; } .c-to-live-test { --ac: #14b8a6; } .c-live-testing { --ac: #0d9488; } .c-done { --ac: #22c55e; }
- Role-to-class decision: renderAgent (L814) L839: agentCardHtml((a.role === "splitter" ? "agent-splitter " : "") + (a.alive ? "agent-live" : a.status === "dead" ? "agent-dead" : "agent-past"), ...) - only splitter gets a role class. renderDoctor (L877) L894 hardcodes "agent-doctor " + alive/past. fetchSubs (L910) L929 passes "agent-sub". agentCardHtml(extraCls, ...) (L803-806) is the single card builder and the attach point.
- Selection: markActiveAgent (L699) toggles .agent-card-active on every #m-agent .agent-card (L703-705). L191: .agent-card-active { border-color: var(--link); background: color-mix(in srgb, var(--link) 20%, var(--panel)); } - selection overrides background and border-color for any card without a higher-specificity override. The established per-role pattern: .agent-doctor.agent-card-active (L206) / .agent-splitter.agent-card-active (L210) with specificity 0,2,0.

Change:
1. Agent cards: attach a per-role class at renderAgent L839 for developer, reviewer, merger and live-tester (alongside the existing splitter branch; names e.g. agent-developer, agent-reviewer, agent-merger, agent-livetest - pick and stay consistent).
2. CSS: per-role text color from the board column palette, same static hex the columns use (theme-independent, no new theme vars, no mirroring): developer -> #818cf8 (doing), reviewer -> #d97706 (reviewing), merger -> #c026d3 (merging), live-tester -> #0d9488 (live-testing). At rest only the text and the .check mark take the role color; the shared .agent-card semi-transparent panel background and border stay (the established 000232 pattern: "at rest only the text and check mark stay blue and the plain .agent-card outline and panel background show through").
3. Subagent cards: the sub cards follow their parent run's role color - pass the run's role class at fetchSubs L929 (the parent run's role is known at the call site).
4. Splitter/doctor: the splitter card takes the backlog accent #94a3b8, the doctor card the done accent #22c55e (user decision). Their .check and active rules follow the role color. Replace the --doctor-fg blues in these rules; keep --doctor-fg defined (other code may reference it) or migrate its uses consistently - do not leave the cards on blue.
5. Selected cards: add per-role .agent-<role>.agent-card-active variants following the established pattern: border-color the role color, background color-mix(in srgb, <role color> 20%, var(--panel)); the same 20% ratio in light and dark mode (the #265 selected-card-mix decision). Covers all six role classes.
6. Hover: unchanged - shared .agent-card:hover stays; add NO per-role hover rule (tests/webui/page.test.ts:321 pins !page.includes(".agent-doctor:hover") - keep that property for all roles).

Tests (tests/webui/page.test.ts):
- Update the pins that change: the role-to-class decision at :283 (four more role classes), the doctor/splitter rules :318-326 (new backlog/done accent hexes and rules), :329 (.agent-card keeps color: var(--link) as the fallback for cards without a role class - keep the base rule as-is), :330 (the .agent-card-active base rule may stay var(--link) as fallback).
- New asserts: the four per-role rest rules use the exact column hexes; the per-role .agent-card-active variants use color-mix(... 20%, var(--panel)); the sub cards carry their run's role class; no per-role :hover rule exists.
- tests/webui/board.test.ts column accents (L100-106) are reads of class names, not values - must stay untouched.
- Follow the file's existing scenario style (string pins on the extracted page source).

Acceptance: node tests/webui/page.test.ts passes and pnpm test passes.

Out of scope: the board page's column palette itself, the selected-card base rule beyond adding variants, and the popup height work of #274.

# Notes
