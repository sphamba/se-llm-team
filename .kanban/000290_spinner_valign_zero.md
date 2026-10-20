---
name: "fix: spinner vertical-align -1px to 0px"
priority: "low"
state: "done"
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

- Changed `.spin` `vertical-align: -1px` to `0px` in `src/webui/page.ts:155` (trivial complexity, no test added per policy).
- Scoped suites `tests/webui/page.test.ts` and `tests/webui/board.test.ts` pass.
- Commit `ee809dd` "fix(webui): set spinner vertical-align to 0px".

## Live test (2026-10-20)

Ran the merged commit `ee809dd` from the task worktree. A hub-only fixture root held one task in state `doing`, so the board rendered a live spinner. The hub ran on port 4351 with an isolated HOME and XDG. A headless Chromium loaded the board and the checks read the served HTML and the browser computed style.

Last tally from `check.mjs`:

```
RESULT: 16 passed, 0 failed
```

- The served page carries the exact `.spin` rule with `vertical-align: 0px;`, and it has no `vertical-align: -1px`.
- The computed `vertical-align` of the rendered spinner is `0px`. The spinner bottom edge is 0px from the text baseline.
- Control: a reinjected `-1px` rule computes `-1px` and puts the spinner 1px below the baseline. The measurement thus sees the change. After the control, the declaration reads `0px` again.
- The rest of the rule is intact: inline-block, 9px by 9px, margin-right 5px, 2px solid border, 50% radius, spin 0.9s linear infinite.
- `/api/hub` answered 200 with the merged commit, the hub pid matched the pidfile, and the page loaded with no console or page errors.

Assumptions:

- The spinner CSS is one shared rule, so one rendered spinner instance (a task card in `doing`) covers every spinner context.
- A zero-height inline-block next to the spinner is the text baseline reference.
- `pnpm test` is the developer gate named in the acceptance criteria, so the live test did not run it.
- The offset was measured from the DOM geometry, not from the screenshot.

No findings from the live test. No open questions.
