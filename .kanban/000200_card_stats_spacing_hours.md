---
name: "fix: task card stats spacing and h m s duration labels"
priority: "medium"
state: "doing"
worktree: "fix/200-card-stats-spacing-hours"
issuer: "user"
complexity: "simple"
shortName: "card-stats-spacing-hours"
---

# Summary
Two webui polish items: raise the vertical space between the task cards' chips row and the token+time stats line (agent cards are good as they are), and format durations of an hour and more as h m s instead of unbounded minutes.

# Specs
Reported by the user (2026-10-13):
1. More vertical space between the tag chips of the task summary (preview) cards and the stats line with token usage + time. The agent cards' spacing is good.
2. Duration labels show h m s when the duration is more than 59 minutes. Currently minutes grow unbounded: 3661s renders "61m 1s".

Facts (verified in code):
- src/webui/page.ts:158: .card-stats { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; } — the only chips-to-stats spacing on task cards; the chips add 1px vertical padding, so the gap reads tight.
- src/webui/page.ts:179: .agent-stats { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; } — same 2px, but it sits under plain label text (page.ts:571-574), not a padded chip row. Leave it as is.
- src/webui/board.ts:34-39: fmtDur is shared by the task cards (taskStatsText :63-67 via cardHtml :165-167) and the agent cards (agentStatsText :44-46): under 60s -> "Ns"; under 3600s -> "Nm" (zero seconds dropped) or "Nm Ss"; 3600s and up currently renders "61m 1s" / "120m" — no hours tier.
- tests/webui.test.ts: :467 pins '<span class="card-stats">2k · 4s</span>'; :468-469 usage-less runs show no card-stats; :470 asserts .card-stats presence only, no margin value; :1416-1419 pin fmtDur(3479)==="3s", fmtDur(60000)==="1m", fmtDur(86592)==="1m 27s", fmtDur(null)==="" — all stay passing; :1420 ships String(fmtDur)/String(fmtTokens); :459 pins the spaces between chips.
- syncBoard's syncCardStats (board.ts:282, :324-331) updates the .card-stats span in place, so an fmtDur change live-updates existing cards.

Changes:
- Spacing: raise .card-stats margin-top from 2px to 6px (a small clearly visible step; "a bit more" per the user). Scope to task cards only: do not touch .agent-stats.
- Duration: add an hours tier to fmtDur at 3600s and up, dropping trailing zero units in the same style as the minutes tier: 7200s -> "2h", 3660s -> "1h 1m", 3661s -> "1h 1m 1s", 7261s -> "2h 1m 1s". Durations below 3600s keep the current format ("59m 30s" stays).
- The hours tier applies wherever fmtDur renders (task cards and agent cards share the function): the same both-places rule as #182.
- The usage-less rule (#183) and the chip spacing (#176) are untouched.

Acceptance:
- node tests/webui.test.ts passes; add fmtDur cases for the hours tier (for example 3600000 -> "1h", 3661000 -> "1h 1m 1s", 7200000 -> "2h") to the fmtDur test block (:1416-1419).
- Browser check: a task card's stats line sits clearly below the chips row; a task whose duration exceeds an hour shows "Xh Ym Zs" on both the task card and its agent cards.

# Notes
