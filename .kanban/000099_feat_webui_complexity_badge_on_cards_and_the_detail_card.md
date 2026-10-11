---
name: "feat: webui complexity badge on cards and the detail card"
priority: "medium"
state: "done"
worktree: ""
---

# Summary
Show the task complexity attribute (simple/moderate/complex) as a small badge next to priority on board cards and in the detail card; /api/tasks includes complexity.

# Specs
Companion to task #98 (backend: complexity attribute + per-complexity LLM config). The user asked for the badge in the webui.

Facts: taskPayload serving /api/tasks (src/webui.ts) whitelists file/name/priority/state/worktree/updated/body/agents/agent and must explicitly include complexity once #98 adds it to the Task; openTask modal #m-attrs rows render esc()'d values; board cards render priority badges already; webui.test.ts STATE_NAMES/column-heading loop and payload asserts at :63-70.

Changes:
1. /api/tasks payload includes complexity (from #98's Task field).
2. Board cards and the detail card show the complexity as a small badge next to the priority badge, styled quiet in both themes, esc()'d; absent complexity renders as "moderate" (the default).
3. Extend src/webui.test.ts (payload field assert).

Acceptance: cards and detail card show the badge in both themes; suite green: node src/webui.test.ts.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind #98 (the Task field must land first) and behind #96 (doing on fix/96-content-driven-column, src/webui.ts) and #72 (reviewing, src/webui.ts + webui.test.ts pending merge).

# Notes
- HOLD lifted: #98 (complexity Task field), #96 and #72 all done and merged before starting; worktree had #98's complexity in src/kanban.ts.
- src/webui.ts: taskPayload whitelists `complexity: t.complexity` (hub.ts reuses taskPayload and PAGE, so the hub serves both unchanged); cardHtml emits `<span class="chip cx">` after the priority chip with `esc(t.complexity || "moderate")`; the detail card's priority attrs row gains the same chip; one CSS rule `.chip.cx { background: var(--code-bg); color: var(--muted); }`, quiet in both themes (theme-driven vars).
- src/webui.test.ts: payload asserts for complexity on the default and the #42-issued task; card asserts for badge placement next to priority, escaping, and the absent-complexity moderate default; page asserts for the CSS class and the detail-card source line.
- `node src/webui.test.ts` green; committed ae3a9ed in the worktree.
- Review (no fixes): verified #98's `complexity` field is on the Task type in src/kanban.ts and validated against COMPLEXITIES at read time, so the payload and chips always carry a legal value; hub.ts reuses taskPayload and PAGE, so the hub serves complexity unchanged. Diff checked against the Specs: payload whitelist entry, `<span class="chip cx">` directly after the priority chip, the detail modal's priority row chip, `.chip.cx` quiet in both themes via `var(--code-bg)`/`var(--muted)`, esc() on every complexity render, and the `|| "moderate"` fallback. `node src/webui.test.ts` green in the worktree. No open questions.
- Live test (browser, real usage): started the worktree webui with `startWebUi` against the worktree board and against a fixture kanban root. Playwright with system Chrome exercised the board and the detail card. No code was changed.
- `/api/tasks` includes `complexity` for every task. A fixture task with `complexity: simple` returns simple. A fixture task with `complex` returns complex. A fixture task with no complexity key returns moderate.
- Board cards: the `.chip.cx` badge shows after the priority chip and before the issuer chip. Values render simple, complex and the moderate default. The real board card for #99 shows `moderate` after `medium`.
- Detail card: the priority row in `#m-attrs` shows the complexity chip next to the priority chip.
- Both themes: the chip uses `--code-bg` for the background and `--muted` for the color in dark and light. The computed values match the CSS variables.
- Note: `esc()` and the `|| "moderate"` fallback are not reachable at runtime because `kanban.ts` clamps complexity to a legal value at read time. The unit tests cover these two paths. This is not a defect.
- Note: the running hub on port 4242 serves the pre-branch code, so its `/api/tasks` has no complexity. `hub.ts` calls the same `taskPayload`, so a restarted daemon serves it. This is not a defect of this change.
- Result: no live-test findings. All checks pass. No open questions.
- Merge step 1: base branch resolved as main (7c22de8); `git merge main` in the worktree auto-merged cleanly with the ort strategy, no conflicts. Verified the auto-merge: the complexity chip code survived (taskPayload `complexity: t.complexity`, cardHtml `.chip.cx` after the priority chip, detail-card priority row chip) and main's agentLabel 1-based run-label change (000108) landed alongside it; webui.test.ts gained the agentLabel import and its 000108 asserts. Merge commit f180a4e in the worktree.
- All four suites green in the worktree after the merge: webui.test.ts, kanban.test.ts, orchestrator.test.ts, extension.test.ts. Nothing to fix, no extra commits.
- Merge step 2: base branch re-resolved as main (unchanged, 7c22de8); `git merge --no-edit feat/99-webui-complexity-badge` in the project root fast-forwarded main to f180a4e, no conflicts. Root clean, `chip cx` present in src/webui.ts on main.
- No open questions.
