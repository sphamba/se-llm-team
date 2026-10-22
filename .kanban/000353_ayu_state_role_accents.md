---
name: "feat: Ayu accent colors for pipeline states, agent roles and failed runs"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "ayu-state-role-accents"
---

# Summary
Recolor the web UI with official Ayu Light and Ayu Dark accents. One color per stage for columns and cards, one per agent role, and a whole-card dark red for dead runs. Light-theme agent labels use the darker Ayu ladder step to stay readable. Only the current color surfaces change, with no new markup.

# Specs
## Needs

### Target palette

Add theme-aware accent variables. The light values go in the light `:root` block (`src/webui/page.ts:96-99`). The dark values go in `DARK_VARS` (`src/webui/page.ts:71-80`), which is written to both `:root[data-theme="dark"]` and the `prefers-color-scheme` block, so both dark paths get them. Do not use `light-dark()`.

| Variable | Light | Dark | Used by |
| --- | --- | --- | --- |
| `--accent-backlog` | `#828e9f` | `#5a6378` | backlog column, splitter border/tint/check |
| `--accent-backlog-text` | `#86878c` | `#667381` | splitter label |
| `--accent-todo` | `#eba400` | `#ffb454` | to-do and doing columns, developer border/tint/check |
| `--accent-todo-text` | `#b37c00` | `#ffb454` | developer label |
| `--accent-review` | `#fa8532` | `#ff8f40` | to-review and reviewing columns, reviewer border/tint/check |
| `--accent-review-text` | `#cf6610` | `#ff8f40` | reviewer label |
| `--accent-merge` | `#a37acc` | `#d2a6ff` | to-merge and merging columns, merger border/tint/check |
| `--accent-merge-text` | `#9d6fc8` | `#d2a6ff` | merger label |
| `--accent-live` | `#22a4e6` | `#59c2ff` | to-live-test and live-testing columns, live-tester border/tint/check |
| `--accent-live-text` | `#1a91cd` | `#59c2ff` | live-tester label |
| `--accent-integration` | `#4cbf99` | `#95e6cb` | to-integration-test and integration-testing columns, integration-tester border/tint/check |
| `--accent-integration-text` | `#3b9b7c` | `#95e6cb` | integration-tester label |
| `--accent-done` | `#86b300` | `#aad94c` | done column, doctor border/tint/check |
| `--accent-done-text` | `#719700` | `#aad94c` | doctor label |
| `--error` | `#e65050` | `#d95757` | failed card border, tint and mark |
| `--error-text` | `#e5474f` | `#d95757` | failed card label and cross |

These are official Ayu tokens: `ui.fg` (grey accent), `gray.l1`/`gray.l5` (grey text), the `syntax.*` base tokens for accents, the `l1` ladder steps for light text, and `common.error` / `red.l1` for the failed run. Light label steps are 3.26 to 3.76 contrast on `#fafafa`. Do not invent custom hexes.

### State accents

Replace the 12 static `.c-*` rules (`src/webui/page.ts:326-338`) with 7 rules in stage order. Only the `--ac` value changes; the card left border keeps `border-left: 3px solid var(--ac)` and inherits from its column, so no card markup change.

| Selector | Accent variable |
| --- | --- |
| `.c-backlog` | `--accent-backlog` |
| `.c-to-do, .c-doing` | `--accent-todo` |
| `.c-to-review, .c-reviewing` | `--accent-review` |
| `.c-to-merge, .c-merging` | `--accent-merge` |
| `.c-to-live-test, .c-live-testing` | `--accent-live` |
| `.c-to-integration-test, .c-integration-testing` | `--accent-integration` |
| `.c-done` | `--accent-done` |

### Agent role accents

Keep the current surfaces: label color, active border, active 20% tint, check mark. Replace the static hexes at `src/webui/page.ts:200-220` with variables. Place the failed rules after these rules (see below), so they override the role color at equal specificity.

| Role class | Label | Active border and tint | Check |
| --- | --- | --- | --- |
| `.agent-splitter` | `--accent-backlog-text` | `--accent-backlog` | `--accent-backlog` |
| `.agent-developer` | `--accent-todo-text` | `--accent-todo` | `--accent-todo` |
| `.agent-reviewer` | `--accent-review-text` | `--accent-review` | `--accent-review` |
| `.agent-merger` | `--accent-merge-text` | `--accent-merge` | `--accent-merge` |
| `.agent-livetest` | `--accent-live-text` | `--accent-live` | `--accent-live` |
| `.agent-integration` | `--accent-integration-text` | `--accent-integration` | `--accent-integration` |
| `.agent-doctor` | `--accent-done-text` | `--accent-done` | `--accent-done` |

