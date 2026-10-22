---
name: "feat: the webui fades the columns of a disabled pipeline stage"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "webui-fade-disabled-stages"
---

# Summary
The dashboard dims both columns of a pipeline stage that the daemon turned off. The stage flags travel with the daemon registration and refresh on every heartbeat. Task cards keep full opacity. Delivered on main in commit e19068f.

# Specs
## Delivered

Commit e19068f, on main at HEAD.

## Needs

- New type `StageFlags` (src/orchestrator/config.ts:60).
- The hub entry and the hub options carry the flags (src/hub.ts:21, :29).
- `parseStageFlags` reads the flags. A field is on unless it is exactly `false`. Any other value gives `undefined`, thus no fade (hub.ts:105-110).
- The daemon sends the flags in `/register` and refreshes them in `/heartbeat` (hub.ts:273-278, :288-301, :399, :413; src/orchestrator/main.ts:158). A restarted daemon updates an old registry entry.
- `applyStages(cols, stages)` sets the class `off` on both columns of a disabled stage (src/webui/board.ts:299-310):
  - reviews: to-review and reviewing
  - liveTesting: to-live-test and live-testing
  - integrationTesting: to-integration-test and integration-testing
- The CSS `.col.off` dims the chrome to 40% and sets the heading, the empty text and the toggle to opacity .4 (src/webui/page.ts:134-136).
- No card fades. A `.col.off .card` rule must not exist.
- A hub entry with no `stages` never fades.
- `/api/projects` serves the flags. A failed request keeps `DEFAULT_STAGES`, which is all on.
- README.md:134 names the fade.

## Constraints

- The fade is cosmetic. It does not block a stage start and does not stop a waiting task.
- `to-merge` and `merging` have no gate and never fade.
- docs/architecture.md does not describe the fade. This is out of scope of this change.
- `color-mix(in srgb, ...)` needs a recent browser.

## Acceptance

- `node tests/webui/board.test.ts` exits 0. It pins the `off` map, the all-on restore, the shipped `applyStages` source, both CSS strings, the absent `.col.off .card` rule and the `stages` carry in `tabNames`.
- `node tests/webui/page.test.ts` exits 0. It pins the `/api/projects` flags and the default tab.
- `node tests/orchestrator/hub.test.ts` exits 0. It pins the register key set, the register store and the heartbeat refresh.
- `node tests/orchestrator/stages.test.ts` exits 0.
- `pnpm test` exits 0.

# Notes
