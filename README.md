# se-llm-team

A pi coding agent extension. One skill, `/skill:se-llm-team`, turns the session into the Project manager and starts an orchestrator daemon that runs a kanban pipeline of headless coding agents.

## Setup

Install as a pi package from git:

```sh
pi install git:github.com/sphamba/se-llm-team
```

The https URL form works too: `pi install https://github.com/sphamba/se-llm-team`. The package provides the kanban/orchestrator tools, the `/skill:se-llm-team` skill, and the agent prompts. Node >= 24 is required: the orchestrator daemon runs the `.ts` sources directly through node's type stripping, so there is no build step.

Local development alternative: symlink the repo to `~/.pi/agent/extensions/se-llm-team/`. pi loads `index.ts` from it. No build step. Publish the skill with a second symlink (settings `skills` entries only toggle discovered resources, they do not add paths):

```sh
ln -s /path/to/se-llm-team/skills/se-llm-team ~/.pi/agent/skills/se-llm-team
```

## Using it

Start pi in a project and run the `se-llm-team` skill: the skill makes the session the Project manager, the kanban tools drive the board, and `orchestrator_start` runs the daemon. The orchestrator sends board reports to the chat. The mechanics are in [Documentation](#documentation) below.

## Configuration

Optional config in the global config file `$XDG_CONFIG_HOME/se-llm-team/se-llm-team.json` (or `~/.config/se-llm-team/se-llm-team.json` when `XDG_CONFIG_HOME` is unset; a `.kanban/se-llm-team.json` in the project overrides it). Setups from before the move keep working: when the neutral file is absent, the legacy `~/.pi/agent/se-llm-team.json` is read as a fallback, and the code never writes there.

```json
{
  "agent": "pi",
  "pollMinutes": 1,
  "model": "anthropic/claude-sonnet-4-5",
  "thinking": "high",
  "roles": { "developer": { "thinking": "xhigh", "complex": { "model": "big-model" } } },
  "reviewerCap": { "trivial": 0, "simple": 1, "moderate": 2, "complex": 3 },
  "webUi": { "enabled": true, "host": "localhost", "port": 4242 }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `agent` | `pi` | Agent backend the orchestrator spawns: `pi` or `claude`. Resolution: this key when it names a backend, then the daemon's `--default-agent` flag (the pi extension passes `pi`), then `pi`. Any other value overrides the spawned executable (stubs, custom wrappers). |
| `pollMinutes` | `1` | Agent liveness poll interval. |
| `logStallMinutes` | `10` | A working agent whose log size stays unchanged for this many minutes is assumed dead: the task bounces one state back, the agent process is killed, and the respawn machinery takes over. An invalid value (non-number or <= 0) warns and keeps the default. |
| `provider` | unset | LLM provider to pass as `--provider` (pi backend only; claude ignores it). Requires `model`; a provider without a model is ignored with a warning. |
| `model` | unset | LLM model or pattern to pass as `--model`. A `:<thinking>` suffix in the pattern keeps working natively. |
| `thinking` | unset | Reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Passed as `--thinking` (pi) or `--effort` (claude); claude has no `off`/`minimal` effort, both map to `low`. An unknown value is ignored with a warning. |
| `roles.<type>.<key>` | unset | Override `provider`, `model` or `thinking` for one agent type (`developer`, `reviewer`, `live-tester`, `merger`); per-field, so unset fields keep the global value. |
| `roles.<type>.<complexity>.<key>` | unset | Same fields nested under `trivial`, `simple`, `moderate` or `complex` inside a roles entry. Applies to tasks whose `complexity` attribute matches; per-field, so unset fields keep the role default and unset role fields keep the global value. |
| `reviewerCap.<complexity>` | `0`/`1`/`2`/`3` | Successful reviewer runs before a to-review task force-advances to to-merge, per task complexity: trivial `0`, simple `1`, moderate `2`, complex `3`. An invalid value (non-integer or < 0) warns and keeps the default. |
| `webUi.enabled` | off | Serve the web dashboard with the daemon. |
| `webUi.host` | `localhost` | Dashboard bind host. |
| `webUi.port` | `4242` | Dashboard port. |

## Documentation

| Doc | Description |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | The kanban board, the orchestrator daemon, the board mirror to origin and the web dashboard. |
| [docs/agents-and-tools.md](docs/agents-and-tools.md) | The agent roles and how they run, and the PM session tools. |
| [docs/development.md](docs/development.md) | The package manager, the extension load path and the checks. |
