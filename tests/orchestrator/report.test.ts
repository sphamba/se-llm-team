import assert from "node:assert/strict";
import { createTask, parseTask, setState, taskNum, taskSlug } from "../../src/kanban.ts";
import { composeReport } from "../../src/orchestrator/report.ts";
import { cleanupAll, cleaned, fixture } from "../helpers.ts";

// --- part A: the auto issuer never reads as a finding
// composeReport collects the findings of a finished task by the issuer ref "#<num>"; the
// orchestrator's own integration-test task carries issuer "auto", so it can never be listed as
// a finding of the task whose live test created it
const root = fixture();
cleaned.push(root);

const covered = createTask(root, { name: "feat: covered", summary: "The covered change.", specs: "n/a" });
setState(root, covered, "done");
const coveredNum = taskNum(covered.file);
const integration = createTask(root, { name: `test: integration of #${coveredNum}`, shortName: `integration-of-${coveredNum}`, summary: `Integration test of the merged base branch after #${coveredNum}.`, specs: "n/a", issuer: "auto" });
setState(root, integration, "to-integration-test");
const finding = createTask(root, { name: "fix: found thing", summary: "A defect the live test found.", specs: "n/a", issuer: `#${coveredNum}`, openQuestions: "The thing broke." });

const report = composeReport(root, [parseTask(root, covered.file)], []);
assert.ok(report.includes("## Done"), "the report lists the finished task");
assert.ok(report.includes(`## Live-test findings for feat: covered (#${coveredNum})`), "the report opens the findings section of the finished task");
assert.ok(report.includes("### fix: found thing"), "a task issued by the finished task is a finding");
assert.ok(report.includes("The thing broke."), "the finding carries its open questions");
assert.ok(!report.includes(taskSlug(integration.file)), "an auto-issued task is never listed as a finding");
assert.ok(!report.includes("test: integration of"), "the auto-issued task's name never reaches the report");
assert.equal(report.split("### ").length - 1, 1, "exactly one finding block");
assert.equal(taskSlug(finding.file).length > 0, true, "the finding task exists");

cleanupAll(...cleaned);
console.log("report.test.ts: auto issuer is never a finding passed");
