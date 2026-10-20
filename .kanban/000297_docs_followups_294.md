---
name: "fix: docs follow-ups from the #294 live test"
priority: "medium"
state: "done"
worktree: ""
issuer: "#294"
complexity: "trivial"
shortName: "docs-followups-294"
---

# Summary
Two one-line docs gaps found by #294's live test and reviewer: the Doctor is the only role without a prompt link in docs/agents-and-tools.md, and the tools paragraph lists 12 tools while the PM session also gets efficiency_analysis (src/tools.ts:316).

# Specs
# Changes

- docs/agents-and-tools.md: link the Doctor role to agents/doctor.md like the other five roles (the #294 live test failed this check, TALLY 25/26).
- docs/agents-and-tools.md, tools paragraph: mention efficiency_analysis (the PM's run-analysis tool, src/tools.ts:316) so the tool list matches the tools the PM session actually gets.

# Acceptance

- Every role named in docs/agents-and-tools.md links its agents/<role>.md file.
- Scoped check green (tests/plugin.test.ts covers docs presence); no other file changes.

# Notes

- Changed `docs/agents-and-tools.md` only: added the `Doctor` row to the role table (links `agents/doctor.md`) and added `efficiency_analysis` to the PM tools paragraph, count 12 to 13, matching `src/tools.ts:316`.
- All six roles named in the doc now link their `agents/<role>.md` file.
- complexity: trivial, so no red-first and no new tests. Scoped suites run green: `tests/plugin.test.ts`, `tests/tools.test.ts`.
- Commit: "docs: link Doctor prompt and list efficiency_analysis tool".

## Live test (2026-10-20)

Lane: docs/CLI probe. The user path is README.md -> docs/agents-and-tools.md -> role prompt link, then the PM tools paragraph against the tools the session registers. No daemon, no port, no browser. Driver `/tmp/docs-followups-297/driver.mjs`, `run.sh`, `run.log`. Fixed tree = this worktree at `6c23261`. Control = `git -C <repo> archive cd8c0c7 | tar -x -C /tmp/docs-followups-297/pre-fix`, one scenario function shared by both runs, so the control differs only in the doc under test.

| Claim | Printed proof | Control |
| --- | --- | --- |
| C0 doc reachable from README | README row links `docs/agents-and-tools.md`, target resolves | same both (preflight) |
| C1 every role named in the doc links its `agents/<role>.md` | per role: row, cwd cell, anchor, href, `exists=true` | pre-fix: Doctor named in prose, no row -> FAIL |
| C2 tools paragraph matches the PM registry | count word vs name count, name set vs `TOOLS` keys, both sets printed | pre-fix: 12 names, `efficiency_analysis` missing -> FAIL |
| C3 diff touches only the doc | `git show --name-only HEAD` | n/a (control tree has no commit under test) |
| C4 cited line is fresh | `src/tools.ts:316` is `efficiency_analysis: {` | n/a (control doc cites no line) |

Roles were derived from `agents/*.md` and only checked when the doc names them, so `analyst.md` is skipped (not a doc role) and the Doctor check fails when the row is absent. The tool set was read from the depth-1 keys of the exported `TOOLS` object, because the peer deps (`typebox`, `@earendil-works/pi-ai`) are not installed here and `index.ts` cannot be imported in this fixture.

```
TALLY fixed 11/11
TALLY pre-fix 7/9
FAILED pre-fix [pre-fix/C1-role-doctor,pre-fix/C2-set-matches-registry]
```

Both claims fail in the control and pass in the fixed tree. Fixed proof lines: `PASS fixed/C1-role-doctor: row "Doctor" cwd="the task worktree" anchor=agents/doctor.md href=../agents/doctor.md exists=true`; `PASS fixed/C2-set-matches-registry: doc 13 names, src/tools.ts 13 keys, missing from doc=[] not in registry=[]`; `PASS fixed/C4-cited-line: doc cites src/tools.ts:316, that line is "efficiency_analysis: {" (real key line 316)`; `PASS fixed/C3-diff-scope: HEAD 6c23261 touches [docs/agents-and-tools.md]`. The pre-fix C3 and C4 skips mean the control tally has two fewer checks, so the two tallies are not directly comparable as fractions.

One checker bug was fixed before the tally stood: the first driver required `the task worktree` in the cwd cell of every row, which failed the Splitter row in both trees. The doc correctly gives the Splitter `the project root`, so the assertion now accepts either cell. The failing tally above is from the corrected run, and the bad assertion cost no product claim.

Finding, measured, and outside this diff: the tool count is still `12` in two places while the doc now says 13 and `src/mcp.ts:46` serves `Object.entries(TOOLS)`, which is 13 keys at both commits (`README.md:72`: "the same 12 kanban and orchestrator tools"; `index.ts:140`: "the 12 tools are deferred"). Both lines predate the diff (`git show --name-only HEAD` lists only `docs/agents-and-tools.md`), so a reader of the README and the MCP section now meets 12 in one file and 13 in the other for the same set.

Not exercised: the scoped suites named in Specs (`tests/plugin.test.ts`, `tests/tools.test.ts`), per the live-test lane rules, and no browser render of the doc, because no route serves `docs/`. The relative-href resolution the driver performs is what a renderer does with these links.
