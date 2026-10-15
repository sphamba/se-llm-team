---
name: "fix: reconcile agents/doctor.md wording with the pre-change doctor prompt builder"
priority: "medium"
state: "doing"
worktree: "fix/228-doctor-prompt-wording"
issuer: "#224"
complexity: "simple"
shortName: "doctor-prompt-wording"
---

# Summary
agents/doctor.md is not byte-identical to the pre-change doctorPrompt builder, deviating from #224 requirement 1 ("Behavior is otherwise unchanged: same prompts"): the shipped file always carries the parenthetical " (a role file of none means there is no role file: do not write any file, produce the report only)", so the hook path (roleFile present) gains that clause, and the no-roleFile variant's revision paragraph is longer than the old report-only one-liner. Decide whether to accept the one combined wording or restore the roleFile variant byte-for-byte, then record the decision and make the code/file match it.

# Specs
# Background
Live-test finding 1 of #224 (done), task file .kanban/000224_analyst_doctor_prompt_files.md under "# Notes extra: live test (2026-10-15)".

# Decision (2026-10-15, user)
Accept the one combined agents/doctor.md wording as-is: the none-parenthetical stays unconditionally present, and the no-roleFile revision paragraph stays as shipped. Byte-parity with the pre-change builder is not required: one editable file is the point of #224, and the deviation is already recorded as deliberate in #224's Notes. #224's requirement 1 ("Behavior is otherwise unchanged: same prompts") is corrected to mean: same prompts except the deliberate combined doctor scaffold.

# Work
1. Update #224's task body so requirement 1 records the accepted deviation (the combined doctor scaffold: none-parenthetical always present; the no-roleFile revision paragraph as shipped). agents/doctor.md itself stays unchanged: it already carries the accepted wording.
2. Keep the no-roleFile path working ({{roleFile}}/{{role}} = "none", doctor writes no file).
3. Update tests/efficiency-analysis.test.ts (testDoctorPromptWithoutRoleFile and the hook/roleFile path) to pin the shipped bytes, so the suite matches the accepted wording.

# Acceptance
- tests/efficiency-analysis.test.ts pins the shipped agents/doctor.md bytes for both the roleFile and no-roleFile paths.
- The no-roleFile path still tells the doctor not to write any file and produces the report.
- #224's task body records the accepted deviation as the corrected requirement 1 interpretation.
- node tests/efficiency-analysis.test.ts passes.

# Notes

# Open questions