Keep `.agent-card` itself on `var(--link)` and `var(--border)`. Keep the 20% `color-mix` shape. Do not add an `analyst` role: it has no UI surface today.

### Failed runs

A run is failed only when its payload `status` is `"dead"` (the existing `.dead` marker file). No backend change.

- Replace the current `.agent-dead { color: var(--critical-fg); }` (`src/webui/page.ts:190`) with a whole-card rule placed after the role rules: `.agent-card.agent-dead` sets `color: var(--error-text)`, `border-color: var(--error)` and `background: color-mix(in srgb, var(--error) 15%, var(--panel))`.
- The rule must override the role label, the active role border and the active role tint. Place it after all `.agent-*` role rules and use two classes. The whole card turns red: label, border, 15% tint and cross.
- Set the cross to `var(--error-text)`.
- Keep `.agent-live` and `.agent-past` without CSS rules. The existing tests assert their absence.
- Do not change `.agent-card`, `.agent-past`, `.agent-live`, the spinner or the check.

### Do not change

- Priority chips and their variables (`--low-*`, `--medium-*`, `--high-*`, `--critical-*`). `--critical-fg` keeps its current values.
- `--bg`, `--fg`, `--panel`, `--border`, `--heading`, `--muted`, `--faint`, `--soft`, `--hover`, `--overlay`, `--code-bg`, `--link`.
- The stage fade, the `to-integration-test` card dim, the theme toggle and localStorage behavior.
- Any markup. `cardBaseHtml`, `makeCard`, `syncBoard`, `agentCardHtml`, `ROLE_CLS` and payload stay as they are.
- `README.md` and `docs/`. The repository documents no colors today.

## Tests

`tests/webui/board.test.ts`:
- Replace the 12-distinct-accent pin (`:126-132`) with the 7-rule mapping above. Assert both states of a stage reference the same variable, the rules stay in stage order, and the 7 variables are distinct.
- Keep the column-class, fade, card-markup and `user-hold` cases green.

`tests/webui/page.test.ts`:
- Pin every light var and every dark var in the table, including the media-query dark block.
- Replace the per-role hex loop (`:421-427`) with the exact label, active border/tint and check variable names.
- Pin the failed rule at an index after the last role rule, with the three declarations and a 15% mix.
- Pin the cross on `var(--error-text)`.
- Keep the `.agent-past`/`.agent-live` absence assertions, the unscoped `.agent-card` pins, the `ROLE_CLS` pin and the `.card` left-border pin.
- Keep `--hover` and the other untouched vars green.

## Acceptance

- `node tests/webui/page.test.ts` exits 0.
- `node tests/webui/board.test.ts` exits 0.
- `pnpm test` exits 0.
- Manual check in both themes: each column top border and card left border uses its table color; each agent card label uses the text token; a dead run is fully red including border and tint; priority chips keep their old colors.

# Notes

## What changed
- `src/webui/page.ts`: 16 new theme vars (light `:root`, plus `DARK_VARS` and its media-query twin, no `light-dark()`), all official Ayu tokens.
- 12 static `.c-*` hexes replaced by 7 stage rules in pipeline order, each stage pair sharing one `--ac` variable; the card left border keeps `border-left: 3px solid var(--ac)`, no markup change.
- 7 role rules read `--accent-<stage>-text` for the label and `--accent-<stage>` for active border, 20% tint and check.
- `.agent-dead { color: var(--critical-fg) }` replaced by `.agent-card.agent-dead` after all role rules: `--error-text` label, `--error` border, 15% mix tint; `.cross` now uses `--error-text`.
- Tests: `tests/webui/board.test.ts` pins the 7-rule stage mapping, order and distinct variables; `tests/webui/page.test.ts` pins all 32 theme values in all three blocks, the role label/border/tint/check variables, and the failed rule after the last role rule.

## Acceptance
- red proof: both suites exit=1 before the source edit (`page.test.ts` cross/dead pins, `board.test.ts` stage mapping).
- `node tests/webui/page.test.ts` exit=0 (pre-commit and post-commit).
- `node tests/webui/board.test.ts` exit=0 (pre-commit and post-commit).
- manual color check, pre-commit: a scratch script resolved every table value from the served `PAGE` in light and both dark paths, 32/32 match, exit=0. The visual browser pass is left to the reviewer.
- `pnpm test` skipped per the write-run rule (never the full suite). Only these two suites cover `src/webui/page.ts`: `grep -rln 'from ".*webui/page' tests/` prints just them.
- commit `feat(webui): recolor stages, agent roles and dead runs with Ayu accents`, `git show --stat` = 3 files, working tree clean.

