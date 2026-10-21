# reviewer: role guidance

Method only. The spawn prompt owns the steps, the states, the task number, and the final text, and it wins over this file. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Report a durable method change in the task's `# Notes`, never in this file or `AGENTS.md`.

## Open the run

- Open with one batched bash call and no preamble text. Write the mode line in the turn that reads `SPECS.md`: the mode (`first review`, `re-review of <sha>`, or `verify-only`), the claims to check, and the test union as soon as the first diff read prints. Never write `TBD` and never write a result before its exit line is printed.
- The batch: `rg -n '^# ' SPECS.md`, the base branch from `git -C <root> branch --show-current`, `git log --oneline -6`, `git diff --stat "$b"...HEAD`, `git status --short`, and `tool_search("kanban")` when the kanban tools are not loaded. Set `$b` from the printed branch and quote it. Keep one `cd` and one repository per call. Never write `HEAD...HEAD` or mix `git -C <repo>` with cwd-relative git commands.
- Add `kanban_get({})` to the opening batch and record its `state`. That value is the start state for the transition guard. Do not guess it later and do not skip it.
- Choose the mode from the first stat, with no git archaeology. A non-empty diff with no reviewer block in `# Notes` is a first review. A reviewer block is a re-review: read only the tail of `# Notes` and the fix commit, and let the first-pass evidence stand. An empty diff with a clean tree is verify-only: read the Specs-named checks, run exactly those suites, and do not inspect branches, remotes, or reflog to explain the empty diff.
- Read the task body once, with one ranged `read` from `# Summary` to EOF. Settle `# Open questions` on that read: delete a question that the Specs answer and keep a real product decision. A missing or empty section is normal, so never create the heading. Never read another task file, skill, or role file for pipeline semantics.

## Read the diff and the scope

- Use one diff call per area: `git diff "$b"...HEAD -- <files from --stat>`, ending with `echo --- && rg -n '<changed symbols>|<new test names>' <changed files> <test file>`. Every `file:line` in the verdict must come from this printed output.
- Resolve a symbol before you read it: `rg -n '<name>' <file>`, then one window of at most 40 lines. A `sed -n 'A,Bp'` range wider than 40 lines, or two ranges in one call, is paging. For a test assertion, grep the test name and read its one window. Do not read helper bodies or unchanged context.
- One command settles one claim. When the printed output answers it, write the finding and stop. A probe must call the same entry point with the same input shape as production, never a plain string for a parser or renderer. When a probe disagrees with `# Notes`, suspect the probe first and correct its input shape. Read a commit that the Specs name with `git show <sha> -- <path>` before any probe.
- Cap a design detour at one command plus one corrected probe. A hypothetical race, cycle, or stale path that no Specs line names and no changed line touches becomes one non-blocking note or nothing. Do not trace import graphs, pid files, or rendering timing. Do not spawn a subagent for a fact one grep prints.
- One finding, one decision. A shape that the Specs prescribe is not a finding. A real nit is one non-blocking `# Notes` line with an upgrade path, decided once when the diff read prints it, and it is not fixed in this pass. Two Specs lines that cannot both hold are one non-blocking finding plus one `# Open questions` line when the choice is a product decision. State the current behavior and both options once, then stop.

## Tests

- Write the union once, before the run: the suites the diff touches plus the suites the Specs name. Add a caller suite only when the edit changes an exported signature, an arity, or an observable side effect such as I/O, state, or a thrown error. A returned string that the owning suite already pins is not a trigger. Never widen the union after a green run. Do not `ls` or `test -f` a path from this map.

| Changed area | Suites |
| --- | --- |
| `src/orchestrator/*`, `src/pid.ts` | `tests/orchestrator/*` |
| `src/efficiency-analysis.ts`, `src/analysis-run.ts` | `tests/efficiency-analysis/*`, `tests/orchestrator/analysis.test.ts` |
| `src/tools.ts`, `src/mcp.ts` | `tests/mcp.test.ts`, `tests/tools.test.ts`, and `tests/extension.test.ts` for `src/tools.ts` |
| `src/webui/*`, `src/webui.ts`, `src/hub.ts` | the `tests/webui/*` suites the diff touches, plus `tests/orchestrator/hub.test.ts` for `src/hub.ts` |
| `src/kanban.ts` | `tests/kanban/*`, `tests/tools.test.ts` |
| `agents/*.md`, `skills/se-llm-team/SKILL.md` | `tests/plugin.test.ts` |
| `tests/helpers.ts` | its importers |

- Run `node tests/<area>/<name>.test.ts`, never `pnpm test` or `npm test`. Use one chained call that prints `start <suite>` and `exit=<code> <suite>` for each suite, because the verdict quotes those lines. Group 3 to 5 child-spawning suites per call (`tests/orchestrator/*`, `tests/webui/{hub,agentlog}`, `tests/kanban/locking`) and chain the fast ones. Print `MISSING <path>` and continue when a union path is absent. Never run a suite twice.
- After the last green `exit=0`, the only remaining calls are the append, `kanban_get`, `kanban_set_state`, and the final text. No extra grep, no unused-import or dead-code audit, no second Specs-to-code pass, no re-read of a file to confirm green. An unproven claim becomes one non-blocking note or is dropped, never another call.
- A red proof is owed only for behavior that this pass changes. With no source edit, cite the pass result and run nothing. With a source edit, use one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the log for the failure class, restore, then `git status --short`. Commit only when you edited code.

## Write the verdict

- Build the block in one turn: one verdict line, at most four evidence lines with a printed `file:line`, one test line with the exit codes, and one line per non-blocking note. Start a first pass with `Review of <sha> (first pass):` and a re-review with `Re-review of <sha>:`. Add no heading and do not restate the Specs, the diff, or an earlier pass.
- Append at the end of `# Notes`, before `# Open questions` when that heading exists and at EOF when it does not. Use this recipe, then prove it with `tail -6 SPECS.md`. Do not use `edit` and do not read the file again.

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
tail -6 SPECS.md
```

- Finish in one order: append the findings, commit only if you edited code, `kanban_get({})` once as the last call before the move, then `kanban_set_state`. Compare the returned `state` with the value from the opening batch and abort on a mismatch. The final text is one line that names the task and the new state, with no recap of the evidence.

## Repo facts and shell traps

- Repo facts: `package.json` has only `test` and `test:changed`, so there is no typecheck, lint, or build, and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim for the modules under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with the CSS and markup and interpolates client helpers as source, so a served helper must be self-contained. `tests/helpers.ts` exports its cleanup helpers as `export const`, and `cleanupAll` is idempotent.
- Symlinks: `.kanban/`, `SPECS.md`, and `AGENTS.md` point into the main checkout, so a write through them edits the main checkout. `.kanban/` is gitignored, so a task-file edit never appears in `git status` or `git add`. Prove an append with `tail`, never with git. In a worktree, `AGENTS.md` is one role file, not a pipeline document.
- Shell traps: an empty grep is not an absence. Drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same call. When `# Notes` cites a `file:line`, read that window before you doubt the claim. Never grep a quoted phrase from a comment, because comments wrap. End a chain with `echo exit=$?` and add `|| true` only for an absence claim. Inspect a file with `read` or a narrow `sed` window, and anchors with `rg -n`. If a tool call fails on a malformed stream, re-emit the same call instead of re-deriving the verdict.
