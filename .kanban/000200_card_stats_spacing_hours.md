---
name: "fix: task card stats spacing and h m s duration labels"
priority: "medium"
state: "done"
worktree: ""
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

- 2026-10-13, reviewer: Approved. Verified the diff against the Specs: .card-stats margin-top 2px -> 6px with .agent-stats untouched (page.ts:158, :179); fmtDur hours tier at 3600s+ with trailing zero units dropped (board.ts:38-41), all Spec examples (3599000/3600000/3660000/3661000/7261000 ms) render exactly as specified, below an hour keeps "59m 59s". The css lives only in page.ts, so the served PAGE interpolates the change; syncCardStats updates the span in place on live cards. node tests/webui.test.ts passes. No other duration formatter exists in src/, the both-places rule holds. The unsigned commit matches the developer's recorded sandbox note. No open questions.

- 2026-10-13, developer: Done. .card-stats margin-top 2px -> 6px (src/webui/page.ts:158); .agent-stats untouched. fmtDur gained the hours tier: below 3600s keeps the minutes format, 3600s and up renders h/m/s with zero units dropped (src/webui/board.ts, shared by task and agent cards via agentStatsText/taskStatsText). Tests: 8 new fmtDur hour-boundary asserts (3599000 -> "59m 59s", 3600000 -> "1h", 3660000 -> "1h 1m", 3661000 -> "1h 1m 1s", 7261000 -> "2h 1m 1s") and the .card-stats css pin now expects margin-top: 6px plus an .agent-stats 2px pin. node tests/webui.test.ts and npm test pass. Committed 7553736 in the worktree (unsigned: gpg-agent cannot run in the sandbox, read-only HOME; previous worktree commits were signed). No open questions.

- 2026-10-13, live-tester: Passed. 29/29 checks. Hub-only fixture on two ports: the merged commit (4631) against the pre-change page from c098a2f (4632, `git archive` into a second dir plus a second isolated HOME). Task-card chip-to-stats gap: 6px on merged and 2px on old, and the measured gap follows a css margin change by exactly 4px. `.agent-stats` stays 2px in both. Durations on the task card and on the agent card in the modal are identical: 3661000 ms -> "1h 1m 1s", 3600000 -> "1h", 7200000 -> "2h", 7261000 -> "2h 1m 1s", 3599000 -> "59m 59s", 60000 -> "1m" (the old page renders "61m 1s", "60m", "120m", "121m 1s", "59m 59s", "1m"). A live doing card with a run above one hour shows "1h 2m 31s" and the in-place stats update ticks it to "1h 2m 36s" on the next board poll. No console or page errors on either page. No issues found. Assumption: the fixture sets run durations through the first and last log record timestamps, so no wall-clock timing is involved.
