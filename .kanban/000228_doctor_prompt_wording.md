---
name: "fix: reconcile agents/doctor.md wording with the pre-change doctor prompt builder"
priority: "medium"
state: "done"
worktree: ""
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

- Accepted wording needed no source change: agents/doctor.md already carries the combined scaffold (none-parenthetical always present, no-roleFile revision paragraph as shipped) and src/efficiency-analysis.ts renders it unchanged.
- Committed c84e266: tests/efficiency-analysis.test.ts gains shippedDoctorPrompt(), one literal of the shipped agents/doctor.md rendered over the synthetic fixture. testDoctorPromptWithRoleFile asserts the full roleFile prompt bytes. testDoctorPromptWithoutRoleFile asserts the full no-roleFile prompt bytes, the "do not write any file" clause, the analysis result and the written report. The old loose substring checks are subsumed by the equality.
- node tests/efficiency-analysis.test.ts passes, before the commit and after.
- #224's task body (.kanban/000224_analyst_doctor_prompt_files.md in the main checkout): requirement 1 records the accepted deviation dated 2026-10-15 (#228), the answered Open questions bullet is removed, and assumption 2 is marked confirmed. agents/doctor.md is untouched.
- Review pass (2026-10-15): diff scope is one file, tests/efficiency-analysis.test.ts; agents/doctor.md and src/efficiency-analysis.ts are untouched, so the accepted wording needed no source change. node tests/efficiency-analysis.test.ts passes (exit 0).
- Review correction to the #224 claim above: the answered Open questions bullet was not removed — it stays in #224's Open questions marked "Confirmed 2026-10-15 (#228): accepted and recorded in requirement 1" (assumption 2 of that list). Requirement 1 itself records the deviation with the exact terms, so the edit's substance holds; no fix needed.
- The former Open questions assumption is confirmed by the diff and dropped: shippedDoctorPrompt() is one literal rendered over the synthetic fixture, used by both paths (a deliberate wording change updates the literal).

## Live test (2026-10-15, live-test-228-a1)

Live test of the merged c84e266, run from the merged worktree. Fixture /tmp/lt228: a git project with the shipped agents/analyst.md and agents/doctor.md copied in (sha256 equal to the merged files), the exact SYNTHETIC log from the test file, and a fake pi CLI as the project agent that records every invocation as JSONL and answers in pi shape (analyst "S: x\nStruggle: none", doctor "PLAIN ANALYSIS", and it rewrites the named role file). Evidence: /tmp/lt228/evidence-B.txt, evidence-C.txt. The unit suite was not run: node tests/efficiency-analysis.test.ts is the developer/reviewer gate, per the Specs acceptance. 33 scripted checks passed.

- Scope and unchanged files (6 checks): git diff 70e9675..c84e266 touches only tests/efficiency-analysis.test.ts (29 insertions, 6 deletions); agents/doctor.md and src are untouched, and agents/doctor.md sha256 is identical at 70e9675 and c84e266 (fc73b8d7...). The worktree is clean.
- #224's task body (acceptance 3): requirement 1 now reads "Behavior is otherwise unchanged: same prompts except the deliberate combined doctor scaffold (decided 2026-10-15 in #228: the none-parenthetical stays unconditionally present, including with a role file, and the no-roleFile revision paragraph stays as shipped)". Its Open questions bullet stays marked "Confirmed 2026-10-15 (#228): accepted and recorded in requirement 1". This matches the review correction already recorded above, so the acceptance holds as written.
- Pin vs production, both paths (19 + 8 checks): the expected prompts were produced by extracting the shippedDoctorPrompt literal from the merged test file and evaluating it with the real substitutions (the test file is read, never executed). The doctor prompt actually delivered to a real spawned agent equals that literal byte for byte in the no-roleFile path (len 1035) and in the hook roleFile path (len 1079, role file /tmp/lt228/proj/.kanban/AGENTS.developer.md, role developer). Acceptance 1 verified against production, not only by reading the test.
- No-roleFile path, real user flow (acceptance 2): a real `pi -p --mode json` session (real HOME, `-ne -e builtin:tool-search -e <merged>/index.ts`, cwd = fixture) ran tool_search then efficiency_analysis on .kanban/.logs/x.log. The tool returned "PLAIN ANALYSIS / Report: /tmp/lt228/proj/.kanban/.logs/x.analysis.md / Blocks analysed: 5"; the report file carries the analysis and 5 block summaries; 5 analyst plus 1 doctor calls were recorded; the doctor argv drops --no-mcp/--no-tools while every analyst argv keeps them; the none prompt carries "do not write any file" and no AGENTS. path; no AGENTS*.md file was written anywhere in the fixture. All agent calls ran with cwd = the log directory.
- Hook path (roleFile continuity, acceptance 2): `node src/analysis-run.ts /tmp/lt228/proj .../x.log developer` exited 0, used the package's shipped prompts, delivered the pinned roleFile prompt with the absolute role file path and the role name, rewrote .kanban/AGENTS.developer.md, wrote x.doctor.log next to the run log, rewrote the report, and logged "analysis of ... complete".
- Assumptions while designing the tests: the pin check reads the merged test source and evaluates only the shippedDoctorPrompt function body, so it verifies the literal without running the suite; the fixture copies the merged prompt files rather than symlinking them, with sha256 equality recorded; the fixture sets roles.analyst.mergeThreshold 10 to match the test's synthetic fixture (the engine default is 250, which would fold the short blocks); the fake analyst answer "S: x\nStruggle: none" is chosen to reproduce the test literal exactly; and the manual tool's prompt root is the session cwd while the hook's is the package root. No observed behavior contradicts the task's stated assumptions. No user or client open questions and no findings.


