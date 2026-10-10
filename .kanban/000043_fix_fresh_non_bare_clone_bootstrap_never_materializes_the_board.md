---
name: "fix: fresh non-bare clone bootstrap never materializes the board"
priority: "medium"
state: "to-do"
worktree: ""
---

# Summary
bootstrapBoard (src/orchestrator.ts) guards on refs/heads/meta/kanban, but a fresh `git clone` only carries refs/remotes/origin/meta/kanban (remote-tracking ref), so bootstrap returns early and .kanban/ stays empty; the first board change then creates an ORPHAN mirror commit whose auto-push fails non-fast-forward against origin's meta/kanban.

# Specs
FILE/FUNCTION: src/orchestrator.ts, bootstrapBoard() (line ~301; guard at line 302: `if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) return;` with KANBAN_REF = "refs/heads/meta/kanban", line 25).

ROOT CAUSE: A fresh `git clone` has only `refs/remotes/origin/meta/kanban` (remote-tracking ref), no local `refs/heads/meta/kanban`, so the guard returns early: empty .kanban/, no "bootstrapped" log line, board never materializes. The acceptance "a fresh clone plus bootstrap materializes the full board" only holds for bare clones.

REPRODUCTION: Fresh non-bare clone of a repo with a pushed meta/kanban branch; run the daemon (bootstrap): .kanban/ stays empty and no "bootstrapped" line is logged.

CONSEQUENCE (observed): The first board change in the clone makes commitKanban see no parent and create an ORPHAN mirror commit (no parent); its auto-push then fails non-fast-forward against origin's meta/kanban (push-failure hints in the daemon log).

SUGGESTED DIRECTION (for the dev to decide): bootstrap from refs/remotes/origin/meta/kanban when refs/heads/meta/kanban is absent (e.g., create the local branch from the remote-tracking ref), and/or seed the local mirror from origin before the first commit.

# Notes
