---
name: "fix: task card chips render with a space between them"
priority: "low"
state: "live-testing"
worktree: "fix/176-chip-spacing"
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
- Added a single space between the priority, complexity and issuer chips in cardHtml (src/webui.ts), per the specs. Detail modal untouched.
- Updated the one existing assertion that asserted chip adjacency (cxCard) to expect `</span> <span`, and added the new assertion that no card markup contains `</span><span class="chip`.
- Ran src/webui.test.ts, src/kanban.test.ts and src/extension.test.ts: all pass. orchestrator.test.ts and index.test.ts do not use cardHtml, so they were not run (full npm test exceeds a 120 s timeout from daemon smoke tests, pre-existing slowness).
- Note for future agents: run src/webui.test.ts plain (no SE_LLM_TEAM_NO_WEBUI=1). Its daemon smoke test sets HOME to a temp config with webUi port 0, so it is safe, and the env var makes its "daemon log shows the web ui url" assertion fail.
- Merge step 1: merged main into fix/176-chip-spacing in the worktree. Clean, no conflicts (only skills/se-llm-team/SKILL.md carried over), so test suites were skipped per the merge protocol.
- Merge step 2: merged fix/176-chip-spacing into main in the project root. Fast-forward ca621b3..c38a37b, carrying src/webui.ts and src/webui.test.ts. Ready for live test.

# Open questions
