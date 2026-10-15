---
name: "feat: blue doctor agent cards in the web UI"
priority: "medium"
state: "done"
worktree: ""
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

Implemented in 2b331fb in the worktree feat/226-blue-doctor-cards:

- src/webui/page.ts: `--doctor-fg` / `--doctor-bg` / `--doctor-bg-strong` in all three theme blocks (light #2f6fdd on rgba(47, 111, 221, .12), dark #59a7ff on rgba(89, 167, 255, .15), strong tints .24 and .28), plus three rules after `#m-doctor:empty`: `#m-doctor .agent-card` takes the blue text, border and highlight, `#m-doctor .agent-card:hover` and `#m-doctor .agent-card-active` take the strong tint, and active keeps the blue border. Markup untouched; the scoped rules cover agent-live and agent-past alike.
- tests/webui.test.ts: a 000226 block checks the three theme blocks define the vars, the two blue literals, the three scoped rules, that renderDoctor still emits agent-live/agent-past, and that the unscoped .agent-card, :hover and .agent-card-active rules keep their colors. The fail-first run failed on "the light theme block defines --doctor-fg:"; after the change `node tests/webui.test.ts` prints "all assertions passed".
- Live check (temp root, isolated HOME, port 4321, Playwright, one fresh context per color scheme): the doctor card's computed styles are rgb(47, 111, 221) text and border on rgba(47, 111, 221, .12) in light and rgb(89, 167, 255) on rgba(89, 167, 255, .15) in dark; hover gives .24 light and .28 dark; the clicked doctor card carries .agent-card-active with the blue border and the strong tint. The run buttons and the sub cards kept rgb(242, 151, 24) light and rgb(230, 180, 80) dark, with their border and background unchanged.
- Choice: three variables per block, not two. The strong tint as its own literal keeps the explicit-rgba palette style and makes the hover/active recipe greppable.
- Reviewed (worktree feat/226-blue-doctor-cards): diff verified against all four requirements (blue vars in all three theme blocks, #m-doctor-scoped text/border/background/hover/active rules that cover agent-live and agent-past alike, unscoped .agent-card rules untouched, renderDoctor markup unchanged) and `node tests/webui.test.ts` passes (exit 0, "all assertions passed"); the recorded Playwright numbers match the diff's literals exactly. The .check keeps its own green rule and the .spin uses --border/--fg, so neither glyph picks up the blue. No fixes.
- The four assumptions the developer parked under Open questions are each answered by the Specs (requirement 1 delegates the blue pair to developer's judgment, requirement 2 states the at-rest highlight and the hover/active variants and enumerates only text/border/background/hover/active, the Current state section names the run buttons and .agent-subs), so they were settled, not user questions; removed from the section.

## Live test (merged 753477e, real hub on a temp root + Playwright, 26/26 checks passed, no findings)
- Fixture: a done probe task with a past doctor log, a live doctor log (live sleep pid in `.pids/000226_probe.reviewer.0.analysis.pid`), one developer run log and a named `/tmp/pi-subagents-1000/*.output` sub transcript, so both doctor variants and the run/sub comparison cards rendered. Hubs served the merged page (4321) and the pre-change page from `git archive 43cdb72` (4322) over the same fixture.
- Light (both `colorScheme: light` and explicit `data-theme="light"` over a dark media query): past and live doctor cards read text and border rgb(47, 111, 221) on highlight rgba(47, 111, 221, 0.12); hover and `.agent-card-active` give rgba(47, 111, 221, 0.24) with the blue border and the active class on the clicked card. The doctor log pane opened with its report on click.
- Dark (both the `prefers-color-scheme` fallback and the real `#theme` toggle path): doctor text and border rgb(89, 167, 255) on rgba(89, 167, 255, 0.15); hover and active rgba(89, 167, 255, 0.28). Toggling back in a dark context gave the light literals, so explicit choice beats the media query.
- Requirement 3, both themes: the run buttons in `#m-agent-btns` and the subagent cards in `.agent-subs` kept rgb(242, 151, 24) on rgb(255, 255, 255) (light) and rgb(230, 180, 80) on rgb(20, 24, 33) (dark) with their border; the run button's own active state stayed gold on rgba(201, 151, 0, 0.15). Those values are identical between the merged and the pre-change page.
- Differential: on the pre-change page the same doctor card is gold rgb(242, 151, 24) on rgb(255, 255, 255), and `--doctor-fg` is absent from its served CSS, so the blue is new and doctor-only.
- Served artifact: `--doctor-fg` appears 3 times (1 light `#2f6fdd`, 2 dark `#59a7ff`), the three `#m-doctor` rules appear once each, and the unscoped `.agent-card`, `.agent-card:hover` and `.agent-card-active` lines are byte-identical to the pre-change page (`diff` empty).
- Scope sanity: the past doctor card's `.check` stayed green rgb(134, 179, 0) and the live card's `.spin` uses `--border`/`--fg`, so no inner glyph picked up the blue.
- Two test harness notes, no product impact: `#theme` is behind the open modal overlay, so a user closes the modal first (my script did); and a hovered `.agent-card-active` run button reads `--hover` because `.agent-card:hover` has higher specificity, so the pointer must move away before sampling the active background.

# Open questions

None.
