---
name: "fix: unnumbered Doctor card labels in the web UI"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "plain-doctor-labels"
---

# Summary
Doctor agent cards in the web UI are never numbered: the label is always "Doctor", even when the Doctor row holds several cards. The run numbering for every other role stays as today.

# Specs
# Goal
Doctor agent cards in the web UI label just "Doctor", never "Doctor 1", regardless of how many doctor cards the row holds.

# Current state (verified 2026-10-15)
- agentLabel (src/webui/board.ts:21) appends " " + (run + 1) when count[role] > 1 and run != null.
- The Doctor row (renderDoctor, src/webui/page.ts:662) counts its cards per role. With two analysed runs (e.g. #224's developer.0 and reviewer.0) count.doctor = 2, and both entries carry run 0 — the ANALYSED run's index, not a doctor sequence — so both cards label "Doctor 1". The number means nothing for doctors.
- The agent-runs row (page.ts:620) shares agentLabel; its numbering (Developer 1, Developer 2) is correct and must stay.
- tests/webui.test.ts:1522-1526 asserts the numbering for multi-run roles and the solo unnumbered label; page.ts:337 embeds agentLabel into the page script, so a board.ts fix propagates into the served page automatically.

# Requirements
1. agentLabel never numbers doctor entries: a doctor card labels "Doctor" regardless of how many doctor cards the row holds or what run index the entry carries. The numbering for every other role stays exactly as today.
2. The rule lives in the shared helper (agentLabel in src/webui/board.ts), not in the doctor renderer — one line.
3. Extend the scoped tests: an assertion that a doctor entry labels "Doctor" even with several doctor cards (e.g. two doctor entries with run 0), and the existing numbering assertions unchanged.

# Acceptance
- A doctor card labels "Doctor" even when the Doctor row holds several cards; the numbering for every other role is unchanged.
- In the live UI the Doctor cards label "Doctor".

# Notes
