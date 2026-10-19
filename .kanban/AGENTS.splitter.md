# Splitter project guidance

## Resolving the task file (kanban mechanics)

The cwd `SPECS.md` is a symlink into the board's `.kanban/` directory, and creating subtasks can re-point that symlink at a freshly created subtask. A fileless `kanban_update`/`kanban_set_state` run after `kanban_create` can therefore silently target — or clobber the Summary, Specs and complexity of — the wrong task. Resolve the parent file name once at the start (`readlink SPECS.md`, `ls -l SPECS.md`) and pass that explicit file to every `kanban_update` and `kanban_set_state`. A rejected update is atomic, so verify current state with `kanban_get` before retrying.

Before minting subtasks, re-list the board (`.kanban/`, `kanban_list` across scopes) for existing sibling subtasks of the same parent; two Splitter sessions working one parent is a real race. If a decomposition already exists, adopt it or delete your duplicates with `kanban_delete` — never stack a second decomposition.

`kanban_create` and `kanban_delete` commit whole-board mirror snapshots under `meta/kanban`, so `git show <create-commit>:.kanban/<file>.md` restores that task's original frontmatter (complexity included) and body; pass complexity back in the restore update, not only Summary/Specs.

A parent moved to backlog may carry a worktree attribute the daemon set in anticipation of the Developer. Check with `git worktree list` whether it is real; a stale attribute on a verification parent is safe to clear with `kanban_set_worktree ""`.

## Split-decision rules

A split only parallelizes when a piece can own a disjoint file range or produce only new files. Count-of-changes is not parallelism: pieces that share a source file, form an import pair, or land in one contiguous CSS block or test-pin region serialize at merge.

- Shared contract, two sides: pin the contract verbatim in BOTH subtasks — exact path, query params, response shape, error cases, or an already-exported helper/convention the consumer can inline — so merge order does not matter. State in the consumer's Specs that an expected pre-merge failure (a 404, a failing test) is expected and must not be fixed. The parent becomes verification-only, blocked by both subtasks.
- Import pair: do not split producer/consumer when the consumer does not compile or run until the producer merges. Check the import graph between the two files AND whether the consumer's runtime behavior (not just its types) needs the producer's change — tests can fail silently on a missing field rather than at compile time.
- Shared test files: `tests/webui/` is split into per-area files (agentlog, board, hub, logpane, page); subtasks that both add asserts to the same area file conflict at merge, so split a test file only along disjoint ranges or into new files. When both subtasks must add asserts, pin a distinct anchor per subtask (extend the fixture block one naturally belongs to; append at the end before cleanup) and pin the per-file assertion baseline (`grep -c "assert\."`) in every subtask's Specs and the parent's verification Specs so reviews catch dropped assertions mechanically. Rule for both: never edit the shared import lines, add a NEW import line for new exports.
- Shared support files: attach ALL shared support files (`tests/helpers.ts`, `package.json`, `scripts/test-changed.mjs` and its test) to ONE subtask with a glob-based contract that tolerates the other areas not having landed yet; the other subtasks never touch them, so merges stay trivial. A subtask whose worktree sees the full suite fail until the glob loop lands should say so in its Specs ("expected, do not fix; your check is per-file standalone runs").
- Destructive step: when a split task owns the destructive step itself, make every subtask produce ONLY new files (never edit the old file or any shared file) and let the PARENT delete the old file at verification. Subtasks then own disjoint old-file ranges with zero shared writes and trivial merges. Do not split a continuous fixture run further: state is written and removed in sequence.
- Facade files: a module may be a facade that only re-exports; the real definition may live elsewhere. Resolve every facade re-export to its real file before pinning file ownership in subtask Specs.
- Helper placement: a helper consumed by `kanban.ts` (`listTasks`) or `tools.ts` must live in `kanban.ts`, NOT in an orchestrator logging module that imports the kanban dir back — that would cycle. A `kanban.ts`-owned helper is importable by `tools.ts`, `report.ts` and orchestrator modules with no new wiring. A Scope-union extension is additive-safe: `kanban_list` in `src/tools.ts` is the only consumer (the webui does not use `listTasks`).
- Record pins: a suite that pins the exact `TOOLS` names array means any subtask adding a tool to the TOOLS record MUST extend that array in the same subtask, or its tests fail. Pin this in the tool subtask's Specs.
- Prompt byte-pins: grep the suites for byte-pins of any shipped prompt before minting — the pins decide which subtask owns which test file.
- Prompt + notes bundles: a task that rewrites several role prompts and also distills the matching role-notes files splits per role bundle, pairing each prompt edit with its own notes distill in the same subtask. The notes files are untracked shared board files, so a distill-only subtask has an empty deliverable commit and nothing for its merger to merge. Balance bundles by input bytes and bundle trivial roles together; do not append to a notes file while a sibling subtask distills it.

## Client-testability conventions

Keep client-testable logic as exported doc-injected functions in `board.ts` (inject storage the same way), interpolated into the page template like the sync helpers; client flow written directly inside the page template is not directly testable. `page.ts` only wires handlers and CSS. There is no payload-specific test file: payload/doctor-history and aliveness tests live in the `tests/webui/` area files, so any task touching the payload module conflicts at merge with one touching `page.ts`/`board.ts` tests — count that in every split decision.

## Shell recipes

Run `pnpm test` for the full suite and `pnpm test:changed` for touched files only.
