---
name: "docs: simplify README to install and config; move the rest into docs/"
priority: "medium"
state: "backlog"
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
