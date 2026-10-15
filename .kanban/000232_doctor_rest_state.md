---
name: "fix: doctor cards at rest look opened"
priority: "medium"
state: "reviewing"
worktree: "fix/232-doctor-rest-state"
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
