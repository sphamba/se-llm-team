---
name: "docs: refresh README for the latest pipeline changes"
priority: "low"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "readme-latest-changes"
blockedBy: "#350, #351"
---

# Summary
README does not reflect the four latest delivered tasks. Document the integration gate hold behavior, the integration task priority rule, the ~/.se-llm-team files including hub.json and hub.lock, and the stage fade including dimmed to-integration-test cards.

# Specs
## Scope

README.md only, and only the content of the four latest delivered tasks (#346 stage toggles, #347 `~/.se-llm-team` config paths, #348 stage fade, #349 integration priority) plus the two fixes #350 and #351 that this task documents. This is not a general README cleanup. The user explicitly excluded the wider audit items (CLI flags, extra config rows, `docs/development.md` npm commands, other docs).

## Needs

- **`integrationTesting` gate row (`README.md:129`):** state the full scope. Off means a merge opens no new integration task AND a task already waiting in `to-integration-test` never starts, so it stays there until the gate is on again. Do not describe only the merge-time creation hook.
- **Stage fade paragraph (`README.md:134`):** state that both columns of a disabled stage fade, and that the cards in `to-integration-test` fade too while `integrationTesting` is off. State that a run already in `integration-testing` keeps full opacity until it finishes. Replace the current claim "Task cards keep full opacity", which #350 makes false for that one column.
- **Integration task priority rule:** add it next to the integration gate description or the fade paragraph, as one short paragraph or two bullets. The rule: the auto-created integration task takes the priority of the tasks it covers, trivial `low`, simple `medium`, moderate `high`, complex `critical`; the highest covered priority wins; while the task waits, an append never lowers it. This is the only missing #349 fact.
- **`~/.se-llm-team` paragraph (`README.md:97`):** name the three fixed files: `config.json`, `hub.json` and `hub.lock`. Keep the existing facts: `XDG_CONFIG_HOME` is ignored, `se-llm-team.json` at the project root overrides the global file, nested objects merge key by key, and the old paths are not read.
- **Verify the other three gate rows (`reviews`, `liveTesting`, `integrationTesting`) and their default `true`** against `src/orchestrator/config.ts:231-233` and the skip semantics in `src/orchestrator/pipeline.ts`. Correct any drift you find in those rows.
- Keep the README tone and structure. No new top-level section, no screenshot, no command reference. At most a short subsection or a few bullets near the existing configuration table.

## Constraints

- Documentation only. Do not change `src/`, tests, `docs/architecture.md`, `docs/development.md`, `TODO.md` or `skills/se-llm-team/SKILL.md`.
- Do not restate the whole integration task lifecycle (creation hook, title format, `## Covered tasks` rebuild, single slot, report-only). Those facts are out of scope for this task.
- Do not add the missing config keys `backlogIdleMinutes`, `retryIdleMinutes`, `roles.*.concurrency`, `.mergeThreshold`, `.maxNotesBullets`, nor CLI flags or env vars.
- Do not rewrite sentences that are already accurate.
- Line numbers in this Specs are anchors from today. Adapt if #350 or #351 moved them. This task runs after both.

## Acceptance

- README.md names `config.json`, `hub.json` and `hub.lock` in the `~/.se-llm-team` paragraph.
- The `integrationTesting` row says that off means no new integration task AND a waiting `to-integration-test` task does not start.
- The fade paragraph says the `to-integration-test` cards dim while the gate is off and an in-flight `integration-testing` run keeps full opacity.
- README.md states the complexity-to-priority mapping for integration tasks, the highest-covered rule, and that the priority never decreases while the task waits.
- `git diff --name-only` lists `README.md` only.

# Notes
