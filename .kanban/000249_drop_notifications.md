---
name: "chore: drop the browser notifications feature"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "drop-notifications"
---

# Summary
Remove the #244 browser notifications feature entirely: the state-change notification diffing, the header opt-in control, and the webUi.notifications persistence, on top of current HEAD.

# Specs
Decision (user, 2026-10-16): drop the #244 browser notifications feature. The user's complaint batch made the webui unusable and the notifications are part of what goes.

Requirements:
1. Remove the notification diffing, the header opt-in control and the webUi.notifications persistence from src/webui/page.ts (the feature shipped in commit 41d8073; remove it on top of current HEAD, which also carries #245/#247 follow-ups).
2. No notification UI, no Notification permission prompt, and no webUi.notifications config key remain.
3. Keep the rest of the page unchanged: theme toggle, staleness wake check (#235), and all #242-#245 features stay.

Acceptance:
- node tests/webui.test.ts passes.
- Live test: no notification control remains in the header and no browser notification fires on task state changes.

# Notes

- Dropped the #244 browser notifications feature on top of HEAD (aafd334): removed the #notify header control, the Notification permission prompt and client code, the stateChanges poll diff, the refresh state-change loop, the WebUiConfig.notifications key, the webUi.notifications config load, and the single-project fallback label that existed only to title the notification. src/webui/index.ts no longer exports stateChanges.
- tests/webui.test.ts: removed the #244 pins (config default, #notify / requestPermission / document.hidden, the stateChanges diff block, the named single-project fallback, the config key) and added two negative pins: the served page has no id="notify" and no Notification reference. node tests/webui.test.ts passes: red first at the missing-control assert, then green.
- Live check: a fixture daemon (/tmp/drop-notif, port 4399, isolated HOME and XDG_CONFIG_HOME) served / with id="theme" and no id="notify"; a Playwright run with a stubbed Notification (permission granted) and document.hidden forced true counted 0 Notification calls across a done to to-review state change that reached /api/tasks.
- AGENTS.developer.md: replaced the #244 browser-notification facts bullet with a #249 note (do not reintroduce) and removed the #244 browser-notification live-check recipe.
- Re-review at aafd334: pass. Req 1: the diff removes WebUiConfig.notifications, the loadWebUiConfig read, the #notify button and its CSS, toggleNotify/syncNotifBtn/notifyChange, the stateChanges function and export, the refresh state-change loop, and the single-project fallback label. Req 2: grep of src/ is clean (remaining notify hits are the unrelated tools/mcp callback and inotify comments). Req 3: the diff touches only notification code; tabsHtml renders no bar below 2 tabs, so the fallback-label change is inert. Acceptance: node tests/webui.test.ts exit=0; live check recorded above. Moved to to-merge.

## Live test (2026-10-16)

- Fixture (/tmp/lt249): two hub-only roots with one task (000001_probe.md, state to-do, "Notification probe") and a project config that carries webUi.notifications: true. Merged hub aafd334 on port 4350, control hub 19e7853 (parent, git archive src) on port 4351, isolated HOME and XDG_CONFIG_HOME per hub.
- Merged hub, 19 checks, 0 failed. Served /: id="theme" is present, id="notify" is absent, and the page never mentions Notification, requestPermission, the "notifications" localStorage key or stateChanges. The header holds only the theme button.
- Merged hub, loadWebUiConfig with the notifications key in the project config returns {enabled, host, port} with no notifications key and still reads the port.
- Merged hub, browser run: Notification stub with permission granted, document.hidden true and localStorage notifications=on. A to-do to to-review change reached the page (the card moved to the c-to-review column) and fired 0 Notification calls and 0 permission prompts. The theme toggle still flipped light to dark and persisted.
- Control (parent 19e7853) under the same fixture and harness, 12 checks, 0 failed: the same state change fired exactly 1 notification, "lt249-old: #1 Notification probe" / "New state: to-review". The control proves the harness fires the old path, so the merged 0 is the removal of the feature and not a silent harness failure.
- Assumptions: the acceptance does not name a state pair, so the test used to-do to to-review, the hidden-tab class of move that the old feature served. The test treats the served page plus a live state change as the whole interface of the removed feature. No behavior contradicted the task's stated assumptions.
- Technical difficulty: the first browser run of the merged check died with "Target crashed" (known memory pressure). A rerun with a fresh browser and the same script passed. Not a product finding.
- No open questions for the user.