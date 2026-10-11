---
name: "feat: webui columns for to-merge and merging"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Add the to-merge and merging columns to the webui board in pipeline order, with accent classes, a spinner while merging, and merger logs viewable in the task detail card.

# Specs
Webui part of the to-merge/merging feature (the states and orchestrator flow are a separate task).

Facts (verified at HEAD e4c0358):
- Board columns render straight from STATES injected from src/kanban.ts (`const STATES = ${JSON.stringify(STATES)}` src/webui.ts:408; board.innerHTML = STATES.map(...) :469-476), so the two new columns appear automatically once the states land.
- WORKING = ["doing", "reviewing", "live-testing"] (:409) drives the spinner .spin (:346, used :473); accent classes .c-{state} :386-394, one per column in pipeline order.
- src/webui.test.ts STATE_NAMES :11 duplicates the 8 states; :253 loops it asserting each column heading is served.
- Modal log allowlist regex :81 ^(.+)\.(developer|reviewer|live-tester)$ - merger logs are not viewable in the detail card.

Changes:
1. WORKING gains "merging" (spinner while a merge is in progress); to-merge stays spinner-free (nothing runs while queued for the merger).
2. Accent classes .c-to-merge and .c-merging in pipeline order, visually consistent with the existing accents in both themes.
3. Extend the log allowlist regex with merger so past merger logs open in the task detail card.
4. Tests: extend src/webui.test.ts STATE_NAMES to the 10 states; the column-heading loop asserts to-merge and merging served; assert the spinner for merging. Full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Acceptance:
- 10 columns in pipeline order; merging shows the spinner; accents in both themes; merger logs viewable in the detail card.
- Typecheck and the full test suite pass.

Constraints:
- Files: src/webui.ts, src/webui.test.ts.
- HOLD behind 000078 (the column-heading test loop needs the states to exist), and behind the webui queue 000047 (doing, high), 000077 (high), 000076 (medium) - one webui rewrite at a time.

# Notes
