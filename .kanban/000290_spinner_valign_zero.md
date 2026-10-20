---
name: "fix: spinner vertical-align -1px to 0px"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "spinner-valign-zero"
---

# Summary
The spinner CSS sets vertical-align: -1px, which sits the spinner 1px below the text baseline. Change it to 0px.

# Specs
## Need

The spinner dots sit 1px too low. The user decided: the `vertical-align: -1px` of the spinners should be 0px.

## Change

`src/webui/page.ts:155`, rule `.spin`: change `vertical-align: -1px;` to `vertical-align: 0px;`. Touch nothing else in the rule.

## Facts

- The dashboard is one template literal: `PAGE` in `src/webui/page.ts`; the `.spin` rule is the only `vertical-align` declaration in `src/` (grep verified).
- No test pins `vertical-align: -1px`. The nearest pins are unaffected: `tests/webui/board.test.ts:240` pins the reduced-motion rule `.spin { animation: none; }`, and page.test.ts asserts `.spin` node identity only.

## Acceptance criteria

1. `pnpm test` passes unchanged.
2. The `.spin` rule in `src/webui/page.ts` carries `vertical-align: 0px;`.

# Notes
