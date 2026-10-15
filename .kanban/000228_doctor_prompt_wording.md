---
name: "fix: reconcile agents/doctor.md wording with the pre-change doctor prompt builder"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#224"
complexity: "simple"
shortName: "doctor-prompt-wording"
---

# Summary
agents/doctor.md is not byte-identical to the pre-change doctorPrompt builder, deviating from #224 requirement 1 ("Behavior is otherwise unchanged: same prompts"): the shipped file always carries the parenthetical " (a role file of none means there is no role file: do not write any file, produce the report only)", so the hook path (roleFile present) gains that clause, and the no-roleFile variant's revision paragraph is longer than the old report-only one-liner. Decide whether to accept the one combined wording or restore the roleFile variant byte-for-byte, then record the decision and make the code/file match it.

# Specs
# Background
Live-test finding 1 of #224 (state live-testing), task file .kanban/000224_analyst_doctor_prompt_files.md under "# Notes extra: live test (2026-10-15)".

# Evidence
- Differential phase 4 in /tmp/lt224/evidence-final.txt: the analyst prompts and both analyst/doctor spawn argvs are byte-identical to the pre-change code; only the doctor prompt text differs. The direct comparison was against the pre-change builder archived from commit e424cd3~1.
- agents/doctor.md line 8 carries the none-parenthetical unconditionally; #224 Notes (implementation note "The doctor template is one combined scaffold, not two variants") already record this as a deliberate deviation, and assumption 2 ("One combined doctor template is acceptable...") says confirm or correct.

# Work
1. Get the answer to the open question: accept the combined template as-is (and update #224's Specs/Notes wording to record the accepted deviation, since the shipped behavior then contradicts requirement 1 as written), or restore the roleFile-present prompt byte-for-byte as requirement 1 says (e.g. a second template or a conditional clause the engine drops when a role file is given).
2. Implement the chosen option and keep the no-roleFile path working ({{roleFile}}/{{role}} = "none", doctor writes no file).
3. Update tests/efficiency-analysis.test.ts (testDoctorPromptWithoutRoleFile and the hook/roleFile path) to pin the chosen bytes, and update agents/doctor.md only if the accept option is chosen in narrative form.

# Acceptance
- agents/doctor.md renders byte-identical to the pre-change doctorPrompt builder for the roleFile path, or the accepted combined wording is recorded in #224's task body as the corrected requirement 1 interpretation.
- The no-roleFile path still tells the doctor not to write any file and produces the report.
- The affected suite (node tests/efficiency-analysis.test.ts) passes.

# Notes

# Open questions
Accept the one combined agents/doctor.md wording (none-parenthetical always present; no-roleFile revision paragraph longer than the old report-only one-liner), or restore the roleFile variant byte-for-byte as #224 requirement 1 ("same prompts") says?
