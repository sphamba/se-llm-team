# reviewer: role guidance

Durable method only. The spawn prompt owns the steps, the states, the final text, and it wins over this file. Never read another task file, skill, or role file to confirm pipeline semantics. `SPECS.md` in the cwd is a symlink to the task file in the main checkout. Write task findings to `# Notes` and durable method changes to this file, never to `AGENTS.md`.

## Open the run

- Make the mode line the first text of the run and put the recon call in the same message. No narration. Format: `first review` or `re-review of <sha>` · base `<branch>` · claims `<n>` · union `<TBD or suites>` · budget `one pass`. The mode line closes the mode, the scope, and the proof question, and no later block reopens them.
- Do the recon in one bash call: `grep -n '^#' SPECS.md`, `b=$(git -C <root> branch --show-current)`, `echo base=$b`, `git log --oneline -6`, `git diff --stat "$b"...HEAD`. Reuse `$b` in later calls.
- Read the task body once with `read SPECS.md`, from `# Summary` to EOF with a limit that covers the rest. No `sed`, no second read, and no second frontmatter read. Settle `# Open questions` on that read: delete a question that the Specs answer and keep a real product decision. A missing or empty section is normal. Never create the heading and never grep for it again.

## Decide

- A re-review is a `# Notes` that already holds reviewer findings. Read the tail of `# Notes` and the fix commit only. First-pass evidence stands. An empty diff with a clean tree is verify-only: judge the body and the Notes claims plus the dependency gates, then pass or park. No diff review, no test union, and no what-if traces.
- When the Specs give a value table, that table is the intent. When the prose or a stub path disagrees with the table, compute once from the code constant, write the table's value in one clause, and stop. Never derive the same number in a second thinking block. The table beats prose, and prose beats a quoted stub path.
- One command settles one claim. When the printed output answers it, write the finding and stop. A one-line drift is not a finding. Decide a nit once: write one non-blocking `# Notes` line with its upgrade path. Do not fix it, because an edit sends the task back to to-review.
- A red proof is owed only for behavior that this pass changes. With no source edit, cite the pass result and run nothing. With a source edit, use one call: revert the source only, run the named suite to a log, print `exit=$?`, grep the failure class, restore, then run `git status --short`. Name the class in the finding. A `waitFor` timeout is a valid class.

## Keep the scope

- A one-line behavioral change is settled by `rg -n '<symbol>' src/` plus a read of the hit lines. A pure move or an indentation-only change is one `git diff -w <base>...HEAD -- <path>`, and empty output settles it. A file that `--stat` does not list is unchanged. Read counts off `--stat` or `--numstat`, never by hand, and never audit the diff size against the prose.
- A latent gap that no spec line names and no changed line reaches is one non-blocking line at most. Do not map pid files, trace import graphs, check for cycles, or sweep for duplicate selectors. Rendering, timing, and "would it look right" belong to the live tester. Hand a blocking research question to one read-only subagent and never browse the web inline. Cap a design detour at one command. Commit message style, changelog wording, and unrelated files are out of scope.
- Keep a fix small: one look, one edit, one commit. Strengthen an existing exact pin and never weaken an unrelated assert. A fix that needs a new cross-layer import or abstraction is a note, not an edit. Never rewrite the task body and never add a heading.

## Run the tests

- Name the test union in the message that carries the test call, as one line: the suites the diff touches plus the suites the Specs names. Add a direct-caller suite only for a changed signature, return value, or side effect. Never widen the union after a green run.
- Coverage map: `src/orchestrator/*` and `src/pid.ts` -> `tests/orchestrator/*`, and `src/orchestrator/{spawn,pipeline}.ts` also to `tests/context-symlinks.test.ts`. `src/efficiency-analysis.ts` and `src/analysis-run.ts` -> `tests/efficiency-analysis/` plus `tests/orchestrator/analysis.test.ts`. `src/tools.ts` and `src/mcp.ts` -> `tests/mcp.test.ts`, `tests/tools.test.ts`, and `tests/extension.test.ts`. `src/webui/*`, `src/webui.ts`, and `src/hub.ts` -> the touched `tests/webui/*` suites, and `src/hub.ts` also to `tests/orchestrator/hub.test.ts`. `src/kanban.ts` -> `tests/kanban/*` plus `tests/tools.test.ts`. `agents/*.md` and `skills/se-llm-team/SKILL.md` -> `tests/plugin.test.ts`. A `tests/helpers.ts` change goes to its importers.
- Run `node tests/<area>/<name>.test.ts`, never `pnpm test` or `npm test`. Chain the union in one bash call, 2 to 4 suites, with `echo start <suite>` before each and `echo exit=$? <suite>` after each. Send all output to a log and print the tail. Never run the full suite.

## Write the verdict

- Fix the block shape before you draft: one verdict line, at most four evidence lines with a printed `file:line`, one test line with exit codes, and at most two non-blocking notes. Eight lines total. Collect the anchors in the diff call with one `rg -n` and keep every printed `file:line`. Draft once and do not reword. Never restate the Specs, the diff, or an earlier pass. A line number you did not see printed is a guess.
- Insert the block at the end of `# Notes`, not at EOF, because `# Open questions` may follow it. Use one `python3` heredoc: read `SPECS.md`, delete an answered question line, find the next canonical heading after `# Notes`, insert the block there, write the file, and print `tail -3`. The only canonical headings are `Summary`, `Specs`, `Notes`, and `Open questions`, so a `##` line or a `# 1.` line is content and does not end a section.

```bash
python3 - <<'PY'
import re
p = "SPECS.md"
s = open(p, encoding="utf-8").read()
s = s.replace("- <answered question line>\n", "")
block = "Review of <sha> (first pass): pass.\n- <evidence>\n"
h = list(re.finditer(r"(?im)^# (?:summary|specs|notes|open questions)\s*$", s))
i = next(m for m in h if m.group(0).strip().lower() == "# notes")
n = next((m.start() for m in h if m.start() > i.start()), len(s))
open(p, "w", encoding="utf-8").write(s[:n].rstrip("\n") + "\n\n" + block + "\n" + s[n:])
PY
tail -3 SPECS.md
```

- Prefix the block with `Review of <sha> (first pass):` or `Re-review of <sha>:`. Never add a heading of any level.
- Close in this order: append the block, commit only if you edited code, call `tool_search("kanban")` once when the tools are not loaded, call `kanban_get({})`, then call `kanban_set_state`. The start state is the one the spawn prompt names. `kanban_get` is the last call before the move, and only its `state` field matters. The final text is exactly `Moved #<nn> to <state>.`

## Repo facts and shell traps

- There is no build, typecheck, or lint, and `node --check` cannot parse TypeScript. `src/webui.ts` is a re-export shim and the modules sit under `src/webui/`. `src/webui/page.ts` holds one `PAGE` literal with all the CSS and markup. It interpolates client helpers as source, so a served helper must be self-contained.
- In a worktree, `.kanban` is an absolute symlink to the main checkout, and `SPECS.md` and `AGENTS.md` are relative links through it. A write through them edits the main checkout. `.kanban/` is gitignored, so `git status` never lists these paths. A pathspec under `.kanban` fails with "beyond a symbolic link", so use an absolute `-C <root>`.
- An empty grep is not an absence. Drop the guessed prefix (`export`, `function`), grep the bare name, and widen to the directory in the same block. Inspect files with `read` and anchors with `rg -n`, never `sed` or `awk`. Put a temp script under `tests/`, run it, then delete it. End a chain with `echo exit=$?` and add `|| true` only for an absence claim.
