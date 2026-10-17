---
name: "fix: selected agent cards too transparent in task details"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "selected-card-mix"
blockedBy: "#256"
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
