---
name: "fix: task card chips render with a space between them"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "chip-spacing"
---

# Summary
Task preview cards render the priority, complexity and issuer chips adjacent with no gap: cardHtml (src/webui.ts:939-947) emits `</span><span class="chip ..."` with no whitespace between the spans. Add a space between the chips.

# Specs

## Change
- In cardHtml, put a single space between the priority, complexity and issuer chips (`</span> <span`), so the three pills on a task preview card read apart. The name div is a block, so no space is needed after it.
- The detail modal attrs rows (:1475-1476) are out of scope: each chip already sits in its own div.
- Nothing else changes; changing cardHtml changes every card's identity, which is one full board re-render, no behavior change.

## Tests
- src/webui.test.ts: existing chip assertions (:516-:523) must still pass (they match individual spans); add one assertion that the card markup contains `</span> <span class="chip` between the chips.

# Notes

# Open questions
