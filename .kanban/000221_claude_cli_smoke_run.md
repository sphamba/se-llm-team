---
name: "test: real claude CLI smoke run of the agent-agnostic spawn"
priority: "low"
state: "backlog"
worktree: "test/221-claude-cli-smoke-run"
issuer: "#216"
complexity: "moderate"
shortName: "claude-cli-smoke-run"
---

# Summary
Exercise the real claude CLI end to end through the #216 agent-agnostic spawn layer: a daemon run that spawns a real claude developer via the new backend, plus the efficiency_analysis analyser on that real run. The CLI is not installed on this machine (no Anthropic auth), so the live test of #216 verified the claude path only with argv-recording stubs.

# Specs
# Decision (user, 2026-10-15)
A real claude CLI run is NOT a gate for production use of the claude backend. The stub-verified acceptance of #216 (exact argv, system-prompt file delivery, wrapper/process-group/pid/exit mechanics, effort mapping, every flag checked against the claude docs) counts as proof that the pipeline calls claude correctly. This task is optional: run it whenever a machine with the claude CLI and Anthropic auth is available, not before then.

# Goal
Run the real claude CLI end to end through the agent-agnostic spawn layer of #216, which no run has exercised for real on this machine (`which claude` returns nothing; it needs Anthropic auth). Run this when the claude CLI plus Anthropic auth (an API key or an apiKeyHelper) are available.

# What to run
1. Install the claude CLI and provide Anthropic auth (API key env var or apiKeyHelper in the claude settings) so headless `claude -p` works.
2. Configure the daemon for the claude backend (`agent: "claude"` per #216) and start it against a scratch git repo with a board (or this repo), e.g. via orchestrator_start or `node src/orchestrator.ts --root <repo>`.
3. Create one small, self-contained task in to-do and let the daemon spawn a real claude developer through the new backend. Verify: the spawn argv matches the recorded claude flags (bypassPermissions, stream-json output, --append-system-prompt file delivery, effort mapping), the agent runs in the task worktree, the wrapper/process-group/pid/exit mechanics behave as the stubs recorded, the task advances to to-review, and the log is native claude stream-json.
4. Run the efficiency_analysis tool on that real claude run and confirm the analyser parses it (final text and tool calls).

# Failure
- The daemon cannot spawn claude (ENOENT, unknown/rejected flag, auth error) or the spawned claude exits non-zero without doing the task.
- The real CLI rejects a flag or the effort/thinking mapping.
- Prompt or system-prompt file not delivered, wrong worktree cwd, or wrapper/process-group/pid/exit behaviour differs from the recorded stubs.
- The task does not advance out of doing, or the analyser errors/returns empty on the real claude log.
- A pass requires recording the exact commands, argv and observed outputs in # Notes.

# Notes

### 2026-10-15: blocked, no claude CLI and no Anthropic auth on this machine

Checks run (fresh shell in this worktree, HEAD 17a2e88), all negative:
- `which claude` and `claude --version`: command not found. npm globals (node v20.13.1, v24.13.0, v24.20.0), ~/.local/bin, ~/bin, /usr/local/bin: no claude binary anywhere.
- Anthropic auth: no ANTHROPIC_* or CLAUDE_* env var, no ~/.claude directory (no settings.json, no apiKeyHelper), no ANTHROPIC line in the shell rc files.

Conclusion: the precondition of the Specs (claude CLI plus auth) is not met. Per the user decision of 2026-10-15, the real run is optional and not a gate: the stub-verified acceptance of #216 stands as proof that the pipeline calls claude correctly. The task stays parked until a machine with the claude CLI and auth is available. No code changed.

Checked in the worktree so a future run does not re-check:
- The #216 backend layer is present: src/orchestrator/backends.ts (Backend "pi" | "claude"), src/orchestrator/spawn.ts (claudeSpawnArgs, claude system-prompt file).
- The config key for the run is `agent: "claude"`: a config agent value that names a backend wins (src/orchestrator/config.ts), and the resolved value lands in cfg.backend.
- Auth is the CLI's own business: src/ has no ANTHROPIC or apiKeyHelper handling.

### 2026-10-15: review pass: block re-verified, task re-parked to backlog

- Re-checked the environment (fresh shell, HEAD 17a2e88): no claude binary (PATH, npm globals, ~/.local/bin, ~/bin, /usr/local/bin), no ~/.claude directory, no ANTHROPIC_* or CLAUDE_* env var. The 2026-10-15 note holds.
- Checked the recorded backend-layer claims against the code; all correct (src/orchestrator/backends.ts, src/orchestrator/spawn.ts, src/orchestrator/config.ts, and no ANTHROPIC or apiKeyHelper handling in src/).
- No code changed, so there is no diff to review.
- The Specs' pass criterion is unmet: a pass requires the recorded commands, argv and observed outputs of a real run. No run happened, so the task cannot pass to to-merge; a to-merge pass closes the task as done without the run.
- The task was moved to to-review after the park note, but to-review has no park exit (re-review or merge only). Re-parked to backlog: promoteBacklog never promotes a task with unanswered open questions (src/orchestrator/pipeline.ts), so backlog holds the task for the user with no developer re-spawn. The open question stays in front of the user. When the claude CLI and auth are installed and the question is answered, the task promotes and runs.

# Open questions

Questions:
- Can you install the claude CLI on this machine and provide Anthropic auth (an API key env var, or an apiKeyHelper in the claude settings)? If not, this task stays parked per the decision in the Specs, and a machine with both runs it later.

Assumptions:
- No install without auth: a claude binary without Anthropic auth cannot do a headless `claude -p` run, so installing it here alone is useless.
- The stub-verified acceptance of #216 stands as proof of correctness until a real run happens (the user decision of 2026-10-15 in the Specs).
- The run will use the live-check recipe of the role guidance (temp root, isolated HOME, --no-webui) with config `agent: "claude"` and one small self-contained task in to-do.
- A real run consumes Anthropic API credit (one real claude developer plus one analyser call on its log), cost is small.

