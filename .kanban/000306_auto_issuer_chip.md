---
name: "fix: task cards show the auto issuer as auto, not user"
priority: "medium"
state: "done"
worktree: ""
issuer: "#301"
complexity: "simple"
shortName: "auto-issuer-chip"
---

# Summary
cardBaseHtml treats auto as a non-ref issuer and falls back to printing the literal user, so orchestrator-created integration tasks show a user chip. Narrow the ref test to #<num> and print the real issuer value, so an auto task shows a plain auto chip with no badge and no link.

# Specs
## Problem

`cardBaseHtml` (`src/webui/board.ts:178-201`) decides whether an issuer is a real task ref:

```js
const issued = !!t.issuer && t.issuer !== "user" && t.issuer !== "auto";
...
(issued ? esc(t.issuer) : "user") +
```

So a card whose issuer is `auto` falls into the else-branch and prints the literal `user`. The orchestrator already writes `issuer: "auto"` (`src/orchestrator/pipeline.ts:90`), `parseTask` keeps it (`src/kanban.ts:189`) and `lightRow` passes it to the browser unchanged (`src/webui/payload.ts:603`). The detail dialog's `issuerCell` (`src/webui/page.ts:705-708`) already prints `auto` as plain text, so the card and the dialog disagree today. One real case is on the board: `.kanban/000305_integration_of_303.md` has `issuer: "auto"`.

## Change

In `cardBaseHtml` (`src/webui/board.ts:178-201`):

- Narrow `issued` to real task refs: `const issued = !!t.issuer && /^#\d+$/.test(t.issuer);` Only a `#<num>` issuer then gets the `chip issuer` style and the `name issued` accent.
- Print the issuer as it is: `(issued ? esc(t.issuer) : esc(t.issuer || "user")) +`. A missing issuer still reads `user`.

Resulting markup:

| issuer | chip | name accent |
| --- | --- | --- |
| `user` | `<span class="chip">user</span>` | none |
| `auto` | `<span class="chip">auto</span>` | none |
| `#42` | `<span class="chip issuer">#42</span>` | `<div class="name issued">` |

No link for `auto`, the same as for `user`. The hub view and the board both come through `cardHtml`, so one change covers them.

- Rewrite the comment at `src/webui/board.ts:176-177`: it currently states that `auto` renders exactly like `user`. It must state that `auto` gets a plain chip labelled `auto`, with no badge and no link.
- Do not change `issuerCell` in `src/webui/page.ts:705-708`; it already prints `auto`. Do not change `parseTask`, `createTask`, the payload or the CSS.

## Tests

`tests/webui/board.test.ts:129-131` pins the bug:

- `assert.equal(autoCard, userCard, "an auto-issued card renders exactly like a user-issued one")` becomes an assertion that the auto card carries `<span class="chip">auto</span>`.
- `assert.ok(autoCard.includes('<span class="chip">user</span>') && !autoCard.includes("issued") && !autoCard.includes("auto"), ...)` becomes the inverse: the auto card contains `auto` in its issuer chip, has no `chip issuer`, and no `class="name issued"`.
- Keep the `user` pins at `:124-126` and the `#42` pins at `:132-135` unchanged. Add one assertion that the auto card and the user card differ only in the chip text, by comparing them with that chip string replaced.

`tests/webui/page.test.ts:124-130` already asserts that `issuerCell` prints `auto` as plain unlinked text. Keep it. `tests/webui/hub.test.ts` and `tests/kanban/attributes.test.ts` need no change.

## Acceptance criteria

Run in the worktree:

- `node tests/webui/board.test.ts` exits 0.
- `node tests/webui/page.test.ts` exits 0.

At live test, in the repo root: `pnpm test` exits 0. Then, by hand, open the board with `.kanban/000305_integration_of_303.md` on it: its card shows the `auto` chip, no `user` chip, and no issuer accent. Its detail dialog shows `auto` in the issuer row.

## Out of scope

- No change to how the orchestrator sets the issuer, and none to the `auto` value.
- No new chip style, badge or link for `auto`.
- No change to the detail dialog, which is already correct.

