---
name: "feat: analyst and doctor analysis after every agent run"
priority: "high"
state: "doing"
worktree: "feat/222-analyst-doctor-auto-run"
issuer: "user"
complexity: "complex"
shortName: "analyst-doctor-auto-run"
---

# Summary
Rename the two analysis passes to analyst (block summaries) and doctor (pain-point report plus full rewrite of .kanban/AGENTS.<role>.md), spawn the analysis detached on every successful agent run's log, persist the doctor's stream output, and show its logs in a web UI card below the run columns.

# Specs
# Goal
Rename the two analysis passes of src/efficiency-analysis.ts to named agents, make the orchestrator spawn the analysis automatically on every successful agent run's log, give the doctor pain-point-driven rewrite authority over .kanban/AGENTS.<role>.md, and show the doctor step's logs in the web UI in a card below the agents and sub-agents stacked columns cards.

# Current state (verified 2026-10-15)
- src/efficiency-analysis.ts: pass 1 = one LLM call per kept block (mergeLeadIns L244, pass1Prompt L274, "Summary:"/"Struggle:" lines); pass 2 = one call (pass2Prompt L304) producing the markdown pain-point report. Both passes share one agent executable and argv; the whole tool is called "analyser" (British spelling) in code and docs. Report written to <base>.analysis.md next to the target log (reportPathFor ~L420). The analysis process captures stdout in memory and writes no log of its own.
- Config: the analysis reads the dedicated role key roles.analyser via resolveLlm(root, cfg, "analyser", "") (empty complexity, per-complexity sub-objects never apply), plus cfg.roles.analyser?.concurrency (default 8) and mergeThreshold (default 250) parsed at src/orchestrator/config.ts L107-121.
- Orchestrator: agent success = exit code 0, handled at src/orchestrator/liveness.ts L185-207; the reviewer exception at L201-203 keeps the exit file sticky and leaves the task in reviewing (the reviewer may also advance to to-merge itself). rescan/poll are fully synchronous (src/orchestrator/pipeline.ts:220); analyseLog is a long async multi-call pipeline. No orchestrator-side analyseLog call exists anywhere; only src/tools.ts L294-318 (the manual efficiency_analysis tool) invokes it.
- Web UI: task detail modal run columns at src/webui/page.ts #m-agent-btns (L186, L290), renderAgent L596-640, subagent cards .agent-subs stacked below each run card. Log serving: agentLogPath whitelist src/webui/payload.ts L141-146 (regex ^(.
+)\.(developer|reviewer|live-tester|merger)(?:\.(\d+))?$, requires the task file to exist), LOG_ROLES src/webui/logpane.ts L12-14, compactor role pattern src/orchestrator/log.ts.
- .kanban/AGENTS.<role>.md: four files (developer, reviewer, merger, live-tester); ensureRoleNotes (src/orchestrator/spawn.ts:27-34) creates one only when missing; role agents are the ongoing writers; nothing in daemon code writes to them after creation. They load into every future agent of that role at spawn via the AGENTS.md symlink.

# Requirements
1. Naming: pass 1 becomes "analyst", pass 2 becomes "doctor" across code (types, function names, prompts, log lines, tool description, UI label). Behavior otherwise unchanged.
2. Config: roles.analyst and roles.doctor llm keys replace roles.analyser. loadConfig maps a present roles.analyser to roles.analyst when roles.analyst is absent (backward compat for existing installs, one-line fallback). The analyst uses roles.analyst (concurrency/mergeThreshold keep their meaning); the doctor uses roles.doctor; when roles.doctor is unset the doctor falls back through resolveLlm to the global model/thinking as usual.
3. Doctor authority: the doctor spawn drops the tool isolation (pi: without --no-tools and --no-mcp, keep the rest of the current argv; claude: without --bare, keep the rest of claudeAnalyserArgs) and edits <root>/.kanban/AGENTS.<role>.md itself, like a role agent does. The doctor prompt carries the block summaries and stats (as today), plus the ABSOLUTE path of the role file to revise (the analysed run's role), plus the instruction: identify the things the analysed agent lost most of its time on (pain points), then revise the role file so future runs of that role go more smoothly. Full rewrite authority: the doctor may restructure or trim the whole file and remove stale guidance. The file must stay valid markdown guidance for the role. The .analysis.md report is still written by the doctor pass as today.
4. Analyst isolation unchanged: the analyst keeps the current isolation argv (pi --no-tools/--no-mcp/--no-session/...; claude --bare).
5. Auto-run: after EVERY successful agent run finish (the exit-0 path at liveness.ts L185-207, including the reviewer's left-for-PM path and the reviewer self-advanced path, i.e. every recognized success for developer, reviewer, merger, live-tester), the orchestrator spawns the analyst+doctor analysis on that run's log. Execution is detached: rescan/poll are synchronous and the analysis is long, so spawn it detached with a pid file and exit file under .kanban/.pids/ (mirroring spawnAgent's sh wrapper) so a daemon restart does not orphan or re-trigger it; never block the daemon loop; a failing analysis never affects the pipeline (best-effort, log the failure and continue). Skip when the run has no log file or when an analysis for that run index already exists (report or doctor log present) — exactly one analysis per run; the sticky reviewer exit file must not re-fire it on every poll pass.
6. Doctor log: the doctor spawn's stream output persists to .kanban/.logs/<slug>.<role>.<n>.doctor.log where n is the analysed run's index. The analyst's stdout stays in memory as today. The log compactor must not consume .doctor.log files.
7. UI: in the task detail modal, below the run columns and their stacked subagent cards (below #m-agent-btns, between it and #m-log-meta/#m-log), one Doctor card shows the doctor step's log(s), fetched and live-polled like an agent log pane. agentLogPath and LOG_ROLES learn the doctor role. When several analysed runs exist, the card lets the user pick between their doctor logs, mirroring the run-column behavior.
8. The manual efficiency_analysis tool stays and works as today (explicit re-runs overwrite the report).

# Constraints
- The analyst+doctor run through the same backend resolution as today (cfg.agent/cfg.backend via the existing config chain).
- The doctor's cwd stays the .logs dir (dirname of the target log); the prompt carries the absolute role-file path.
- Background subagent runs are not analyzed; isSidechain records stay skipped in parsing.
- The analyst's current asserted argv (tests/efficiency-analysis.test.ts) must not break; the doctor's new argv and the new behaviors get asserted in extended tests.

# Acceptance
- node tests/efficiency-analysis.test.ts passes (extend: analyst/doctor naming, doctor argv with tools, doctor log persistence, roles.analyser->roles.analyst mapping and roles.doctor fallback, skip-if-analysed).
- node tests/orchestrator.test.ts passes (extend: the analysis spawn fires exactly once after each successful run of all four roles, detached with pid/exit files, skipped when already analysed or when no log exists).
- node tests/webui.test.ts passes (extend: the Doctor card renders below the run columns; agentLogPath serves a doctor log; the compactor leaves .doctor.log files alone).

# Notes
