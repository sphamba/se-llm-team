---
name: "refactor: general code architecture review and potential refactors"
priority: "low"
state: "live-testing"
worktree: "refactor/52-general-code-architecture"
blockedBy: "#115"
---

# Summary
Review the whole codebase architecture (module boundaries, duplication, dead code, error handling, naming) and apply justified, behavior-preserving refactors, keeping typecheck and the full test suite green. Do this only after the whole backlog has been done/emptied.

# Specs
Review the whole codebase for architecture issues: module boundaries, duplication, dead code, inconsistent patterns, error handling gaps, naming. Apply justified, behavior-preserving refactors. No new dependencies. Keep typecheck and the full test suite green.

MUST run only after the whole backlog has been done/emptied (and after the .kanban issues are resolved). Runs alone - it can touch any file.

# Notes

- Baseline at HEAD fa562ae: all five test suites pass (orchestrator smoke ~5 min wall-clock, needs a long timeout alone); strict tsc reports ~62 pre-existing src errors and no typecheck is wired in, so the adopted bar is: suites green, no new strict errors in src.
- Reviewed module boundaries, duplication, dead code, patterns, error handling and naming across index.ts, src/kanban.ts, src/orchestrator.ts, src/webui.ts, src/hub.ts and all tests; delegated the call-site verification to two explorer subagents.
- Extracted src/pid.ts: one pidAlive (optional /proc start-time discriminator), procStartTicks/procCmdline/pidDiscriminator, pidfile helpers (pidPath/writePid/clearPid), agentPid (parseInt||0), pidEntry, agentAlive. orchestrator.ts, webui.ts, hub.ts, index.ts and orchestrator.test.ts now share it; three pidAlive copies and webui's currentPid/rolePid are gone. Webui liveness now reads the pidfile discriminator like the orchestrator.
- Deleted production-dead startWebUi and serve from webui.ts (the dashboard is served through hub.ts startHub/route); webui.test.ts endpoint tests now run against startHub with HOME isolated to a temp dir, and the /api/projects 404 assertion became an assertion of the hub registry entry.
- kanban.ts: one exported splitFrontmatter helper replaces the frontmatter regex/attr-parse repeated in parseTask/updateAttrs/replaceSections/updateTask and webui taskBody; exported PRIORITIES and PRIORITY_RANK; added a taskSlug one-liner replacing the file.replace(/\.md$/,'') idiom at 14 production sites.
- orchestrator.ts: renamed the local taskNum (NaN->MAX_SAFE_INTEGER) to sortNum to remove the same-name/different-behavior trap against kanban.ts taskNum (NaN->0); rank now falls back to ?? 4; parseArgs usage string now documents --rescan-seconds and --poll-minutes.
- Deleted production-dead appendNote from kanban.ts (no tool, prompt, skill or doc references it) and its test blocks; deleted updateTask's unused parseTask read.
- index.ts: resolveRoot returns string|null instead of the {root:...}|{root:null} union; local pidAlive removed.
- Deliberately not changed: webui AGENT_ROLE vs orchestrator WORKING_STATES (would change current-agent behavior for merging tasks); the direct execFileSync("git", ...) calls (bespoke input/trim/error semantics each); splitting logs/config/mirror out of orchestrator.ts (single consumer); unused type exports kept as self-documenting API surface.
- README: the Checks section now lists all five suites; the pollMinutes config example now shows the default 1 instead of the stale 15.
- Verification: all five suites pass (orchestrator smoke re-run alone, 4m55s, same as baseline); strict tsc still reports the same 62 pre-existing src errors, none new. Committed as 755b654 (net -81 lines).
- Review pass (reviewer, branch tip 507571a): verified the 755b654 diff against its merge-base fa562ae. The webui agentHistory switch from rolePid to agentAlive is behavior-preserving: AGENT_ROLE only maps doing/reviewing/live-testing, all of which read .pids/<slug>.pid; the old merger branch read the legacy per-task <slug>.merger.pid file that no longer exists, so both read live=false for merging tasks. Main's poll already used the pidEntry discriminator, so pid.ts is a verbatim move. webui.test.ts home/realHome swap around startHub is balanced (restored at ui.close()). appendNote has zero references anywhere (tool, prompt, skill, docs) - dead-code deletion confirmed. hub.ts startHub unrefs its server and clears the reap interval on close(). Main advanced past the branch point during the review (tip 7cef488, docs/117 work); main...HEAD now shows both sides of the divergence, expected for the merge step.
- Reviewer fix committed as 507571a: agentPid in src/pid.ts now reads through pidEntry instead of duplicating the pidfile read/parse (one-line dedup, identical semantics). All five suites re-run after the fix and pass; combined strict tsc (real 5.9.3, --strict --module nodenext, all files) counts 335 on the branch vs 338 on main - fewer errors, none new. State set back to to-review for the re-review.
- Review pass 2 (reviewer, branch tip 507571a): found a real client regression in the 755b654 rank dedup. syncBoard is interpolated into the PAGE as source text (${syncBoard}), but it now references the server-side import PRIORITY_RANK, which is never defined in the browser scope: the backlog sort threw ReferenceError on every 5 s refresh. The suite missed it because syncBoard runs in Node under module scope and the PAGE assertions are string matches. Fixed with the established LAYOUT pattern: the page now interpolates `const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)}` as a value next to LAYOUT, and webui.test.ts asserts the page ships it.
- Reviewer fix committed as 0fb0ccd (webui.ts one interpolation line, webui.test.ts one import + one assertion). All five suites re-run after the fix and pass (orchestrator smoke alone, same as baseline); strict tsc 5.9.3 --strict --module nodenext counts 357 on the branch vs 353 on main/merge-base: the +4 are mechanical artifacts of the pid.ts move and new import lines (pid.ts recreates the same process/NodeJS/node:* noise the moved-out code lost; one pre-existing TS5097 .ts-import instance per new import line), verified signature-by-signature against the merge-base, and the fix itself adds zero (357 before, 357 after). Rest of the re-review clean: agentHistory's agentAlive switch reads the same .pids/<slug>.pid file the old rolePid did (AGENT_ROLE never maps to merger), hub.ts/index.ts call pidAlive single-arg with identical semantics, appendNote/taskSlug/splitFrontmatter sites all verified. State set back to to-review for the re-review.
