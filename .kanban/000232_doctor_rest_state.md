---
name: "fix: doctor cards at rest look opened"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "doctor-rest-state"
---

# Summary
The .agent-doctor rest state always shows a strong blue border and tinted background, the same visual shape as the .agent-card-active open state, so doctor cards look like their log is open when it is not. Rest keeps only blue text and checkmark; the blue-active look stays for the actually opened card.

# Specs
# Specs
- The doctor cards' rest state reads as the opened look: .agent-doctor (src/webui/page.ts:200) always sets border-color var(--doctor-fg) and background var(--doctor-bg), which is the same visual shape as the .agent-card-active open state (colored border + tinted background). At rest a doctor card must look like other resting cards: plain var(--border) outline, var(--panel) background, with only the text and the .check mark staying blue. So the .agent-doctor rule keeps only color: var(--doctor-fg); the .agent-doctor:hover override is dropped (inherits the plain .agent-card hover).
- The opened look stays blue: .agent-doctor.agent-card-active keeps border-color var(--doctor-fg) and background var(--doctor-bg-strong), so a doctor card with its log open still reads blue-active and distinct from the run cards' gold-active.
- --doctor-bg becomes unused: remove it from all three theme blocks; --doctor-bg-strong stays (the active state uses it).
- Update the scoped assertions at tests/webui.test.ts:925 (pins the exact rest rule), :926 (pins the hover rule) and :921 (loops --doctor-bg: over the theme blocks) to match the new rules; :927, :928 and :930 stay valid.

# Acceptance
- Live-UI check: a doctor card at rest looks like other resting cards except the blue text and blue checkmark; a doctor card with its log open shows the blue active outline and highlight; both themes.
- Grep check: the .agent-doctor rest rule sets only the text color, no hover override, the active rule keeps the blue pair, and --doctor-bg is gone from the theme blocks.

# Notes
- src/webui/page.ts: `.agent-doctor` rest rule is now `{ color: var(--doctor-fg); }`; the `:hover` override is gone (the plain `.agent-card` hover applies); `.agent-doctor.agent-card-active` keeps `border-color: var(--doctor-fg); background: var(--doctor-bg-strong);`; `--doctor-bg` is removed from the light, dark and prefers-dark theme blocks.
- tests/webui.test.ts: the theme-var loop now checks only `--doctor-fg` and `--doctor-bg-strong`, plus an assertion that `--doctor-bg:` is absent; the rest rule literal and the hover-absence assertion are updated accordingly. `node tests/webui.test.ts` passes.
- Live-UI check both themes (fixture `/tmp/doctor-rest`, daemon on 127.0.0.1:4321 with isolated HOME and XDG_CONFIG_HOME, Playwright): a resting doctor card's computed border and background equal a resting run card's (dark: border rgb(27, 31, 41), bg rgb(20, 24, 33); light: border rgba(107, 125, 143, 0.12), bg rgb(255, 255, 255)), its text and check mark are the doctor blue; the opened card's border is the doctor blue and its background is the strong tint (dark rgba(89, 167, 255, 0.28), light rgba(47, 111, 221, 0.24)). Daemon stopped after the check.
- Commit 9eb72b7 on fix/232-doctor-rest-state.
- Review: 4/4 spec requirements pass, all from the diff of 9eb72b7 (rest rule `{ color: var(--doctor-fg); }` with the `:hover` override dropped, `.agent-doctor.agent-card-active` keeps the blue pair, `--doctor-bg` removed from the light, dark and prefers-dark blocks with `--doctor-bg-strong` kept, test assertions at the three pinned lines updated and the :927/:928/:930 lines still valid). Scoped suite `node tests/webui.test.ts` exit 0, all assertions passed. No fixes, no open questions; the live-UI acceptance is the Live-tester's run on the merged commit.

## Live test (2026-10-15T21:39Z, live-tester)
- Fixture `/tmp/lt232/repo` (one done task, one developer run log, one past doctor log slotted into the run's column) served by the merged worktree hub on 127.0.0.1:4341 with an isolated HOME; differential control: the pre-change hub (`9eb72b7~1 src`) on 127.0.0.1:4342 over the same fixture. Playwright, both themes, light first then dark via `#theme`.
- PASS: rest doctor card border and background equal the resting run card's (light border `rgba(107,125,143,0.12)` on `rgb(255,255,255)`; dark border `rgb(27,31,41)` on `rgb(20,24,33)`), so it reads as a plain resting card.
- PASS: rest doctor text and check mark are the doctor blue (light `rgb(47,111,221)`, dark `rgb(89,167,255)`); the check differs from the other runs' low-fg check (`rgb(134,179,0)` / `rgb(170,217,76)`).
- PASS: hovered doctor background equals the plain card hover (light `rgba(130,142,159,0.1)`, dark `rgb(27,31,41)`) with the border still plain, so the dropped `:hover` override inherits the `.agent-card` hover.
- PASS: the opened doctor card carries `.agent-card-active` with the blue pair (light border `rgb(47,111,221)` on `rgba(47,111,221,0.24)`; dark border `rgb(89,167,255)` on `rgba(89,167,255,0.28)`); its screenshot differs from its own rest screenshot while two rest screenshots are identical.
- PASS: the opened run card stays gold (light `rgb(242,151,24)` on `rgba(201,151,0,0.15)`; dark `rgb(230,180,80)` on `rgba(255,209,115,0.15)`), and the doctor card returns to the plain rest look when the run log opens.
- PASS: differential control. The pre-change resting doctor card is blue-outlined and blue-tinted (light border `rgb(47,111,221)` on `rgba(47,111,221,0.12)`; dark border `rgb(89,167,255)` on `rgba(89,167,255,0.15)`), the pre-fix look the task describes.
- PASS: served-artifact grep. `.agent-doctor { color: var(--doctor-fg); }` is the only rest rule, `.agent-doctor:hover` is absent, `.agent-doctor.agent-card-active` keeps the blue pair, `.agent-doctor .check` is blue; `--doctor-bg:` appears 0 times and `--doctor-bg-strong` 4 times (one definition in each of the 3 theme blocks plus the active rule); the unscoped `.agent-card` lines are byte-identical to the pre-change page.
- PASS: zero browser console or page errors. 50/50 Playwright checks, all first try.
- Assumptions: the reference "other resting card" is the doctor's own analysed run card in the same column; a past doctor (`.check`) is the fixture because the acceptance names the check mark; opened means the card carries `.agent-card-active` after a click. No behavior contradicts the task's stated assumptions. No findings, no open questions. Fixture and both hubs removed after the run.
