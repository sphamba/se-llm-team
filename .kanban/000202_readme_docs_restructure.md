---
name: "docs: simplify README to install and config; move the rest into docs/"
priority: "medium"
state: "done"
worktree: ""
issuer: "user"
complexity: "trivial"
shortName: "readme-docs-restructure"
---

# Summary
Rewrite README.md so it keeps the intro pitch, a new short Usage section, Setup (install) and Configuration, plus a Documentation links section. Move every other section verbatim into a new docs/ directory with three grouped files: architecture.md, agents-and-tools.md and development.md. Update the one live-tester recipe that greps README.md.

# Specs
## Need

Simplify README.md for a user. The README keeps: the intro pitch, a short Usage section, Setup (install), Configuration, and a Documentation links section. Everything else moves into a new docs/ directory with three grouped files.

## README.md (rewrite)

Keep exactly these H2 sections, in this order:

1. `Setup` — the existing install content verbatim: `pi install git:github.com/sphamba/se-llm-team` plus the local-dev symlink install. The config JSON example and the key/default table move out of Setup into the new Configuration section.
2. `Using it` — new, a few lines only: start pi in a project, the se-llm-team skill makes the session the Project manager, the kanban tools drive the board, `orchestrator_start` runs the daemon, and the orchestrator sends board reports to the chat. A teaser only; link to docs/ for the mechanics.
3. `Configuration` — the existing config JSON example and the full key/default table, verbatim.
4. `Documentation` — a small table linking docs/architecture.md, docs/agents-and-tools.md and docs/development.md, with a one-line description each.

No other content stays in README.md.

## docs/ (new directory, three files)

Move the remaining README sections verbatim (same headings, same sentences), grouped as:

- docs/architecture.md: `Kanban board`, `Orchestrator`, `Board mirror to origin`, `Web dashboard`.
- docs/agents-and-tools.md: `Agents`, `Tools`.
- docs/development.md: `Package manager`, `Extension load path`, `Checks`.

Rules for the move:

- Move the text verbatim. Fix only cross-references that break (a "see the X section above" now names the doc file it lives in). Each doc file starts with a level-1 title for its topic; the moved H2 headings stay.
- Sections that stay in README.md must not reference moved detail without a docs/ link.
- No rewriting, shortening or rewording of moved content.

## Related updates

- .kanban/AGENTS.live-tester.md (line ~31) carries the recipe `grep -o "pkill -f '[^']*'" README.md`. The pkill text moves to docs/architecture.md. Update that recipe's target file to docs/architecture.md so the command still works. The role-notes file lives in .kanban/; the task worktree holds it as a symlink to the main board, so an edit from the worktree reaches the real file.
- package.json stays untouched: the pi manifest lists extensions and skills only; docs/ needs no manifest entry.
- Verify with rg that agents/, skills/, src/ and index.ts carry no README.md path references; leave them alone when they do not.

## Out of scope

- No code or test changes. The suites write their own fixture READMEs into temp dirs, so they are unaffected.
- The current H1 title and intro pitch stay unchanged.

## Acceptance criteria

- `rg -c "^## " README.md` prints 4 (Setup, Using it, Configuration, Documentation, in that order via `rg -n "^## " README.md`).
- `[ $(wc -l < README.md) -le 90 ] && echo ok` prints ok.
- `for f in $(rg -o "docs/[a-z-]+\.md" -N --no-filename README.md | sort -u); do test -f "$f" || echo "missing: $f"; done` prints nothing, and the listed set is exactly the three created files.
- Content-preservation spot checks all match: `rg -l "meta/kanban" docs/architecture.md`, `rg -l "pkill -f" docs/architecture.md`, `rg -l "append-system-prompt" docs/agents-and-tools.md`, `rg -l "test:changed" docs/development.md`.
- `grep -o "pkill -f '[^']*'" docs/architecture.md` exits 0.
- `npm test` passes (five suites, unchanged code).

# Notes

