---
name: "fix: selected agent cards too transparent in task details"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "selected-card-mix"
blockedBy: ""
---

# Summary
The selected agent card in the task details modal is too transparent in both themes. Replace the 15%-alpha accent tint with a computed 20% accent + 80% panel mix (CSS color-mix), for the base accent pair and the doctor/splitter blue pair. Borders keep their colors.

# Specs
Problem: in the task details modal (#m-agent), the selected agent card is too transparent in both themes. page.ts:191: `.agent-card-active { border-color: var(--link); background: var(--medium-bg); }` — --medium-bg is a 15%-alpha accent tint (dark rgba(255,209,115,.15), light rgba(201,151,0,.15), page.ts:81-92 and 109).

Decided (user interview 2026-10-17):
- 20% accent + 80% panel mix, same ratio in both modes, applied with the file's established color-mix() pattern (page.ts:151-152, 187, 250).
- Mix base is --panel (the modal/card surface), not --bg.
- Scope: every card that shares the selected style, including the doctor and splitter pair.
- Borders keep their current colors.
- Priority medium.

Requirements:
1. page.ts:191: background: var(--medium-bg) → background: color-mix(in srgb, var(--link) 20%, var(--panel)). border-color stays var(--link).
2. page.ts:206 (.agent-doctor.agent-card-active) and page.ts:210 (.agent-splitter.agent-card-active): background: var(--doctor-bg-strong) → background: color-mix(in srgb, var(--doctor-fg) 20%, var(--panel)). border-color overrides stay.
3. Leave the now-unused --medium-bg and --doctor-bg-strong variables defined (smallest diff; other consumers, if any, keep working).
4. Update the exact-string test asserts in tests/webui/page.test.ts: :282 (the base rule string) and :274, :277 (the doctor/splitter rule strings) to the new expected CSS. The old tests/webui.test.ts copies (:1026, :1029, :1034) are deleted by #256 — do not touch that file.
5. Hover keeps its own look (page.ts:188, --hover) and the rest state keeps its mix (page.ts:187). No other rule changes. The prefers-color-scheme dark block (page.ts:88) reuses DARK_VARS, so the color-mix works in both modes with no extra rules.

Acceptance:
- node tests/webui/page.test.ts passes with the updated asserts.
- pnpm test passes end to end.

# Notes
- 0fe10f9: updated the three active-card rules in src/webui/page.ts to the color-mix() form (base pair from --link, doctor/splitter pair from --doctor-fg, both 20% over --panel); borders and the rest/hover rules unchanged; --medium-bg, --doctor-bg-strong and their theme definitions stay.
- Tests first: updated the three exact-string asserts in tests/webui/page.test.ts (doctor, splitter, base active rule). The scoped suite failed on the first new pin before the source edit, then passed: 270 asserts, exit 0.
- Sweep: one grep for --medium-bg/--doctor-bg-strong across src and tests found no consumers outside page.ts and page.test.ts; one grep for agent-card-active pinned it only in tests/webui/page.test.ts. tests/webui.test.ts is deleted and was not touched.
- Deviation: ran the scoped suite only, not full pnpm test, per the project test policy; `node tests/webui/page.test.ts` is the whole check for this diff.
- Re-review at 0fe10f9: all three active-card rules match the decided color-mix() form (base pair from --link, doctor/splitter pair from --doctor-fg, 20% over --panel), borders kept; hover/rest rules untouched (page.ts diff = 3 lines). Leftover vars stay defined with live consumers (.p-medium, .chip.cx-moderate); the pin sweep confirms agent-card-active only in tests/webui/page.test.ts. Green scoped run recorded at this commit stands, no re-runs. No fixes.

## Live test (2026-10-17)

- Scope: merged page 0fe10f9, hub-only, one done fixture task with a developer run, a splitter run and a past developer doctor log; headless Chromium on port 4350. 50 checks, 0 failed.
- Served page: all three active rules carry the exact color-mix text (base from `--link`, doctor/splitter from `--doctor-fg`, 20% over `--panel`); no active rule uses `--medium-bg` or `--doctor-bg-strong`; borders keep `--link`/`--doctor-fg`.
- Vars kept: `--medium-bg` and `--doctor-bg-strong` have 3 definitions each (light, data-theme dark, media dark), and `.p-medium`/`.chip.cx-moderate` still consume `--medium-bg`. Rest rule and `.agent-card:hover { background: var(--hover) }` unchanged.
- Measured after each card click (pointer moved off the card): light base `rgb(252, 234, 209)`, splitter and doctor `rgb(213, 226, 248)`; dark (theme button and prefers-color-scheme dark) base `rgb(62, 55, 42)`, splitter and doctor `rgb(34, 53, 77)`. Every value equals 20% accent over `--panel`, opaque (the old 15%-alpha tint is gone), and exactly one card is active after each switch.
- Rest and hover keep the old look: rest splitter `color(srgb 1 1 1 / 0.85)` (85% panel mix), hovered base `rgba(233, 237, 242, 0.95)` (`--hover`) in light theme.
- Assumption: fixture is a done task; the modal's agent/doctor data comes from `/api/task-history?num=265` (`/api/task-detail` has no agent history). No contradiction with the task's stated assumptions found.
- Harness note: Chromium returns computed color-mix backgrounds as `color(srgb r g b / a)`; the first probe parsed only `rgb()` and reported 15 harness false FAILs. Parser fixed, rerun once: 50 checks, 0 failed.
