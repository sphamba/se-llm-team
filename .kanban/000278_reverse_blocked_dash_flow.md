---
name: "feat: reverse dash flow on blocked-task board links"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "reverse-blocked-dash-flow"
---

# Summary
On the web dashboard board, dashed connector lines between blocked task cards currently animate flowing towards the blocker card. Reverse the animation so the dashes flow in the other direction (away from the blocker, towards the blocked card). The agent-card connectors in the task details dialog must keep their current direction.

# Specs
## Need

On the web dashboard board, the dashed lines linking a blocked task card to its blocker cards animate their dashes flowing towards the blocker. The user wants the animation to run in the opposite direction: dashes flow away from the blocker, towards the blocked card. The dashed lines linking the agents' cards in the task details dialog must NOT change.

## Facts (from code inspection)

- All dashboard UI is one template literal: `PAGE` in `src/webui/page.ts` (CSS+JS inline, no build step).
- Board task-card connectors: CSS rule `#relations path` at `src/webui/page.ts:134`, `stroke-dasharray: 6 4; animation: dashflow 1s linear infinite`. Keyframes `@keyframes dashflow { to { stroke-dashoffset: -10; } }` at `src/webui/page.ts:136`. Hover class `#relations path.relations-hot` (line 135) changes opacity only.
- Paths are drawn from the blocked card's right edge to the blocker's left edge by `curve()` at `src/webui/board.ts:210-226` (comment says the dash animation flows towards the blocker), so dashoffset 0 -> -10 flows towards the blocker.
- Agent-card connectors in the task details dialog: rule `#agent-relations path` at `src/webui/page.ts:228`, drawn by `drawAgentRelations()` at `src/webui/page.ts:749-777` into `#agent-relations` inside modal pane `#m-agent`. They reuse the SAME `@keyframes dashflow` and the same `curve()`.
- A reduced-motion rule at `src/webui/page.ts:157` disables the animation for both selectors in one rule.
- Tests: `tests/webui/board.test.ts:234-237` asserts exact strings `"stroke-dasharray: 6 4"` and `"@keyframes dashflow { to { stroke-dashoffset: -10; } }"`. `tests/webui/page.test.ts:35` fetches the served page and asserts CSS.

## Constraints

- Do NOT edit `@keyframes dashflow` or its -10 value: the dialog's `#agent-relations path` shares it.
- Do NOT flip path geometry in `curve()` in `src/webui/board.ts`: the dialog reuses it.
- Do NOT touch the `#agent-relations path` rule (page.ts:228) or the reduced-motion rule (page.ts:157).

## Implementation (decided)

Add `animation-direction: reverse;` to the `#relations path` rule at `src/webui/page.ts:134` only. The dash pattern is `6 4` (period 10, same as the keyframe offset delta), so the reversed loop stays seamless, and only board links reverse.

Fallback (only if reverse direction proves visually wrong, which is not expected): a new board-only keyframes `to { stroke-dashoffset: 10; }` referenced only by `#relations path`. Do not take this path without cause.

## Acceptance criteria

1. `pnpm test` passes.
2. Update the assertions in `tests/webui/board.test.ts` around lines 234-237: the existing exact-string assertions for `stroke-dasharray: 6 4` and `@keyframes dashflow { to { stroke-dashoffset: -10; } }` still hold, and add assertions that the `#relations path` rule contains `animation-direction: reverse` while the `#agent-relations path` rule does not contain it.
3. Manual visual check (when the dashboard is served with webUi enabled): dashes on blocked-task links drift from the blocker card towards the blocked card; agent-card links in the task details dialog keep the old direction.

