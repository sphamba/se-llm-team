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

- grep -n "Edit it for project-specific\|append what future agents" over the five agents/developer.md, agents/reviewer.md, agents/live-tester.md, agents/merger.md, agents/splitter.md files returns no matches; each of the five carries the prohibition (names the doctor as the maintainer and the file as read-only for the role agent); the splitter wording covers its inline-injection path (no AGENTS.md symlink in cwd, the notes ride the appended system prompt, still read-only). Splitter note: #288 (in flight) supersedes the splitter paragraph — it must end up naming no notes file and forbidding writing any AGENTS file.
- For each of the five .kanban/AGENTS.<role>.md: grep -cE '^[[:space:]]*(-|\*|[0-9]+\.) ' is at most 20; grep -c '#[0-9]' is 0. Byte decision (recorded 2026-10-19, owner #279): the 8192-byte figure was a one-time-distill acceptance gate, NOT an ongoing invariant; the settled size bar is the bullet cap the doctor maintains. wc -c is informational only and never fails this verification.
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

## Live test (2026-10-19)

- Scope: the content half only (#285, #286, #287). Lane chosen once: shipped-file greps plus one delivery check. The delivery check calls `renderPrompt` (src/orchestrator/spawn.ts:14), the real function that ships agents/<role>.md as the pi `-p` payload. A full `spawnAgent` fixture was not built, because the cwd notes symlink and the argv plumbing are #280 code and the three content commits do not touch them.
- Merge: HEAD == main == b4aa9f6 and `git log HEAD..main` is empty, so the checkout under test is the merge. `git show --stat b4aa9f6 4145b49` shows two plain commits, no merge commit.
- Check 1 PASS: the old phrases `Edit it for project-specific` and `append what future agents` are absent from the five agents/*.md files (grep exit 1). Each file carries `read-only for you` and names the doctor as the maintainer and rewriter. Extra guards for the variants `rewrite or compact` and `future agents of your kind need` are also absent. agents/splitter.md:15 keeps the inline-injection path: no AGENTS.md symlink in its cwd, and the notes ride the appended system prompt.
- Check 1 note: "The doctor" starts a sentence in developer.md:26 and live-tester.md:16. Reviewer, merger and splitter write "the doctor" after a colon. The meaning is the same, and the corrected check is case-insensitive.
- Delivery PASS (`renderPrompt`, merged checkout): 26 of 26 assertions pass for the five roles. Every rendered payload carries the prohibition, names its own AGENTS.<role>.md file and the doctor, keeps the old edit instruction out, and leaves no `{{` placeholder. Payload sizes: developer 2355 B, reviewer 2692 B, live-tester 2445 B, merger 2730 B, splitter 2367 B.
- Check 3 PASS: the union of the files touched by 98be333, 4145b49 and b4aa9f6 is exactly the five agents/*.md files. No agents/doctor.md, src/ or tests/ file is in the content commits. `git status --porcelain -- agents src tests` is empty.
- Check 2 PARTIAL (one measurement batch, mtimes and sha256 recorded): bullets and task-number citations pass for the four present files, and the 8192-byte cap fails for two files.
  - developer: bullets 20, cites 0, bytes 8861, mtime 22:36:54, sha 745c6dfdc5f6. FAIL bytes.
  - reviewer: bullets 19, cites 0, bytes 8701, mtime 22:27:52, sha 7445e45f5bba. FAIL bytes.
  - live-tester: bullets 17, cites 0, bytes 8190, mtime 22:32:07, sha 58f6fd7a697f. ok.
  - merger: bullets 0, cites 0, bytes 2262, mtime 21:59:32, sha 50595bf2c28a. ok.
  - splitter: file missing at 22:40:34. It was present at 22:37 (sha b9fbcc6044fb, mtime 22:03:10). Sibling #288 (drop splitter role notes, state doing) owns that deletion, and the recorded forward risk predicted it. The splitter leg is not measurable now, and it is not a #281 failure.
- Rerun at 22:43 printed `TALLY check-content PASS=12 FAIL=1 SKIP=1`. Doctor rewrites at 22:41:16 and 22:42:29 moved reviewer (8701 -> 8189 B, sha ab7c815417c6) and live-tester (8190 -> 8182 B, sha 365074fc234c) back under the cap, while developer stayed at 8861 B. The byte criterion is not stable, and the wobble matches the recorded finding.
- Script tallies verbatim: `TALLY check-content PASS=11 FAIL=2 SKIP=1` and `TALLY check-delivery PASS=26 FAIL=0`. The first run of check-content reported PASS=8 FAIL=6: three FAILs were case-sensitive doctor-phrase matches and three were integer errors on the missing file. The corrected script reports the tallies above, so the first run is a script bug, not a product result.
- Root cause of the byte drift re-confirmed in the shipped files: agents/doctor.md caps only `{{maxNotesBullets}}` top-level bullets and has no byte rule. src/ has no role-notes byte cap (the only 8192 hit is the unrelated webui SCAN_WINDOW=81920). The byte cap is a one-time-distill gate, and the doctor rewrites drift the files over it again. The existing # Open questions entry still owns the decision.
- Contradiction with a stated assumption: Specs check 2 expects five stable notes files that meet the byte cap. Two of the four present files are over it at test time, and the fifth file is gone. The first effect comes from the missing doctor byte rule, and the second from in-flight sibling #288.
- Assumptions: (1) The five notes files are the shared board files in the main checkout, reached through the worktree `.kanban` symlink, and the main checkout root SPECS.md points at #286, not this task. (2) The notes files are untracked, so no pre-distill version exists and check 2 is a point-in-time measurement. (3) The `renderPrompt` payload is the shipped role prompt, and its byte sizes differ from the file sizes because the placeholders (`{{logStallMinutes}}`, `{{ROOT}}`) are filled at render time.
- No unit suite was run, per the live-tester role: the repo test suites belong to the developer and reviewer gates.

# Open questions

