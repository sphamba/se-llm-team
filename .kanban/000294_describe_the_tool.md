---
name: "docs: describe the tool and agent chain in the README"
priority: "medium"
state: "merging"
worktree: "docs/294-describe-the-tool"
issuer: "user"
complexity: "moderate"
blockedBy: ""
---

# Summary
Rewrite README.md and the three docs/*.md concise and human-readable: short sentences, general precise ideas, no exhaustive edge cases. The README gains the decided intro (1-2 sentences, agent bullet list, Mermaid chain) before Setup. Docs delegate full detail to links: agents/<role>.md prompts, skills/se-llm-team/SKILL.md, and source files.

# Specs
# Goal

The user: "The readme and the doc are impossible to read as a human (lengthy sentences, too much details). Make them all concise and clear. No need to be completely exhaustive, just give general (precise) ideas and put links to the prompts and skills for full details."

# Files

README.md, docs/architecture.md, docs/agents-and-tools.md, docs/development.md.

# Writing rules (all four files)

- Short sentences, one idea per sentence. No parenthetical chains, no multi-clause sentences.
- Keep the general behavior precise; drop edge cases, fallbacks and migration notes (e.g. retry cooldown details, quiet-gate exceptions, hub-election stale-daemon migration paragraphs shrink to a sentence or a link).
- Full detail moves to links: agents/<role>.md for each role's prompt, skills/se-llm-team/SKILL.md for the PM workflow, docs/*.md from the README, source files (src/orchestrator/*) where behavior lives.
- Facts must stay accurate: verify every kept claim against the code before writing it.

# README

- Keep the already-decided structure from this task's original spec: line 3 becomes the 1-2 sentence description (PM skill, non-LLM deterministic orchestrator, kanban pipeline of headless agents), then a bullet list of the six agent types in timeline order (one line each), then a Mermaid `flowchart TD` of the chain (plain chain, board node, subagents under developer and reviewer, one doctor node per notes-bearing role, no state labels), then `## Setup`.
- Trim the config table: Meaning cells keep the gist only (drop fallback/edge-case sentences). Keep table shape and all option names.
- Trim the MCP, Using-it and Configuration prose to short sentences. Keep all commands and paths exact.

# docs/

- architecture.md: keep section headings (Board, Orchestrator, Web dashboard); each state of the pipeline gets a short line, not a paragraph. Keep the state list exact.
- agents-and-tools.md: fix the two stale facts while rewriting: the live-tester ends with a finish message (no PM subagent), and the reviewer sets its own states (to-merge / to-review / to-do bounce) while the orchestrator moves the task on successful finish. Link each role to its agents/<role>.md file.
- development.md: already short; just tighten sentences.
- Do not delete information a reader needs to run or operate the tool (commands, config keys, paths, state names).

# Acceptance

- pnpm test scoped suites green (README is only a fixture in tests, no content pins exist today).
- Every Mermaid block renders on GitHub (fenced ```mermaid, valid flowchart syntax).
- A skim test: each file readable start to finish with only short sentences.

# Notes

Splitter note: no split. The task runs as one developer pass.

Why:

- The write surface is four small files: README.md (104 lines) and docs/ (101 lines total). One agent holds all of it in context.
- The four files describe the same six roles and the same state pipeline. The README agent bullets, the README Mermaid chain, the architecture state lines and the agents-and-tools role table must agree. A split derives those facts twice. It also puts the two stale-fact fixes (live-tester finish message, reviewer state writes) in a different subtask from the Mermaid that shows the same behavior.
- Fact checking against agents/*.md and src/orchestrator/* is the main cost. Parallel subtasks repeat it.
- Two or three review, merge and live-test cycles for a prose change cost more than the wall clock saved.

Durable guidance for future Splitters: a docs rewrite does not parallelize by file when the files share the same facts. Split a docs task only when the pieces touch disjoint fact sets, for example install and setup prose in one piece and a new document that no other file links to in another.

Developer pass:

- Rewrote README.md, docs/architecture.md, docs/agents-and-tools.md and docs/development.md. Commit subject: `docs: make the README and docs concise`.
- README now has the 2-sentence intro, the six agent bullets with per-role prompt links, the Mermaid `flowchart TD` chain with subagents under developer and reviewer and four doctor nodes, then `## Setup`. Setup, Using it, MCP, Configuration and Documentation prose were trimmed. The config table keeps every row and option name with shorter Meaning cells.
- architecture.md keeps the Board, Orchestrator and Web dashboard sections and gives each of the 10 states one short line. It adds the splitter step, the reviewer state decisions, the board report, the mirror push and the hub election as short paragraphs.
- agents-and-tools.md adds the Splitter and the Doctor, links every role to its prompt, fixes the two stale facts (live-tester finish message and no PM task creation, reviewer writes its own states), and lists all 12 tools including `kanban_mark_processed`.
- development.md is tightened and now says the Splitter runs at the project root, not in the task worktree.
- No docs content test exists and README is only a fixture in tests. No new test was added. Scoped check: `node tests/plugin.test.ts` passed. A one-off link checker found no broken relative links and parsed both JSON examples.
- Independent fact check found and fixed four inaccuracies before the commit: the removed claim that pi `skills` settings entries are toggles (they are skill paths), the task slug cap for a supplied `shortName` (5 words), the optional `shortName`/`blockedBy` frontmatter and optional `# Open questions`, and the worktree creation order after the Splitter. It also found the Splitter cwd contradiction in development.md.
- No open user or client questions.

Review pass (reviewer, `main...HEAD`, 2 commits):

- Files: README.md, docs/architecture.md, docs/agents-and-tools.md, docs/development.md. Diff stat 109 insertions, 72 deletions. Tree was clean at the start.
- Writing rules: a one-off scanner found no prose sentence over 28 words, no parenthetical chain and no em dash. A relative-link checker over the four files found zero broken links.
- README structure: the 2-sentence intro is README.md:3, the six agent bullets with per-role prompt links are :5-10, and the `flowchart TD` is :12. It has the board node, the plain chain, subagent nodes under the developer and reviewer, four doctor nodes that feed `Role notes`, and no state labels. `## Setup` is :33. The Mermaid block is fenced and every node label is quoted, so the syntax is valid by inspection. It was not rendered on GitHub here, because that belongs to the live test.
- Config table: all 13 rows and every option name are kept. Defaults match src/orchestrator/config.ts:7-24,86,197-201 and src/webui/page.ts:9-10. Commands and paths are unchanged (README.md:95).
- docs/architecture.md: the Board, Orchestrator and Web dashboard headings are kept. The state list is exact at :11, and each state has one bullet at :16-27. The Splitter gate (moderate and complex, cwd = project root) matches src/orchestrator/pipeline.ts:30,56. The worktree creation after the Splitter, and the `doing` set before the Developer spawn, match :59-68. The reviewer cap matches :374-390. The rebase in to-merge and `merging` on a stopped rebase match :183,198,207. The report, mirror and hub election claims match src/orchestrator/report.ts:79-81, src/orchestrator/board.ts:13,117 and src/hub.ts:383,496.
- One inaccuracy found and fixed: both docs called the merger's state move "forward", but merging -> to-merge is one step back (src/orchestrator/liveness.ts:16-19). docs/architecture.md:30 and docs/agents-and-tools.md:23 now say the developer goes to to-review, the live-tester to done, and a merger returns the task to to-merge. Commit `1cca374`.
- docs/agents-and-tools.md: the two stale facts are fixed. The live-tester ends with a finish message and creates nothing (agents/live-tester.md:13-14). The reviewer sets its own states (agents/reviewer.md:19-21). Every role links to its agents/<role>.md file. The Splitter gets only the SPECS.md link at the project root (src/orchestrator/spawn.ts:51-56). All 12 listed tools exist in `TOOLS` (src/tools.ts:65). The doctor pass claim matches src/orchestrator/liveness.ts:213-216 and src/analysis-run.ts:42.
- docs/development.md: the pnpm pin matches package.json:6-7. `tests/efficiency-analysis/helpers.ts` exists. The test glob matches package.json:8.
- Tests: `node tests/plugin.test.ts` exit 0. No docs content pin exists, and README is only a fixture at tests/helpers.ts:25. No suite covers the docs themselves.
- Non-blocking: the PM session also gets a 13th tool, `efficiency_analysis` (src/tools.ts:316). The tools paragraph (docs/agents-and-tools.md:27) and the "12" count leave it out. This is accurate for the stated kanban and orchestrator subset, but the tool is undocumented.
- Non-blocking: the Web dashboard section (docs/architecture.md:40-42) no longer names the config file path. The path is now only in README.md:95.
- Non-blocking: the Mermaid chain shows Reviewer -> Merger -> Live-tester for every task. The merger runs only on a rebase conflict, and the Merger bullet at README.md:8 states this.
- No open user or client questions. `# Open questions` stays absent because the Specs answer every question that came up.

Second review pass (re-review of the fix commit, `main...HEAD`, 2 commits):

- Fix commit `1cca374` changes one line in docs/architecture.md:30 and one line in docs/agents-and-tools.md:23. Both now say the orchestrator moves the developer to to-review and the live-tester to done, and that a merger returns the task to to-merge.
- Claim check: `src/orchestrator/liveness.ts:19` maps `merging` with a successful finish to `to-merge`. `src/orchestrator/pipeline.ts:215` sets to-live-test after the merge sweep. The fix is correct.
- Writing rules: the new sentences are short and have no parenthetical chain. The other lines of the four files are unchanged since the first pass.
- README structure, Mermaid block, config table and state list are unchanged since the first pass, and their evidence stands.
- Tests: `node tests/plugin.test.ts` exit 0. No suite pins the docs content.
- Non-blocking notes from the first pass stand: the 13th tool `efficiency_analysis` is not in the tools paragraph, the dashboard config path is only in README.md:95, and the Mermaid chain shows the merger for every task.
- No fixes made. No open user or client questions. `# Open questions` stays absent.
