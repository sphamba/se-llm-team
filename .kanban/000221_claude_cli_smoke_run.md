---
name: "test: real claude CLI smoke run of the agent-agnostic spawn"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#216"
complexity: "moderate"
shortName: "claude-cli-smoke-run"
---

# Summary
Exercise the real claude CLI end to end through the #216 agent-agnostic spawn layer: a daemon run that spawns a real claude developer via the new backend, plus the efficiency_analysis analyser on that real run. The CLI is not installed on this machine (no Anthropic auth), so the live test of #216 verified the claude path only with argv-recording stubs.

# Specs
# Goal
Run the real claude CLI end to end through the agent-agnostic spawn layer of #216, which the live test could only verify with argv-recording stub executables because no claude CLI is installed on this machine (`which claude` returns nothing). Run this when the claude CLI plus Anthropic auth (an API key or an apiKeyHelper) are available.

# Background (finding from the #216 live test)
The claude role-agent spawn and the claude analyser were verified with argv-recording stubs: the exact argv, the system-prompt file, the wrapper/process-group/pid/exit mechanics, and the effort mapping are recorded as passing, and every flag was checked against the claude docs. Consequence: the real claude CLI path for this change has never been exercised end to end here.

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

# Open questions
Is a real claude CLI run required before the claude backend is used in production? The CLI is not installed on this machine and needs Anthropic auth.
