# reviewer: role guidance

Method only. The spawn prompt owns the steps, the states, the task number, and the final text. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report a durable method change in the task's `# Notes`, never in this file or `AGENTS.md`.

## Open the run

- Write the mode line in the first reply: `first review` or `re-review of <sha>`, the claim set, and `test union: TBD after diff read`. Then one bash call: heading grep on `SPECS.md`, the base branch, `git log --oneline -6`, `git diff --stat "$b"...HEAD`, `git status --short`. Add `tool_search("kanban")` as a second call in that turn when the kanban tools are absent.
- Set `$b` from the base branch and quote it. Never write `HEAD...HEAD`. Put one `cd` at the start and keep one repository per call. Do not mix `git -C <repo>` with cwd-relative git commands in the same call.
- Choose the mode from that first stat, with no more git archaeology. A non-empty diff is a first review when `# Notes` has no reviewer block, and a re-review when it does. An empty diff with a clean tree is verify-only: read the Specs-named checks, run exactly those suites, read the Notes claims and the dependency commits, and do not inspect branches, remotes, or reflog to explain the empty diff. A re-review reads only the tail of `# Notes` and the fix commit, and first-pass evidence stands.
- Read the task body once with one ranged `read`: start at `# Summary` from the heading grep and read to EOF. Settle `# Open questions` on that read: delete a question that the Specs answer and keep a real product decision. A missing or empty section is normal. Never create the heading and never grep for it again. The spawn prompt is the only source for the states, their order, and the final text, so never read another task file, a skill, or a role file to confirm pipeline semantics. The prompt wins.

## Read the diff and the scope

- Use one diff call per area: `git diff "$b"...HEAD -- <files from --stat>`, and end each call with `; echo ---; rg -n '<changed symbols>|<new test names>' <changed files> <test file>`. Every `file:line` in the verdict must come from this printed output. Read changed hunks only, never page a file: get the line with `rg -n`, then one window of 40 lines or less with `read` offset/limit or `sed -n 'A,Bp'`.
- When the Specs judge a merged blocker or another commit, read that commit's diff first: `git show <sha> -- <path>`. It usually answers the claim in one command and removes the need for a probe.
- A probe must call the same entry point with the same input shape as production. For a renderer, parser, or log path, build the real record or fixture, never a plain string. When a probe disagrees with the Notes, suspect the probe before the claim, and correct the input shape instead of adding probes.
- Cap a design detour at one command plus one corrected probe. If a hypothetical parser, race, or stale path is not named by a Specs line and not touched by a changed line, write one non-blocking note or nothing. Do not trace import graphs, pid files, or cycles. Rendering and timing belong to the live tester.
- One command settles one claim. When the printed output answers the claim, write the finding and stop. Do not re-grep a log or re-read a file to confirm a green result. A second Specs-to-code pass is not a review method. Decide a nit once as one non-blocking `# Notes` line with an upgrade path, and never fix it in this pass, because a code edit sends the task back to to-review.
- When two Specs lines cannot both hold, treat it as a non-blocking finding plus one `# Open questions` line when the choice is a product decision. State the current behavior and both options, then stop. Do not re-derive the ruling in a later turn.

## Choose and run the tests

- Write the union as one line at the first diff read: the suites the diff touches and the suites the Specs names. Nothing else. Add a caller suite only when the edit changes an exported signature, an arity, or an observable side effect such as I/O, state, or a thrown error. A changed returned string that the owning suite already pins is not a caller-suite trigger. When the Specs say a named suite needs no change, that is settled. Never widen the union after a green run. For a verify-only task the union is exactly the Specs-named suites.
- Coverage map: `src/orchestrator/*` and `src/pid.ts` -> `tests/orchestrator/*`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts` and `tests/tools.test.ts`, and `src/tools.ts` also to `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts`, and `src/hub.ts` -> the `tests/webui/` suites that the diff touches, and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers. These paths exist, so do not run `ls` or `test -f` to check one.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test` or `npm test`. Chain `tests/webui/{page,board}`, `tests/webui/logpane`, and `tests/kanban/{attributes,blockedby,git,naming,taskfile}` in one call. Run suites that spawn children or daemons in groups of 3 to 5: `tests/orchestrator/*`, `tests/webui/{hub,agentlog}`, and `tests/kanban/locking`. Print `start <suite>` and `exit=<code> <suite>` for each suite in the same call, because the verdict quotes those lines. If a union path does not exist, print `MISSING <path>` in the run loop and continue. After a green run, the next action is the verdict.

## Write the verdict

- Build the block in one turn: one verdict line, at most four evidence lines with a printed `file:line` each, one test line with exit codes, and one line per non-blocking note. Start a first pass with `Review of <sha> (first pass):` and a re-review with `Re-review of <sha>:`. Add no heading of any level. Do not restate the Specs, the diff, or an earlier pass.
- Append at the end of `# Notes`, before `# Open questions` when that heading exists, and at EOF when it does not. Use this recipe, then prove it with `tail -8 SPECS.md`. Do not use `edit` and do not read the file again.

  ```python
  python3 - <<'PY'
  import re
  p = "SPECS.md"
  s = open(p, encoding="utf-8").read()
  b = """<review block>"""
  m = re.search(r"(?m)^# Notes\s*$", s)
  j = re.search(r"(?m)^# Open questions\s*$", s[m.end():])
  i = m.end() + j.start() if j else len(s)
  open(p, "w", encoding="utf-8").write(s[:i].rstrip("\n") + "\n\n" + b + "\n\n" + s[i:])
  PY
  tail -8 SPECS.md
  ```

- A red proof is owed only for behavior that this pass changes. With no source edit, cite the pass result and run nothing. With a source edit, use one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the log for the failure class, restore, then `git status --short`. Commit only when you edited code.
- The tail has one order: append the findings, commit only if you edited code, `tool_search("kanban")` once if the tools are still not loaded, `kanban_get({})`, `kanban_set_state`. The `kanban_get` is the last call before the move and the only one. Only its `state` field matters, and it must match the state from the start. The final text is exactly `Moved #<nn> to <state>.`

## Repo facts and shell traps

- Repo facts: `package.json` has only `test` and `test:changed`, so there is no typecheck or lint, and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim and the modules are under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. `tests/helpers.ts` exports its cleanup helpers as `export const`, and `cleanupAll` is idempotent. In a worktree `AGENTS.md` is a symlink to one role file, not a pipeline document.
- Symlinks: `.kanban/`, `SPECS.md`, and `AGENTS.md` are symlinks into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored, so `git status` and `git add` never show a task-file edit. Prove an append with `tail`, not with git.
- Shell traps: a grep with no output is not an absence. Drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same block. When `# Notes` cites `file:line`, read that window before you doubt the claim. Never grep a quoted phrase from a comment, because comments wrap across lines. End a chain with `echo exit=$?`, and add `|| true` only for an absence claim. Inspect a file with `read` or a narrow `sed` window, and anchors with `rg -n`. A tool call must carry its full required arguments. If the stream fails (`Unterminated string in JSON`), re-emit the same call on the retry instead of re-deriving the verdict.
