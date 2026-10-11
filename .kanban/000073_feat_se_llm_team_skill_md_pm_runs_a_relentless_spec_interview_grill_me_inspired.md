---
name: "feat: se-llm-team SKILL.md; PM runs a relentless spec interview (grill-me inspired)"
priority: "medium"
state: "live-testing"
worktree: "feat/se-llm-team-skill-md-pm-runs-a-relentless-spec-interview-grill-me-inspired"
---

# Summary
Rewrite step 2 of the se-llm-team skill's session flow so the project manager runs a relentless, rounds-based clarification interview (design tree of decisions, facts delegated to the Explorer, decisions put to the user, nothing silently assumed) before writing any Specs, without importing grill-me's tool rules.

# Specs
Expand the project manager's clarification behavior in the se-llm-team skill, taking the WHAT from grill-me (ask questions relentlessly) but not the HOW (no tool names, no tool-use rules).

Facts:
- The skill source lives in this repo at skills/se-llm-team/SKILL.md (relative to the repo root). The installed copy at ~/.pi/agent/skills/se-llm-team is a symlink to the repo directory (README.md:11), so the installed PM always reads the repo file. Worktree/merge flow applies normally.
- Its session flow step 2 today: "Ask the user what to build, or which feedback to turn into tasks. Ask clarification questions until you and the user agree. Delegate fact-finding to an Explorer subagent (subagent_type explorer): it gathers info on the codebase and external resources when planning and exploring a task. Leave decisions to the user." Step 5: "Write the Specs with the user's answers."
- Inspiration source: /home/phamba/.pi/agent/skills/grill-me/SKILL.md. Its WHAT: interview the user relentlessly until shared understanding; map the interview as a design tree (every decision a node, its dependencies children); work in rounds; ask only the questions whose prerequisites are already settled, the ones that unblock the most first; each round of answers reshapes the tree, then ask the next round; facts are the interviewer's job (dispatch a sub-agent, never ask the user what can be looked up), decisions are the user's; a question downstream of a running exploration waits for it; declined answers mean stop and wait, never repeat; end state: nothing silently assumed, act only on user confirmation.
- Note: an edit matching this spec already exists, uncommitted, in the root working tree of skills/se-llm-team/SKILL.md (applied through the home symlink by the in-flight developer before the worktree was assigned). Verify it against this spec, ship it through the normal branch flow, and leave the root working tree clean afterwards.

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
- The change is committed on the task branch and lands on skills/se-llm-team/SKILL.md in the repo; the root working tree is clean afterwards; the frontmatter stays valid.

Constraints:
- File: skills/se-llm-team/SKILL.md (relative to the repo root). The repo file is the target; editing through the home symlink is not the target.
- Keep the skill's existing structure (Board, Session flow, Watcher subagent sections) intact apart from the step-2 rewrite and the step-5 gate.

# Notes

- Edited the deployed skill file /home/phamba/.pi/agent/skills/se-llm-team/SKILL.md in place, and mirrored the same change into the repo copy skills/se-llm-team/SKILL.md (worktree commit b88f2b9). The two copies are identical, as they were before the edit.
- Step 2 of the session flow now runs a relentless clarification interview before any Specs are written: map the interview as a design tree (each decision a node, its dependencies children), work the tree in rounds, ask only the questions whose prerequisites are settled and that unblock the most branches first, keep asking until every branch is visited and nothing is silently assumed. The interview must cover goal, scope, constraints, acceptance criteria, edge cases, and priority. Vague answers are challenged, not guessed.
- The role split stays and is sharper: facts are the PM's job through the Explorer subagent (existing subagent_type explorer reference kept), never ask the user what can be looked up. Decisions go to the user, one by one, and the PM waits. A question downstream of a running exploration waits for the report.
- Decline-and-wait rule added: if the user declines to answer, stop the interview and wait for the user to speak. Never repeat the same questions.
- Step 5 is now gated on the interview: write the Specs only when the step 2 interview is done and nothing is silently assumed, otherwise keep asking.
- No tool names, package names, dialog-field rules, or option-label rules were added. The other steps of the flow, the Board and Watcher subagent sections, and the frontmatter are unchanged.
- Correction after the spec update: ~/.pi/agent/skills/se-llm-team is a symlink to the repo root working tree, so the edit through the home path was the one uncommitted change in the root checkout, not a separate deployed copy. Verified it against this spec (identical to worktree commit b88f2b9), shipped it through the normal branch flow (commit b88f2b9 on the task branch, file skills/se-llm-team/SKILL.md), and restored the root working tree to clean (git status clean, HEAD unchanged at 967ba8c).
- Review (reviewer): verified the branch against the Specs. All 14 conformance checks pass: design tree, rounds, prereq-settled/unblock-the-most, nothing silently assumed, coverage list (goal, scope, constraints, acceptance criteria, edge cases, priority), challenge vague answers, fact/decision split, explorer reference, never-ask-what-you-can-look-up, decisions to the user and wait, downstream-exploration wait, decline-and-wait, never-repeat, and the step-5 gate. Grep found no grill-me HOW leaks (no ask_user_question, package names, dialog fields, option labels, frontier, or 4-question caps). Only steps 2 and 5 changed; Board, Watcher subagent, and frontmatter (valid YAML, name/disable-model-invocation intact) are untouched. Root checkout confirmed clean at 967ba8c on main.
- Review fix: the new step-2 bullet carried one semicolon ("Each round of answers reshapes the tree; ask the next round..."). Split into two sentences in commit 3ea3e44. The three pre-existing semicolons elsewhere in the file stay out of scope per the spec (only step 2 and the step-5 gate change).
- Re-review after fix 3ea3e44 (reviewer): no new issues. Re-verified all conformance checks on the fixed branch: design tree, rounds, prereq-settled/unblock-the-most (no 4-question cap), nothing silently assumed, coverage list, challenge vague answers, fact/decision split, explorer reference, never-ask-what-you-can-look-up, decisions to the user and wait, downstream-exploration wait, decline-and-wait, never-repeat, and the step-5 gate. Confirmed against the grill-me source: all WHAT items covered, no HOW leaks (grep for ask_user, dialog, option labels, frontier, caps, mcp__, tool-result parsing found nothing). Step 2 and step 5 are now free of semicolons. Diff touches only steps 2 and 5; Board, Watcher, and frontmatter (valid YAML, name/description/disable-model-invocation) are byte-identical to main. Branch clean, 2 commits (b88f2b9, 3ea3e44). Root checkout clean at 967ba8c. No fixes made this round.
