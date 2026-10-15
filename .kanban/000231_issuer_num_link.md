---
name: "fix: issuer task number links to its task card in the detail modal"
priority: "medium"
state: "doing"
worktree: "fix/231-issuer-num-link"
issuer: "user"
complexity: "simple"
shortName: "issuer-num-link"
---

# Summary
In the task detail modal, the issuer row shows a plain-text #num when the issuer is another task. Make it a .num-link that opens that task's detail card, reusing the blockedRow resolution pattern.

# Specs
# Specs
- In attrsHtml (src/webui/page.ts:476) the issuer row becomes a link when the issuer is another task: when t.issuer matches #<num>, resolve the number to the task file on the active board (same pattern as blockedRow: parseInt match against each task's file prefix) and render numLinkHtml(target.file). The existing binding loop at page.ts:466 already binds every #m-attrs .num-link to openTask(data-task), so no new binding code.
- Fallbacks: issuer "user" or absent stays plain text; an issuer number whose task is not on the active board stays plain text.
- The board card's issuer badge (board.ts:164) stays unchanged; the .num-link CSS already exists.
- Update the scoped assertion at tests/webui.test.ts:795, which pins the current plain-text expression, to match the new issuer row.

# Acceptance
- Live-UI check: a task-issued task's detail modal shows the issuer #num as a link (link color, pointer) that opens that task's detail card.
- Grep check: the issuer row renders numLinkHtml for task-issued issuers with the blockedRow-style resolution; the tests/webui.test.ts:795 assertion is updated.
- Plain text for "user" and for issuer numbers not on the active board.

# Notes
