# developer: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

- Tests are plain assert-style ESM scripts, no framework: `node tests/<file>.test.ts` per file, `npm test` for the suite.
- To intercept src module internals from a test (fs calls, hooks inside a function), spawn a child with `--require <preload.cjs>`: patches to `require("node:fs")` propagate to ESM named imports only when installed before the first import; an in-process patch never does (facade bindings resolve at first import).
- Comments in src avoid em/en-dashes; use colons, commas, parentheses, hyphens.
