# splitter: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

- The cwd SPECS.md is a symlink into .kanban/. Omit the file argument on all kanban tools. The parent num comes from the symlink target (ls -l SPECS.md).
- Read the touched code before you split. Check what the client reads from each payload field. Task 000242 had a tension: the light-row contract excluded agent history, but the board cards read t.agents/t.doctors for stats lines and the poll cadence. Such cross-cutting tensions are cheaper for one developer than for two split subtasks.
- tests/webui.test.ts is one shared 2000-line hub test file. Subtasks that both add tests there conflict at merge. Count that cost in the split decision.
- Run: pnpm test (full), pnpm test:changed (touched files only).
- tests/ has no payload-specific test file: payload/doctorHistory and aliveness tests also live in the shared tests/webui.test.ts. Any task touching payload.ts conflicts at merge with any task touching page.ts/board.ts tests. Count that in every split decision.