## Live test: Ayu accents for stage columns, agent roles and dead runs

Served board from `/home/phamba/repos/se-llm-team/.worktrees/feat/353-ayu-state-role-accents` (merged commit) through a hub-only fixture root: one task per pipeline state, one task with a run log for every role, a dead developer run and a doctor log. Chromium measures the computed style of the real elements in the light theme, in the `data-theme="dark"` path and in the `prefers-color-scheme: dark` path.

Assumptions:
- The Specs contrast range is quoted on #fafafa but the light panel is #ffffff, where the same steps give 3.41 to 3.93; the tints are checked against the measured mix over --panel.
- The modal agent row is opened by clicking a card, so the agent cards are the real spawned-card markup.
- No markup was asserted beyond the CSS surfaces the Specs name.

Not exercised: a live agent run (spinner) and the stage-off fade, which the task does not change.

Tree: `/home/phamba/repos/se-llm-team/.worktrees/feat/353-ayu-state-role-accents`, driver: `/tmp/ayu-state-accents-recon/driver.mjs`, wrapper: `/tmp/ayu-state-accents-recon/run.sh`. Runs: 3 merged + 1 control (pre-fix `HEAD^`).

| # | Claim | Expected | Control (pre-fix) | Observed (merged) | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Ayu Light accent vars are in the light :root | 16/16 | 0/16 | 16/16 / 16/16 / 16/16 | green |
| 2 | Ayu Dark accent vars are in the data-theme=dark block | 16/16 | 0/16 | 16/16 / 16/16 / 16/16 | green |
| 3 | Ayu Dark accent vars are in the prefers-color-scheme block | 16/16 | 0/16 | 16/16 / 16/16 / 16/16 | green |
| 4 | light: --ac, column top border and card left border are the stage accent, 12 states | 36/36 | 0/36 | 36/36 / 36/36 / 36/36 | green |
| 5 | dark attr: --ac, column top border and card left border are the stage accent, 12 states | 36/36 | 0/36 | 36/36 / 36/36 / 36/36 | green |
| 6 | dark media: --ac, column top border and card left border are the stage accent, 12 states | 36/36 | 0/36 | 36/36 / 36/36 / 36/36 | green |
| 7 | light: 7 role labels take their stage text token | 7/7 | 0/7 | 7/7 / 7/7 / 7/7 | green |
| 8 | dark: 7 role labels take their stage text token | 7/7 | 0/7 | 7/7 / 7/7 / 7/7 | green |
| 9 | role cards at rest keep the plain .agent-card border and panel background | 28/28 | 28/28 | 28/28 / 28/28 / 28/28 | green |
| 10 | light: selected role card border, 20% tint and check take the stage accent | 21/21 | 0/21 | 21/21 / 21/21 / 21/21 | green |
| 11 | dark: selected role card border, 20% tint and check take the stage accent | 21/21 | 0/21 | 21/21 / 21/21 / 21/21 | green |
| 12 | light: a dead run is fully red at rest and while selected | 8/8 | 0/8 | 8/8 / 8/8 / 8/8 | green |
| 13 | dark: a dead run is fully red at rest and while selected | 8/8 | 0/8 | 8/8 / 8/8 / 8/8 | green |
| 14 | priority chips keep their old colours in both themes | 8/8 | 8/8 | 8/8 / 8/8 / 8/8 | green |
| 15 | 7 stage rules pair both states to one stage accent, in pipeline order | rules=7 pairs=7 ordered=yes | rules=12 pairs=0 ordered=n/a | rules=7 pairs=7 ordered=yes / rules=7 pairs=7 ordered=yes / rules=7 pairs=7 ordered=yes | green |
| 16 | no light-dark(), no .agent-live/.agent-past rule, .agent-card keeps --link and --border | absent\|absent\|kept | absent\|absent\|kept | absent\|absent\|kept / absent\|absent\|kept / absent\|absent\|kept | green |

Red proof: none, every merged cell equals the frozen expected value and every control equals the frozen pre-fix value.

Browser pids saved: 4; after cleanup 0 non-zombie member(s).

Verdict: green.