# Notes
- Implemented: `animation-direction: reverse;` added to the `#relations path` rule only (src/webui/page.ts:134, after the shared `animation` shorthand so it wins the cascade). `@keyframes dashflow`, `curve()` and the `#agent-relations path` rule are untouched, per the constraints; the `6 4` dash period equals the keyframe's 10 delta, so the reversed loop stays seamless.
- Tests: tests/webui/board.test.ts asserts the board rule contains `animation-direction: reverse` and the agent rule does not. The spec named only that file, but tests/webui/page.test.ts also pinned a byte-identity mirror between the two rules, so its compare now strips the board-only declaration. The red run (board.test.ts, exit 1, the new assertion) came first; the scoped webui run (board, page, hub, logpane, agentlog) is green, exit 0 for each, with page and hub printing "all assertions passed".
- Live check for acceptance 3: seeded a done blocked task plus a backlog blocker under /tmp/rel278, served by an isolated daemon on 127.0.0.1:4412, and read the computed styles in headless Chromium. The rendered board path reports `animation-direction: reverse` (WAAPI effect direction `reverse` too); a path inside the visible `#agent-relations` reports `normal` for both. The daemon was killed after the check.
- Deviation: the full `pnpm test` (acceptance 1) was not run. The developer scope rule limits the run to the suites covering the changed code, so the five webui group files above were the whole test scope. Commit 5bd5079.
- Review of 5bd5079: page.ts adds `animation-direction: reverse` to the `#relations path` rule only; `@keyframes dashflow` (-10), `curve()` in board.ts, the `#agent-relations path` rule and the reduced-motion rule are untouched, per the constraints (diff --stat shows no board.ts change).
- Acceptance 2 met: board.test.ts updates the two exact-string pins (still present verbatim) and adds the board-has/agent-lacks `animation-direction: reverse` assertions; page.test.ts mirrors with the board-only declaration stripped, a correct adaptation of the byte-identity pin (recorded deviation).
- Stale-copy grep of tests/ for the two replaced assertion strings: no matches.
- Re-run of the review union (Notes green runs carry no sha): tests/webui/board.test.ts exit 0, tests/webui/page.test.ts exit 0.
- Acceptance 3 taken from the recorded live check (headless Chromium: board path `reverse`, agent path `normal`).
- Full `pnpm test` stays unrun: scoped union per reviewer guidance, no finding.

## Live test (2026-10-19)

- Scope: acceptance criterion 3 only. Acceptance criteria 1 and 2 are unit-test pins, and the live test does not run the unit test suite.
- Method: two hubs served the same throwaway board at /tmp/lt278/repo. The merged commit 5bd5079 ran on 127.0.0.1:4350, and the parent commit (HEAD^, extracted with `git archive`) ran on 127.0.0.1:4351. Each hub had its own HOME. The fixture held 00901_fixture_agents.md (done, two run logs, one agent chain link in the dialog), 00902_fixture_blocker.md (backlog blocker), 00903_fixture_blocked_same.md (backlog, blockedBy #902, same-column link) and 00904_fixture_blocked_cross.md (to-do, blockedBy #902, cross-column link).
- Result: 58 browser checks and 17 launch, preflight and cleanup checks, 0 failed.
- Served CSS: the merged `#relations path` rule equals the old rule plus `animation-direction: reverse;`. The `#agent-relations path` rule, `@keyframes dashflow` and the reduced-motion rule are byte-identical between the two builds. The merged page holds exactly one `animation-direction: reverse` declaration.
- Board links: pausing each path's animation and seeking its time gives stroke-dashoffset -8.00/-5.00/-2.00 at 200/500/800 ms with direction `reverse` on the merged build, and -2.00/-5.00/-8.00 with direction `normal` on the old build. The measured ink movement is -3.10 px (same column) and -3.14 px (cross column) toward the blocked card on the merged build, and +2.94 px toward the blocker on the old build. A synthetic +3.00 px calibration reads 2.90 px.
- Dialog links: the `#agent-relations` chain link keeps direction `normal`, the same offsets (-2.00/-5.00/-8.00 at 200/500/800 ms) and the same measured movement (-2.47 px) in both builds.
- Geometry: the board link starts at the blocked card's right edge at mid height (x=311.80 same column, x=626.61 cross column) and ends at the blocker card's left edge at mid height (x=29.00). The dialog link endpoints stay within 8.4 px of the two run cards. Neither page logged a console or page error.
- Assumptions: the two builds served the same fixture, so the board geometry is identical and only the served code differs. The ink movement is a proxy for the visible dash direction. The calibration confirmed the proxy (target +3.00 px, measured 2.90 px).
- Harness note (not a product finding): the dialog chain link is a short folded S-curve (arc length 42.4 px, screen bounding box 17.1 px), so it has no absolute pixel target. Its old direction is proven by the byte-identical rule and keyframes, the equal offsets and the equal movement in both builds. The dialog polls every second and re-runs setBody, which moves pixels. The probe froze the poll routes before the measurement.
- Findings: none. The change matches the Specs.
