---
name: "feat: se-llm-team SKILL.md; PM runs a relentless spec interview (grill-me inspired)"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Rewrite step 2 of the se-llm-team skill's session flow so the project manager runs a relentless, rounds-based clarification interview (design tree of decisions, facts delegated to the Explorer, decisions put to the user, nothing silently assumed) before writing any Specs, without importing grill-me's tool rules.

# Specs
Expand the project manager's clarification behavior in the se-llm-team skill file, taking the WHAT from grill-me (ask questions relentlessly) but not the HOW (no tool names, no tool-use rules).

Facts:
- The PM's skill file: /home/phamba/.pi/agent/skills/se-llm-team/SKILL.md (outside this repo; edit in place - no worktree or merge applies).
- Its session flow step 2 today: "Ask the user what to build, or which feedback to turn into tasks. Ask clarification questions until you and the user agree. Delegate fact-finding to an Explorer subagent (subagent_type explorer): it gathers info on the codebase and external resources when planning and exploring a task. Leave decisions to the user." Step 5: "Write the Specs with the user's answers."
- Inspiration source: /home/phamba/.pi/agent/skills/grill-me/SKILL.md. Its WHAT: interview the user relentlessly until shared understanding; map the interview as a design tree (every decision a node, its dependencies children); work in rounds; ask only the questions whose prerequisites are already settled, the ones that unblock the most first; each round of answers reshapes the tree, then ask the next round; facts are the interviewer's job (dispatch a sub-agent, never ask the user what can be looked up), decisions are the user's; a question downstream of a running exploration waits for it; declined answers mean stop and wait, never repeat; end state: nothing silently assumed, act only on user confirmation.

Changes:
1. Rewrite step 2 of the session flow to instruct a relentless clarification interview before any Specs are written: map the interview as a design tree of decisions (each decision a node, its dependencies children), work the tree in rounds, ask only the questions whose prerequisites are settled, the ones that unblock the most first, and keep asking until every branch is visited and nothing is silently assumed.
2. Keep and sharpen the existing role split: facts are the PM's job (delegate to the Explorer subagent, never ask the user what can be looked up), decisions are the user's (put each one to them and wait). A question downstream of a running exploration waits for it to report.
3. Require the interview to cover, before the Specs are written: goal, scope, constraints, acceptance criteria, edge cases, and priority. Challenge vague answers instead of guessing.
4. Add the decline-and-wait rule: if the user declines to answer, stop the interview and wait for the user to speak; never repeat the same questions.
5. Gate step 5 on the interview: write the Specs only when the interview is done (nothing silently assumed); otherwise keep asking.
6. Drop grill-me's HOW: no tool names, no package names, no dialog-field rules, no option-label rules. Keep the skill's existing tool-agnostic tone; the existing kanban tool references in the skill stay as they are (this task only expands the questioning behavior).

Acceptance:
- Step 2 of the SKILL.md instructs a rounds-based, tree-mapped relentless interview with the fact/decision split and the decline-and-wait rule.
- No tool names or dialog-field rules are added beyond what the skill already references.
- The other steps of the flow keep their meaning; only step 2 (and the step-5 gate) change.
- The skill file frontmatter stays valid; the file is edited in place.

Constraints:
- File: /home/phamba/.pi/agent/skills/se-llm-team/SKILL.md (absolute path, outside this repo - edit in place; the branch may carry no code change).
- Keep the skill's existing structure (Board, Session flow, Watcher subagent sections) intact apart from the step-2 rewrite and the step-5 gate.

# Notes
