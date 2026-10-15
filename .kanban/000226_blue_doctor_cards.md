---
name: "feat: blue doctor agent cards in the web UI"
priority: "medium"
state: "doing"
worktree: "feat/226-blue-doctor-cards"
issuer: "user"
complexity: "simple"
shortName: "blue-doctor-cards"
---

# Summary
Style the web UI's Doctor agent cards in blue (text, outline, highlight) via #m-doctor-scoped CSS and new theme-aware blue variables; all other agent cards keep their current colors.

# Specs
# Goal
In the web UI, the Doctor agent cards render in blue: text, outline and highlight. Every other agent card keeps its current color.

# Current state (verified 2026-10-15)
- Doctor cards are built by renderDoctor (src/webui/page.ts:650) as .agent-card buttons inside #m-doctor (page.ts:188), with extraCls agent-live or agent-past. They share the .agent-card base style (page.ts:177) with the run buttons (#m-agent-btns) and the subagent cards (.agent-subs): color var(--link), border 1px var(--border), background var(--panel); hover var(--hover) (page.ts:178); the active state .agent-card-active (page.ts:181, border-color var(--link), background var(--medium-bg)) is toggled by markActiveAgent (page.ts:553) on every #m-agent .agent-card, doctor cards included.
- Colors are theme-aware CSS variables defined in three blocks: :root[data-theme="dark"] (page.ts:82-84), the prefers-color-scheme dark fallback (page.ts:86-87), and the light :root (page.ts:105-106). No blue exists today (the priority pairs are green/amber/orange/red).
- renderDoctor is the only doctor-card renderer (page.ts:738's liveDoctor is poll logic only); doctor cards appear nowhere else.

# Requirements
1. New theme-aware blue variables (e.g. --doctor-fg and --doctor-bg), defined in all three theme blocks. Pick a blue consistent with the palette's desaturated tone (e.g. #59a7ff on dark, #2f6fdd on light — developer's judgment).
2. Container-scoped rules under #m-doctor: .agent-card gets blue text color, blue border (outline) and the blue highlight background; hover and the .agent-card-active state under #m-doctor get the blue variants too. The rules cover the agent-live and agent-past variants.
3. Only doctor cards change: the run buttons in #m-agent-btns and the subagent cards in .agent-subs keep today's colors. No un-scoped .agent-card rule changes.
4. Markup unchanged: renderDoctor keeps building .agent-card buttons; the blue comes from the #m-doctor CSS scope.

# Acceptance
- A task-specific grep check passes: #m-doctor-scoped blue rules exist in src/webui/page.ts covering text, border, background, hover and active states, and no un-scoped .agent-card rule changed color.
- In the live UI the Doctor cards render blue in both the dark and light themes, and the run buttons and subagent cards keep their colors.

# Notes
