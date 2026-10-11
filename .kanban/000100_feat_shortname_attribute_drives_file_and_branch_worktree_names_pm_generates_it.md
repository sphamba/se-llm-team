---
name: "feat: shortName attribute drives file and branch/worktree names; PM generates it"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Tasks gain a shortName attribute (max 5 words, strict slug) that the PM generates at creation. The task file name and branch/worktree name derive from it (e.g. "this-is-a-short-name" -> 000042_feat_this_is_a_short_name.md, feat/42-this-is-a-short-name). The full name attribute stays and stays in the webui.

# Specs
User decisions settled: shortName is optional at kanban_create (absent -> the current truncation slug applies); strict slug validation rejecting anything else; shortName is set at creation only (the file name derives from it, so it cannot change later).

Facts (main 35ba118, verified): createTask kanban.ts:259-283, file = `${num}_${slugFile(input.name)}.md` :275, num = max taskNum + 1 padStart(6,"0"), wx-flag EEXIST retry x10; slugFile :142-144 = slugParts(name).words.join("_"); slugParts :132-141 lowercases, non-alphanumerics -> spaces, words .slice(0, 4), type = name text before first ":"; taskNum :58-61. ensureWorktree orchestrator.ts:549-564: wt = task.worktree || slugWorktree(task.name, task.file) :553, wtDir = join(root, ".worktrees", wt), git worktree add -b, setWorktree :562; slugWorktree kanban.ts:147-153 template {type ?? "task"}/{num}-{slug}, num non-padded from the file; mergeDone :593-631 treats the worktree attribute as the literal branch name :595. Slug-keyed state: task.file.replace(/\.md$/, "") orchestrator.ts:201 for pidPath/counterPath/armedPath :115-119, agentPid :165-171, nextRunIndex :185-198, writePid :217, reviewer arm/consume, merge-attempt counters, dead-agent respawn. Task kanban.ts:9-20, TaskRef :22-30, parseTask attrs loop :48-58 mapping :69-81 (name: attrs.name ?? file.replace(/\.md$/,"") :71), updateAttrs :95-110, updateTask patch type :246-253. index.ts kanban_create :56-75 passes params verbatim. SKILL.md skills/se-llm-team/SKILL.md step 3 (line 30) kanban_create, step 4 (line 31) the naming/priority rule. Precedent: files created before the 3869c17 naming commit keep long names and are never renamed.

Changes:
1. Task gains shortName: string (absent when not set). parseTask picks the shortName frontmatter attribute and passes it through (validated at creation, not re-coerced at parse). TaskRef gains shortName so kanban_list carries it.
2. createTask gains an optional shortName. Validation (strict, per user decision): lowercase letters/digits/hyphens only, no leading/trailing hyphen, max 5 hyphen-separated words; anything else is rejected with an error. When valid and provided, the file is `${num}_${shortName}.md` and the frontmatter gains quoted shortName. When absent, today's slugFile(name) truncation applies unchanged.
3. slugWorktree gains the shortName: when present the template is {type ?? "task"}/{num}-{shortName} (e.g. feat/42-this-is-a-short-name); when absent, today's behavior. ensureWorktree passes task.shortName. The branch type prefix still comes from the name's "type:" prefix as today. ShortName is never updatable after creation (no kanban_update parameter).
4. kanban_create gains the optional shortName parameter (index.ts), passed through verbatim as today.
5. SKILL.md: extend the step 4 naming rule - the PM generates a shortName of max 5 words, lowercase hyphenated, and passes it to every kanban_create.
6. No webui changes (the full name stays displayed; nothing visual changes).

Tests: kanban.test.ts - createTask with shortName writes 0000NN_<type-prefix-derived>_... wait, the file slug is exactly the shortName (e.g. 000042_this_is_a_short_name.md when shortName is "this-is-a-short-name" and the type prefix does NOT enter the file name); creation without shortName keeps the truncation slug; strict rejection (uppercase, 6 words, invalid chars, leading/trailing hyphen); parseTask round-trips shortName quoted; slugWorktree with shortName renders {type}/{num}-{shortName} and without shortName is unchanged; the lossless-rewrite test still passes.

Acceptance: a task created with shortName "this-is-a-short-name" yields file 000042_this_is_a_short_name.md, branch/worktree feat/42-this-is-a-short-name, frontmatter shortName: "this-is-a-short-name"; a task without shortName behaves exactly as today; kanban_list/kanban_get carry shortName; full suite green: node src/kanban.test.ts, node src/orchestrator.test.ts, node src/webui.test.ts.

Constraints:
- Files: src/kanban.ts, src/orchestrator.ts (ensureWorktree only), src/index.ts, skills/se-llm-team/SKILL.md, src/kanban.test.ts.
- Existing task files, logs and pids are never renamed; the naming applies to tasks created after this lands.
- HOLD behind #78 (doing on feat/78-to-merge-and, dirtying src/kanban.ts, src/orchestrator.ts), behind #72 (live-testing, src/kanban.ts pending merge), and behind #98 (backlog, src/kanban.ts + src/index.ts). Rebase on the merged code.

# Notes
