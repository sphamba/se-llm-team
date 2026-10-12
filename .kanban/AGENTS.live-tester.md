# live-tester: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

- Live-test the daemon on an isolated root, never on the real board:
  1. `git clone --bare /home/phamba/repos/se-llm-team /tmp/<t>/origin.git` (scratch origin, so pushes stay off the real mirror), then `git clone /tmp/<t>/origin.git /tmp/<t>/repo`.
  2. Put the probe task in `/tmp/<t>/repo/.kanban/` and `{"agent": "/tmp/<t>/fake-pi", "autoScheduleMinutes": 0.05, "pollMinutes": 1}` in `/tmp/<t>/repo/.kanban/se-llm-team.json`.
  3. Start the merged daemon code: `SE_LLM_TEAM_NO_WEBUI=1 node --input-type=module -e "const m = await import('/home/phamba/repos/se-llm-team/src/orchestrator.ts'); m.main(['--root','/tmp/<t>/repo','--rescan-seconds','1','--poll-minutes','1']);" &`
- `fake-pi` is a script that appends `"$@"` and its cwd to a log, records the `--append-system-prompt` path and its content, then sleeps, so the daemon sees a live agent and the real spawn argv is observable.
- Never start a daemon without `--no-webui` or `SE_LLM_TEAM_NO_WEBUI=1`: it reads the global config and binds the production webui port (4242).
- The daemon loads its code at start: a merged orchestrator change is inert until the daemon restarts. Restarting does not kill running agents.
- Do not drop `AGENTS.*.md` into the real `.kanban/` while a daemon started before this feature runs: its `listAll` has no filter and would promote the file to a phantom task and spawn a real agent.
- Clean up: kill the scratch daemon and every fake-pi process when the test ends.
- Role notes reach `meta/kanban` on the next `kanban: create`/`kanban: done` commit, only then; an idle board keeps them local.