# Notes
- Narrowed `issued` in `cardBaseHtml` to `/^#\d+$/` and print the real issuer with `esc(t.issuer || "user")`; `auto` now gets a plain chip with no badge and no link. Missing issuer still reads `user`.
- Updated the comment above `cardBaseHtml` and the auto-card pins in `tests/webui/board.test.ts`, including the new differ-only-in-chip-text check. The test went red first, then green.
- `node tests/webui/board.test.ts` exit 0 and `node tests/webui/page.test.ts` exit 0. No change to `issuerCell`, `parseTask`, the payload or the CSS.
- Assumption: any issuer that is not `#<num>` (and not empty) now prints as-is with a plain chip, which matches the Specs rule and the dialog.
Review of d381ad8 (first pass): pass. The diff matches the Specs line for line, and both acceptance suites are green.
- `src/webui/board.ts:179` narrows `issued` to `/^#\d+$/`, so `auto` takes the plain chip path, and `src/webui/board.ts:198` prints `esc(t.issuer || "user")`; a missing issuer still reads `user`.
- `src/webui/board.ts:175-176` now states that `auto` gets a plain chip labelled `auto` with no badge and no link.
- `tests/webui/board.test.ts:130-132` pins the auto chip, the absent `chip issuer` and `name issued` classes, and the differ-only-in-chip-text comparison; the pre-fix code printed `user`, so the new pins cover the bug. The `user` pin at `:125` is unchanged.
- `git diff --stat main...HEAD` lists only `src/webui/board.ts` and `tests/webui/board.test.ts`, so `issuerCell` (`tests/webui/page.test.ts:124-130`), `parseTask`, the payload and the CSS are untouched.
Tests: `node tests/webui/board.test.ts` exit 0, `node tests/webui/page.test.ts` exit 0 (chained in one call).
## Live test (2026-10-21)
Lane: hub-only root. Driver `/tmp/lt306/driver.mjs` starts `startHub` from the tree under test on an isolated fixture root (`<fixture>/.kanban` with four backlog cards and one done card), drives headless Chromium through `/`, reads each card's DOM, and clicks the auto card to read the dialog's issuer row. Same driver and fixture shape ran on the merged tree and on the control tree (`git archive e893eec`, the parent commit). Proofs below are the driver's printed `RESULT` lines.

| claim | printed proof (merged d381ad8) | control (parent e893eec) |
| --- | --- | --- |
| C1 an auto-issued card prints a plain chip labelled `auto` | `PASS actual={"classes":[],"text":"auto"}` | `FAIL actual={"classes":[],"text":"user"}` |
| C2 the auto card has no issuer badge and no name accent | `PASS actual={"issuerBadge":false,"nameAccent":false}` | `PASS actual={"issuerBadge":false,"nameAccent":false}` |
| C3 the auto chip carries no link | `PASS actual={"elements":0}` | `PASS actual={"elements":0}` |
| C4 a user-issued card keeps the plain `user` chip | `PASS actual={"classes":[],"text":"user"}` | `PASS actual={"classes":[],"text":"user"}` |
| C5 a `#42` card keeps the `chip issuer` badge and the `name issued` accent | `PASS actual={"classes":["issuer"],"text":"#42","nameAccent":true}` | `PASS actual={"classes":["issuer"],"text":"#42","nameAccent":true}` |
| C6 a missing issuer still reads `user` | `PASS actual={"classes":[],"text":"user"}` | `PASS actual={"classes":[],"text":"user"}` |
| C7 the auto task's detail dialog prints `auto`, unlinked | `PASS actual={"label":"issuer","value":"auto","links":0}` | `PASS actual={"label":"issuer","value":"auto","links":0}` |

- Merged tree: 7/7 pass, `/health` = `ok`, one anchored `ss -ltn` line on the hub port, 5 cards rendered, no page errors, hub socket `closed` after `close()`.
- Control tree: 6/7. Only C1 is red, so the check fails when the change is absent, and the keep-green rows (C4, C5, C6, C7) hold on both trees.
- The auto card's issuer chip is a bare `<span class="chip">auto</span>`: no `issuer` class, no nested element, no `name issued` accent. The dialog agreement called out in the Specs now holds: card `auto`, dialog `auto`.

Assumptions:
- The fixture reproduces the real case `.kanban/000305_integration_of_303.md` with an isolated auto-issued card, because the shared real board is not a live-test target; the card markup does not read the task body.
- The issuer chip is identified as the card chip that carries neither a `p-` priority class nor a `cx` complexity class, so a new chip style would not be mistaken for it.
- The detail dialog is reached by clicking the auto card, as a user does, not by a direct URL.
- `state: backlog` and `state: done` place the five fixture cards in rendered columns; the `#42` issuer needs no existing task for the card chip, and a `done` origin task keeps the ref realistic.

Not exercised: the hub view (one project entry, so `/api/projects` shows a single tab; the Specs say it shares `cardHtml`), `/api/tasks` payload bytes, and any CSS, which the Specs keep out of scope.
