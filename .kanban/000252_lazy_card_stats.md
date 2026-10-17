---
name: "feat: lazy stats on all board cards"
priority: "high"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "lazy-card-stats"
blockedBy: ""
---

# Summary
Verification only: #263 (batched card-stats endpoint) and #264 (client lazy fetch on unfold, localStorage cache, subtle animation) together give every board card its token/time stat line - cards beyond the first 5 load lazily on unfold, appear when available with a subtle animation, and done-task stats cache in browser localStorage. Check the integrated feature once both pieces have landed.

# Specs
Verification scope (the pieces land through #263 and #264; check them against the original goal, user decision 2026-10-16: ALL cards show stats, fetched lazily, subtle animation, done-task stats in browser localStorage):

1. The pinned contract held end to end: GET /api/card-stats?files=... answers {file: {agents}} and the client merges it so taskStats renders on every revealed card, not just the first 5.
2. taskPayload's eager first-5 attach is unchanged (the 5 s poll stays cheap under #250's rules: no full-log caching, incremental parsing); the first-5-only cap is gone as the user-facing limit (#245 extended).
3. Unfolding a column reveals every card's stats line with a smooth subtle animation and a subtle card height growth, no layout jump; prefers-reduced-motion turns the animation off.
4. Done tasks serve stats from browser localStorage on the next page load and the next unfold; entries invalidate when a task leaves done; non-done tasks never serve stale stats (always fetch fresh); in-flight fetches de-duped, one batched request not N.
5. node tests/webui.test.ts passes with both subtasks' test additions landed in disjoint regions of the shared file (assert count above the 757 baseline).

Acceptance:
- node tests/webui.test.ts passes.
- Live test (feel-based): unfolding a column gives every revealed card its stats line, appearing smoothly with a subtle height animation; done tasks serve stats from localStorage on the next page load.

# Notes

- Blocked verification (checked 2026-10-17 at base 82160ef): neither dependency has landed. #263 is in state doing (its worktree has no commits, only an uncommitted tests/webui.test.ts change). #264 is in state to-do (its worktree is clean with no commits).
- Absent from the base: no /api/card-stats route in src/hub.ts, no cardStatsPayload export in src/webui/payload.ts, no lazy stats fetch and no stats localStorage entry in src/webui/page.ts. VISIBLE_CARDS = 5 (src/webui/payload.ts:610) still caps the eager attach.
- node tests/webui.test.ts passes with 757 asserts (exit 0, output in /tmp/252-webui-baseline.log). The test additions of both subtasks are absent, so the count is not above the 757 baseline.
- No live check ran: there is no endpoint and no client behavior to verify.
- This run raced the split: the daemon promoted the task when its earlier blockers #250 and #251 reached done, the splitter then set blockedBy #263 and #264, and the developer spawned in the same minute. The ordering was premature, not the implementation.
- Next step: re-run this verification after #263 and #264 land on main. The worktree then needs a base that holds both commits.
- Verification run 2026-10-17 at base f53e4c5: both dependencies landed on main (#263 commit 0e9cab6, #264 commit 4d35ac0, stale-pin fix f53e4c5). The worktree branch fast-forwarded from 82160ef to f53e4c5, so the check ran against the integrated code. No source change was necessary.
- Suites pass: node tests/webui.test.ts gives exit 0 with 797 assert lines (baseline 757, after #263 764). node tests/webui/board.test.ts, node tests/webui/page.test.ts and node tests/webui/hub.test.ts give exit 0. Full output in /tmp/252-webui.log.
- Spec 1 (pinned contract), direct curl on the live daemon: /api/tasks carries agents for the five newest done cards only (000003 to 000007) and none for 000001 and 000002. /api/card-stats?files=000001_probe.md,000002_probe.md,bogus.md answers both requested files with their agents (tokens 100 and 200) and omits bogus.md. project=nope answers 404 with an empty body.
- Spec 2: the eager first-5 attach in /api/tasks is unchanged. The first-5-only limit is gone for the user because the client fetches the folded cards through the endpoint.
- Spec 3 (animation), live Playwright check with 7 done cards: the 5 folded cards carry stats, one unfold reveals all 7, and the 2 folded cards first show no stats, then gain the stats line. The card height grows 21 px and the statsIn animation fires. Reduced motion gives computed animationName "none" with no statsIn event.
- Spec 4 (localStorage): after the lazy fetch, the two folded done cards sit in localStorage under card-stats|| keys. After a reload and an unfold they render from localStorage and fire no request. When one task leaves done, the page poll removes its entry and keeps the other entry. Non-done cards never write localStorage and refetch fresh after a reload. A collapse and a second unfold during an in-flight fetch produce one batched request only.
- Spec 5: both subtask test additions sit in tests/webui.test.ts in disjoint regions (the #263 hub and stats fixture regions, and the #264 helper block at the end). The assert count is above the baseline.
- Location shift: the lazy fetch, the done localStorage cache and the statsKey, applyCardStats and mergeCardStats helpers live in src/webui/board.ts, not src/webui/page.ts as the earlier blocker note said. page.ts interpolates them into PAGE and wires toggleCol and queueStats.
- Live fixture: 7 done tasks plus 6 to-do tasks, each with one run log, on port 4399. The check daemon ran with --rescan-seconds 3600 --poll-minutes 3600, so it never spawned an agent for the to-do tasks. Fixture and script: /tmp/252-live/, log: /tmp/252-live/check.log. The daemon was stopped after the check.
- Re-review at f53e4c5 (HEAD = main = f53e4c5, worktree clean, no new commits): all prior passes stand. Spec 1: route at src/hub.ts:247, cardStatsPayload at src/webui/payload.ts:649, client merge via syncCardStats. Spec 2: VISIBLE_CARDS = 5 unchanged (src/webui/payload.ts:610), eager attach untouched. Spec 3: statsIn animation and prefers-reduced-motion override at src/webui/page.ts:168-170, 271. Spec 4: applyCardStats/mergeCardStats at src/webui/board.ts:327, 366, statsInFlight de-dupe at src/webui/page.ts:413-433. Spec 5: recorded runs at this exact base stand (webui.test.ts 797 asserts, board/page/hub suites exit 0). No fixes. The fast-forward assumption held: the branch FFed 82160ef to f53e4c5 and every check ran on the integrated base, so the open question is resolved.

## Live test (2026-10-17)

- Base: HEAD = main = 35e56b6, worktree clean. The diff f53e4c5..35e56b6 touches only tests/ and scripts/ (orchestrator test split, test-changed map), so src/webui is identical to the previously verified f53e4c5.
- Method: hub-only (startHub from the worktree) on port 4351, isolated HOME /tmp/252-lt/home. Fixture /tmp/252-lt/repo: 7 done tasks (mtimes 1..7 min, tokens 1..7) and 6 to-do tasks (tokens 101..106), one run log each. Output /tmp/252-lt/api.log and /tmp/252-lt/browser3.log, scripts in /tmp/252-lt/.
- Spec 1 (pinned contract), API preflight (12 checks, 0 failed): /api/card-stats?files=d2,d1,bogus answers exactly {file: {agents}} for the two real files (tokens 2 and 1) and omits bogus. Missing files and files=, each answer {}. project=nope answers 404 with an empty body. /api/projects lists one project.
- Spec 2: /api/tasks carries agents for exactly the 5 newest rows per column (done: d3..d7 eager, d1/d2 absent, to-do: t2..t6 eager, t1 absent). The eager first-5 attach is unchanged.
- Spec 3 (feel), Playwright (27 checks, 0 failed): the done column shows 5 of 7 cards with a visible "show all (7)" toggle. One unfold reveals both folded cards, stats-less at first. Exactly one batched request leaves the page with files=000002_d2.md,000001_d1.md. Both cards then show their stats line (2 · 10s and 1 · 10s), the revealed card grows +21 px (64 -> 85), and the statsIn animation fires for both. The 10 cards already on the board keep their exact board-relative position (0 px drift). Reduced motion: the stats line appears, 0 statsIn events, computed animationName "none".
- Spec 4 (localStorage): after the fetch the two done files sit in localStorage under card-stats|| keys with the full agents JSON. A reload plus one unfold renders the cached stats line with 0 card-stats requests, and the statsIn animation still fires. The to-do t1 is fetched, is not written to localStorage, and refetches fresh on the next unfold. A collapse and a second unfold during the in-flight fetch produce one request only.
- Spec 5 (unit suite): not run. The live-tester role forbids running any *.test.ts. The recorded developer/reviewer runs at f53e4c5 (webui.test.ts 797 assert lines, board/page/hub suites exit 0) stand, and no src file changed since.
- Assumptions: the single-project board has no tabs, so the stats cache key is card-stats||<file>. Synthetic run logs carry usage input = the card's token value over a 10 s span, so fmtTokens renders the raw value. No observed behavior contradicts the task's stated assumptions.
- Harness note (not product findings): two probe-script bugs were fixed during the run: a viewport-relative top read was offset by Playwright's scroll-into-view, and the board-relative baseline plus the animationstart snapshot were read during the card .enter animation and before the event task ran.
