---
name: "fix: role prompt prohibitions and one-time notes distill"
priority: "high"
state: "live-testing"
worktree: "fix/281-doctor-minimal-role-notes-content"
issuer: "#279"
complexity: "simple"
shortName: "doctor-minimal-role-notes-content"
blockedBy: ""
---

# Summary
Verification parent for the content half of #279, split by role weight into three subtasks with disjoint file ownership: #285 (developer), #286 (live-tester), #287 (reviewer, merger, splitter). Each subtask owns its role prompt prohibition plus that role's one-time notes distill. Verify the landed contract across all five roles once the pieces have merged. The doctor/code half is task #280.

# Specs
# Verification (after #285, #286 and #287 merge)

- grep -n "Edit it for project-specific\|append what future agents" over the five agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md files returns no matches; each of the five carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent); the splitter wording covers its inline-injection path (no AGENTS.md symlink in cwd, the notes ride the appended system prompt, still read-only).
- For each of the five .kanban/AGENTS.<role>.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0; wc -c is at most 8192.
- agents/doctor.md, src/ and tests/ carry no changes from the content subtasks: the merged deliverable commits touch only the five agents/*.md files.

# Notes

- Concurrent-splitter race repair (2026-10-19): a parallel session had also decomposed this parent as #282 (developer), #283 (live-tester), #284 (reviewer/merger/splitter), issuer #279, no worktrees, no developers. This decomposition (#285, #286, #287) is canonical: the blockers above, #287 in doing with a developer. The duplicate tasks were deleted; no work was lost. Do not re-create them.
- Parent verification (2026-10-19, #281 developer, verification-only, no commit):
  - Landed pair: HEAD == main == b4aa9f6 and `git log HEAD..main` is empty. Commits since the #279 base 5bd5079: 98be333 (developer), 4145b49 (live-tester), a1681b3 (#280, code half), b4aa9f6 (reviewer, merger, splitter). The three content commits are plain ancestors of main, no merge commits.
  - Check 1 (prohibitions) PASS all five: `grep -n "Edit it for project-specific\|append what future agents"` over the five agents/*.md exits 1 (no matches). Each file carries "read-only for you" once, names the doctor as the maintainer and rewriter, and routes durable guidance to the task file's # Notes. agents/splitter.md:15 keeps the inline-injection path: no AGENTS.md symlink in its cwd, the notes ride the appended system prompt.
  - Check 3 (commit scope) PASS: 98be333 touches agents/developer.md, 4145b49 touches agents/live-tester.md, b4aa9f6 touches agents/merger.md + agents/reviewer.md + agents/splitter.md. The union is exactly the five agents/*.md files. No agents/doctor.md, src/ or tests/ changes in the content commits. `git status` is clean.
  - Check 2 (notes mechanics) PARTIAL: bullets and citations PASS for all five (bullet lines <= 20, 0 '#[0-9]' citations). The 8192-byte cap does not hold under doctor maintenance. Settle batch at 22:31:06 through the worktree symlink: developer 8595 B / 20 bullets / 0 cites (sha256 db62dc7930f5), live-tester 8559 B / 17 / 0 (e4d6cb4fa40f), reviewer 8701 B / 19 / 0 (7445e45f5bba), merger 2262 B / 0 / 0 (50595bf2c28a), splitter 6246 B / 10 / 0 (b9fbcc6044fb). The same batch caught developer 10174 B and live-tester 10871 B before their 22:30:44 and 22:30:53 doctor rewrites, so three files were over the byte cap minutes earlier.
  - Cause: the landed doctor contract (agents/doctor.md:8) caps only "at most {{maxNotesBullets}} top-level bullets" (default 20) and carries no byte rule. The ensureRoleNotes starter has no byte rule either. Normal post-#280 doctor rewrites therefore drift the files over 8192 B while the bullet count stays in range. This repeats the #285 live-test finding (8455 B at 21:58:15, back to 8182 B at 22:08:36): the byte cap is a point-in-time one-time-distill gate, not a maintenance invariant. I did not trim by hand: the notes file is doctor-owned and read-only for the role agent, a trim races live doctor processes (#288's developer analysis was running), and the next rewrite undoes it. The root fix belongs to the doctor contract or to a #279 spec decision.
  - Baseline scoped suite: `node tests/plugin.test.ts` exit 0, "all assertions passed". It is the only suite that covers agents/*.md, and the content diffs carry no test files.
  - Forward risk for #279: #288 (drop splitter role notes, in doing) deletes .kanban/AGENTS.splitter.md and rewrites agents/splitter.md's closing paragraph to forbid writing any AGENTS file. It supersedes #287's splitter paragraph, so the #279 re-baseline must remove the splitter notes-file item.
- Re-review (2026-10-19, #281 reviewer): recorded claims hold, no fixes. Check 1 PASS: prohibition grep exits 1 over the five agents/*.md; each carries "read-only for you" once and names the doctor as maintainer with # Notes routing; agents/splitter.md:15 keeps the inline-injection path (no AGENTS.md symlink in cwd, notes ride the appended system prompt). Check 3 PASS: git show --stat 98be333/4145b49/b4aa9f6 touch exactly agents/developer.md, agents/live-tester.md, agents/merger.md+agents/reviewer.md+agents/splitter.md (one line each, no agents/doctor.md, src/ or tests/ files); all three plain ancestors of main; HEAD still b4aa9f6, worktree clean.
- Check 2 re-measured 2026-10-19: bullets 20/19/17/0/10 and cites 0 for all five (PASS); bytes developer 8175, reviewer 8701, live-tester 8190, merger 2262, splitter 6246, so 4/5 at most 8192 and reviewer over. Developer (8595 at 22:31) and live-tester (8559) drifted back under while reviewer is untouched since 22:31: the wobble matches the recorded one-time-gate finding. Cause re-confirmed: agents/doctor.md:8 caps only {{maxNotesBullets}} top-level bullets; no 8192 byte rule exists in the doctor prompt or in src/ (the ensureRoleNotes starter has none; the only src 8192 hit is the unrelated webui SCAN_WINDOW). Byte-cap decision stays with the #279 parent (open question kept); no hand-trim, per the recorded doctor-race rationale.
- Suite: node tests/plugin.test.ts exit 0, all assertions passed (union = plugin only: agents/*.md per coverage map, diff carries no test files).
- Open question settled: .kanban resolves to /home/phamba/repos/se-llm-team/.kanban, the main checkout, so the five notes files were read through the worktree symlink as assumed.

# Open questions
- Assumption: the 8192-byte note cap is a one-time-distill gate, not a doctor-maintenance invariant, because the landed doctor contract caps only top-level bullets. Should the doctor prompt and the ensureRoleNotes starter also carry the byte cap, or is the byte criterion one-time only? The #279 parent owns this decision.
