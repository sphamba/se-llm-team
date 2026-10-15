---
name: "refactor: genericize the agents role prompts"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "moderate"
shortName: "generic-role-prompts"
blockedBy: "#224"
---

# Summary
Sweep all six agents/*.md role prompt files, remove every repo-specific instruction (they ship with the tool for use on any project), genericize the opening lines, and move the repo-specific sentences into this project's .kanban/AGENTS.<role>.md files in the main checkout.

# Specs
# Goal
The agents/*.md role prompts ship with se-llm-team and are used for working on any project, so they must hold only generic role guidance. Sweep all six files (developer.md, reviewer.md, live-tester.md, merger.md, analyst.md, doctor.md; the last two come from #224), remove every repo-specific instruction, genericize the opening lines, and move the repo-specific sentences into this project's .kanban/AGENTS.<role>.md files.

# Current state (verified 2026-10-15)
- agents/developer.md:1, live-tester.md:1, merger.md:1, reviewer.md:1: opening lines "You are the <Role> agent of the se-llm-team kanban pipeline."
- agents/developer.md:24: the repo-specific smoke-daemon sentence: "Smoke-testing the pipeline (a daemon run against a temp root) must not touch the production webui: start smoke daemons with `--no-webui` (or set `SE_LLM_TEAM_NO_WEBUI=1`), because a smoke daemon reads the global config and binds the production webui port, wedging the real UI."
- agents/live-tester.md:5: names this repo's suites: "never run any *.test.ts file, and never run the repo's node suites (tests/kanban.test.ts, tests/orchestrator.test.ts, tests/webui.test.ts)" — the *.test.ts rule is generic; the named suites are repo-specific examples.
- .kanban/AGENTS.<role>.md: project-local, untracked on main (committed only to the board mirror); ensureContextSymlinks (src/orchestrator/spawn.ts:38-46) re-points each agent cwd's AGENTS.md to .kanban/AGENTS.<role>.md at every spawn; ensureRoleNotes (spawn.ts:27-34) creates one when missing. The doctor (#222) rewrites these files on every successful run with full rewrite authority.
- A task's merge cannot carry .kanban/ files (untracked): the implementing developer must write the main checkout's .kanban/AGENTS.<role>.md directly by absolute path, like the existing SPECS.md main-checkout exception.

# Requirements
1. Sweep all six agents/*.md files: remove every repo-specific instruction (any sentence that only makes sense when working on the se-llm-team repo itself).
2. Genericize the four opening lines to "You are the <Role> agent of the kanban pipeline." (no tool name).
3. Move the repo-specific sentences into this project's matching .kanban/AGENTS.<role>.md files in the main checkout: developer.md:24's smoke-daemon sentence to .kanban/AGENTS.developer.md; live-tester.md:5's named suites to .kanban/AGENTS.live-tester.md; any other findings likewise. Generic replacements stay in agents/*.md where the rule itself is generic (live-tester keeps a suite ban without the names, e.g. "never run any *.test.ts file and never run the repo's test suites").
4. analyst.md and doctor.md must hold only generic prompt scaffolds; if any repo-specific sentence appears there, move it to .kanban/AGENTS.developer.md and record it in Notes.
5. The .kanban/AGENTS.<role>.md edits happen in the main checkout directly (absolute path; the merge cannot carry untracked files), recorded in the task's # Notes. Everything in agents/*.md goes through the normal worktree and merge.
6. Nothing else changes: same structure, same instructions otherwise, same files.

# Constraints
- Role-prompt behavior for other projects stays identical apart from the removals and genericizations.
- The moved sentences keep their exact technical content (the --no-webui flag, SE_LLM_TEAM_NO_WEBUI=1, and the reason).
- The doctor keeps full rewrite authority over .kanban/AGENTS.<role>.md; the moved sentences may be compacted by the doctor later (accepted per #222).

# Acceptance
- A task-specific grep check passes: `grep -rn "se-llm-team" agents/` returns nothing, and the named suite paths (tests/kanban.test.ts, tests/orchestrator.test.ts, tests/webui.test.ts) no longer appear in agents/.
- The moved sentences exist in the main checkout's .kanban/AGENTS.developer.md and .kanban/AGENTS.live-tester.md.
- node tests/kanban.test.ts passes as a sanity gate (no suite asserts agents/*.md content; the reviewer verifies the sweep).

# Notes