- Rewrote README.md: it keeps the H1 title, the intro pitch, Setup (install content only), a new Using it teaser, Configuration (the config JSON example and the key/default table, verbatim), and a Documentation table with one line per docs file. 4 H2 sections, 63 lines.
- Created docs/architecture.md (Kanban board, Orchestrator, Board mirror to origin, Web dashboard), docs/agents-and-tools.md (Agents, Tools) and docs/development.md (Package manager, Extension load path, Checks). Each file starts with a level-1 title; the moved headings keep their level. A diff of each moved section against the old README shows the moved text is verbatim.
- Two fixes in the moved text: the Tools cross-reference now names docs/architecture.md, and the stray "3." list marker before "Optional config" is gone (a leftover marker with no list).
- Updated .kanban/AGENTS.live-tester.md line 31: the docs-only README recipe extracts the pkill pattern from docs/architecture.md now, so the command still works.
- Verified with rg: agents/, skills/, src/ and index.ts carry no README.md path references. scripts/test-changed.test.mjs uses the "README.md" string as an unknown-path mapping fixture, not a docs reference; left alone per no code or test changes. package.json untouched.
- All acceptance criteria pass. npm test passes (five suites, unchanged code). Commit: f4d723c.

## Live test (#202, merged commit f4d723c)

Ran the documentation flows as a reader. All checks pass, no issues found.

- README shape: `rg -c "^## "` prints 4, `rg -n "^## "` gives Setup, Using it, Configuration, Documentation in that order, and `wc -l` is 63 (<= 90). The H1 and the intro pitch are byte-identical to the pre-change README.
- Documentation table: it lists exactly docs/architecture.md, docs/agents-and-tools.md and docs/development.md. All three files exist. Every local markdown link and anchor in README.md and in the three docs resolves (checked against GitHub heading slugs; includes README `#documentation` and docs/development.md `#checks`).
- Verbatim move: extracted each pre-change README section from a46e9fe and diffed it against its new home. Setup, the Configuration JSON and table, Kanban board, Orchestrator (with the Board mirror H3), Web dashboard, Agents, Tools, Package manager, Extension load path and Checks are all verbatim. The only differences are the two documented fixes: the Tools cross-reference now names docs/architecture.md, and the stray `3.` marker before Optional config is gone.
- Content spot checks: `rg -l "meta/kanban"` and `rg -l "pkill -f"` find docs/architecture.md, `rg -l "append-system-prompt"` finds docs/agents-and-tools.md, `rg -l "test:changed"` finds docs/development.md. `grep -o "pkill -f '[^']*'" docs/architecture.md` exits 0 and prints `pkill -f 'orchestrator.ts.*--root .*/\\.worktrees'`.
- Recipe: line 31 of .kanban/AGENTS.live-tester.md now greps docs/architecture.md. I extracted the pattern with that exact command and checked it against live processes: it matches `node <code>/orchestrator.ts --root <repo>/.worktrees/old-probe` and `node <code>/orchestrator.ts --rescan-seconds 5 --root <repo>/.worktrees/old-probe`, and does not match a project-root daemon `node <code>/orchestrator.ts --root <repo>`.
- No README.md path references remain in agents/, skills/, src/ or index.ts. Repo-wide the only other hit is the `scripts/test-changed.test.mjs` fixture string, which the Specs mark as out of scope.
- The unit suite was not run here: the Specs name it as the developer/reviewer gate, and the live test covers user flows only.

Assumptions for this live test:
- The pkill recipe step was verified against synthetic argv shapes, not with a live stale daemon fixture. The change moves the text and does not touch the daemon, and the e2e flow was already proven for task #172. The `pgrep` check confirmed the extracted regex matches both stale shapes and spares the project-root daemon.
- `pkill -f` from a `bash -c` command line matches the test shell itself (the known trap in AGENTS.live-tester.md line 9): my sweep used `pgrep` plus recorded pids only, and this is not a product issue.

No behavior contradicting the task's stated assumptions was observed. No live-test findings need a Project manager task.

# Open questions

None.

Assumptions to confirm:
- The "Using it" wording is new prose: the spec gave the content points and I phrased them as a two-line teaser; its mechanics link goes to the Documentation section anchor.
- "Board mirror to origin" stays an H3 under Orchestrator in docs/architecture.md: the verbatim move keeps its heading level.
- The `[Checks](#checks)` anchor in Package manager stays unchanged: both sections moved into docs/development.md, so the anchor still resolves there.
- The stray "3." marker on the Optional config line is a formatting artifact, not content, so the move drops it.
