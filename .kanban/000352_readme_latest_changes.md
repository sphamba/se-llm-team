---
name: "docs: refresh README for the latest pipeline changes"
priority: "low"
state: "done"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "readme-latest-changes"
blockedBy: ""
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
- README.md is the only changed file outside `.kanban/`.

# Notes

## What changed
- README `~/.se-llm-team` paragraph now names `config.json`, `hub.json` and `hub.lock`, and keeps the `XDG_CONFIG_HOME`, override, merge and old-path facts.
- README `integrationTesting` row now states that off blocks both the merge-time task creation and a waiting `to-integration-test` start.
- README fade paragraph now states that `to-integration-test` cards fade while the gate is off and an in-flight `integration-testing` run keeps full opacity.
- README now states the complexity-to-priority mapping, the highest-covered rule and that a waiting integration task never loses priority on append.

## Acceptance
- `README.md` names `config.json`, `hub.json` and `hub.lock`: pass (grep README.md).
- `integrationTesting` row covers no new task AND no waiting start: pass (row text).
- Fade paragraph covers dimmed `to-integration-test` and full-opacity in-flight run: pass (paragraph text).
- Priority mapping, highest-covered and no-decrease rules present: pass (paragraph text).
- `reviews` and `liveTesting` rows checked against `pipeline.ts`: accurate, no edit. Defaults `true` match `config.ts:231-233`.
- `git diff --stat` after commit: 1 file changed (README.md). `git status --short` clean.

## Follow-up
- None. Tests skipped: complexity `trivial`, docs-only change.

### Live test 352: README refresh (docs-only, no process)

Tree: merged `8b04c82` (runtime tree `/home/phamba/repos/se-llm-team/.worktrees/docs/352-readme-latest-changes`), control `a44a129` (README pre-fix, no `.git`).
Driver: `/tmp/lt-352-harness/driver.mjs`. Wrapper: `/tmp/lt-352-harness/run.sh`. Merged runs: 3. Control runs: 1. Disagreement across merged runs: no. Saved pids: 0 (no process spawned; the change is prose only).

Assumptions: the change is documentation only, so the proof parses merged `README.md`, cross-checks each documented fact against the shipped code line named in the row, resolves every relative README link, and runs `git show --name-only HEAD` for the changed-file acceptance row. Substring checks are case-exact but whitespace-insensitive only in the sense that they are single-line fragments.

Not exercised: the daemon, web UI, CLI, MCP server and agent spawns. The change adds no command, route or config key, so a live process would not read the changed bytes.

| id | claim | expected (merged) | merged observed | control observed | verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | ~/.se-llm-team paragraph names config.json, hub.json and hub.lock | readme=3/3 code=2/2 | readme=3/3 code=2/2 | readme=0/3 code=2/2 | PASS |
| 2 | paragraph keeps XDG ignored, root override, key-by-key merge, old paths unread | readme=4/4 | readme=4/4 | readme=4/4 | PASS |
| 3 | integrationTesting row: off blocks merge-time creation AND holds a waiting task | readme=3/3 code=2/2 | readme=3/3 code=2/2 | readme=1/3 code=2/2 | PASS |
| 4 | fade paragraph: to-integration-test cards dim while off, in-flight run keeps full opacity | readme=2/2 code=1/1 | readme=2/2 code=1/1 | readme=0/2 code=1/1 | PASS |
| 5 | complexity-to-priority mapping trivial low, simple medium, moderate high, complex critical | readme=4/4 code=1/1 | readme=4/4 code=1/1 | readme=0/4 code=1/1 | PASS |
| 6 | highest covered priority wins | readme=1/1 code=1/1 | readme=1/1 code=1/1 | readme=0/1 code=1/1 | PASS |
| 7 | a waiting task never loses priority on append | readme=1/1 code=1/1 | readme=1/1 code=1/1 | readme=0/1 code=1/1 | PASS |
| 8 | reviews, liveTesting, integrationTesting rows and their default true match the code | readme=3/3 code=3/3 | readme=3/3 code=3/3 | readme=3/3 code=3/3 | PASS |
| 9 | README.md is the only changed file outside .kanban/ | 1:README.md | 1:README.md | (n/a: no .git in the archive) | PASS |
| 10 | every relative link in README.md resolves in the tree | links=11/11 | links=11/11 | links=11/11 | PASS |

Red proof: none. The control shows the pre-fix README, so rows 1, 3, 4, 5, 6 and 7 are pink by design on the control tree and green on the merged tree.

Verdict: PASS. Rows: 10. Cells checked: 40 (3 merged runs x 10 + control).
