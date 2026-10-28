import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, taskNum, taskSlug, updateTask } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan, stuckPath } from "../../src/orchestrator/pipeline.ts";
import { reportsDir } from "../../src/orchestrator/report.ts";
import { agentAlive, pidAlive, pidPath } from "../../src/pid.ts";
import { exitFilePath, readMergerSlug, renderPrompt, readExitCode } from "../../src/orchestrator/spawn.ts";
import { cleanupAll, cleaned, fixture, mirrorSubjects, roleStub, runDaemon, waitFor } from "../helpers.ts";

const mergeRoot = () => {
	const root = fixture();
	cleaned.push(root);
	mkdirSync(kanbanDir(root), { recursive: true });
	return root;
};

// the direct-drive harness: the sweep spawns the merger, the test waits for its exit and then
// lets one poll apply the result, so no daemon timing sits between the two steps
const cfgFor = (root: string, agent: string, patch: Record<string, unknown> = {}) =>
	Object.assign(loadConfig(root), { agent, backlogIdleMinutes: 0, ...patch });

const drive = async (root: string, cfg: ReturnType<typeof loadConfig>) => {
	rescan(root, cfg);
	// the exit file is written by the spawn wrapper after the agent dies, so wait for both
	await waitFor(
		() => !agentAlive(root, "merger") && readExitCode(root, "merger") !== null,
		30000,
		"the merger exited and recorded its code",
		() => "",
	);
	poll(root, 5);
};

const rebasing = (wt: string) => {
	const path = execSync("git rev-parse --git-path rebase-merge", { cwd: wt, encoding: "utf8" }).trim();
	return existsSync(isAbsolute(path) ? path : join(wt, path));
};

const orchLog = (root: string) => {
	try {
		return readFileSync(join(kanbanDir(root), ".logs", "orchestrator.log"), "utf8");
	} catch {
		return "";
	}
};

const subjects = (root: string, rev: string) => execSync(`git log --format=%s ${rev}`, { cwd: root, encoding: "utf8" }).trim().split("\n");

// the merger stub for the direct-drive cases: it starts the rebase the prompt names, keeps its
// own side on every conflict (--theirs in a rebase) and finishes with exit 0. The mode decides
// what else it does, per the case
const caseStub = (root: string, mode: string, other = "") => {
	const stub = join(root, "case-merger.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
if (!prompt.includes("Merger agent")) process.exit(0);
const cmd = ${JSON.stringify(mode)};
const other = ${JSON.stringify(other)};
const sh = (c) => { try { return execSync(c).toString(); } catch { return ""; } };
const trySh = (c) => { try { execSync(c, { stdio: "ignore" }); return true; } catch { return false; } };
const base = (prompt.match(/git rebase (?!-)([\\w./-]+)/) ?? [])[1] ?? "main";
// the give-up mode exits without touching the branch; the agent really did run
if (cmd === "abort") process.exit(0);
trySh("git rebase " + base);
for (let i = 0; i < 9; i++) {
	const files = sh("git diff --diff-filter=U --name-only").trim().split("\\n").filter(Boolean);
	if (!files.length) break;
	for (const f of files) { trySh("git checkout --theirs -- " + f); trySh("git add -- " + f); }
	if (!trySh("GIT_EDITOR=true git rebase --continue")) break;
}
if (cmd === "note") appendFileSync("SPECS.md", "- merge: README.md hunk one, kept both sides\\n- merge: README.md hunk two, kept both sides\\n");
if (cmd === "drop") appendFileSync("SPECS.md", "\\n# Open questions\\n\\n- the other task changed README.md too, see " + other + "\\n");
if (cmd === "fail") writeFileSync("SPECS.md", readFileSync("SPECS.md", "utf8").replace(/^state: .*/m, 'state: "to-do"'));
process.exit(0);
`,
		{ mode: 0o755 },
	);
	return stub;
};

// a branch that really conflicts with main: both sides edit README.md, so the rebase stops
const conflicting = (root: string, branch: string, mine: string, theirs: string) => {
	execSync(`git checkout -qb ${branch}`, { cwd: root, shell: "/bin/bash" });
	writeFileSync(join(root, "README.md"), `${mine}\n`);
	execSync("git commit -qam branch", { cwd: root, shell: "/bin/bash" });
	execSync("git checkout -q main", { cwd: root, shell: "/bin/bash" });
	writeFileSync(join(root, "README.md"), `${theirs}\n`);
	execSync("git commit -qam main", { cwd: root, shell: "/bin/bash" });
};

// --- part G: the to-merge sweep waits for the task's registered agent to die, and the live
// test runs on the merged commit in the worktree ---
const rootG = fixture();
const taskG = createTask(rootG, { name: "fix: defer merge while alive", summary: "Deferred merge smoke", specs: "n/a" });
setState(rootG, taskG, "to-review");
mkdirSync(kanbanDir(rootG), { recursive: true });
const wtG = join(rootG, ".worktrees", "fix/1-defer-merge-while");
// reviewer stub that waits for the armed marker, re-affirms to-review (a fixes run), then
// lingers alive before exiting: the to-merge advance lands while it lingers, so the to-merge
// sweep must wait for its pid before it spawns the merger
writeFileSync(
	join(rootG, "linger-agent.cjs"),
	`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync, existsSync, readlinkSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = "SPECS.md";
let front = "";
let taskFile = "";
try {
	front = readFileSync(file, "utf8");
	taskFile = readlinkSync(file);
} catch {}
if (!front.match(/^state: /m)) process.exit(0);
const armed = () => join(dirname(taskFile), ".logs", basename(taskFile, ".md") + ".reviewer-armed");
const waitUntil = (cond, ms) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
};
if (prompt.includes("Reviewer agent")) {
	waitUntil(() => existsSync(armed()), 10000);
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "to-review"'));
	waitUntil(() => !existsSync(armed()), 10000);
	setTimeout(() => process.exit(0), 3000);
} else if (prompt.includes("Live-tester")) {
	appendFileSync(file, "\\nLive test report: merge deferred until the reviewer finished.\\n");
	process.exit(0);
} else if (prompt.includes("Merger agent")) {
	try {
		require("node:child_process").execSync("git rebase main", { stdio: "ignore" });
	} catch (e) {}
	process.exit(0);
}
`,
	{ mode: 0o755 },
);
writeFileSync(join(rootG, "se-llm-team.json"), JSON.stringify({ agent: join(rootG, "linger-agent.cjs"), pollMinutes: 0.01, reviewerCap: { moderate: 1 }, backlogIdleMinutes: 0 }));

const g = await runDaemon(rootG);
await waitFor(() => parseTask(rootG, taskG.file).state === "to-merge", 30000, "cap advance to to-merge", g.output);
const livePidG = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootG), ".pids", `${taskG.file.replace(/\.md$/, "")}.pid`), "utf8").trim(), 10);
	} catch {
		return 0;
	}
};
await waitFor(
	() => {
		if (!pidAlive(livePidG())) return true;
		assert.ok(existsSync(wtG), "worktree kept while the reviewer pid is alive");
		assert.ok(!g.output().includes("fast-forwarded main to fix/1-defer-merge-while, set to-live-test"), "no merge while the reviewer pid is alive");
		assert.ok(!mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), "no done mirror commit while the reviewer pid is alive");
		return false;
	},
	30000,
	"reviewer pid death",
	g.output,
);
await waitFor(() => g.output().includes("fast-forwarded main to fix/1-defer-merge-while, set to-live-test"), 30000, "the merger finished after the reviewer died", g.output);
await waitFor(() => g.output().includes("spawned live-tester") && g.output().includes(`(cwd=${wtG})`), 30000, "live-tester runs in the task worktree", g.output);
await waitFor(() => !existsSync(wtG), 30000, "worktree removed at done", g.output);
await waitFor(() => mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), 30000, "deferred done mirror commit", g.output);
const committedG = execSync(`git show refs/heads/meta/kanban:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merge deferred until the reviewer finished\./, "live test report folded into the done mirror commit");
g.daemon.kill("SIGTERM");

// --- part J: a conflict-marked task file is left untouched until the merger resolves it ---
const rootJ = fixture();
mkdirSync(kanbanDir(rootJ), { recursive: true });
writeFileSync(join(rootJ, "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootJ), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskJ = createTask(rootJ, { name: "fix: conflicted task", summary: "Mid-merge conflict", specs: "n/a" });
setState(rootJ, taskJ, "to-do");
const taskFileJ = join(kanbanDir(rootJ), taskJ.file);
writeFileSync(
	taskFileJ,
	readFileSync(taskFileJ, "utf8").replace(
		/^state: "to-do"$/m,
		'<<<<<<< HEAD\nstate: "done"\n=======\nstate: "to-live-test"\n>>>>>>> fix/other-branch',
	),
);
const rawJ = readFileSync(taskFileJ, "utf8");

const j = await runDaemon(rootJ);
await new Promise((r) => setTimeout(r, 2000));
assert.ok(!j.output().includes("spawned developer"), "no agent spawned from a conflicted task file");
assert.ok(j.output().includes("unresolved merge conflict markers"), "daemon logs the skipped conflicted file");
assert.equal(readFileSync(taskFileJ, "utf8"), rawJ, "conflicted task file untouched by the daemon");
j.daemon.kill("SIGTERM");
cleanupAll(rootG, rootJ);

console.log("merge.test.ts: reviewer-defer and conflict-skip smoke passed");

// --- part A: a clean rebase. The sweep spawns the merger in the worktree and runs no git of
// its own: main stays where it is until the merger's clean exit, and the poll then proves the
// result, fast-forwards the base and moves the task to its live test ---
const rootA = mergeRoot();
execSync("git checkout -qb feat/clean-merge && git commit -q --allow-empty -m clean-change && git checkout -q main", { cwd: rootA, shell: "/bin/bash" });
const taskA = createTask(rootA, { name: "feat: clean merge", summary: "Clean rebase smoke", specs: "n/a" });
setWorktree(rootA, taskA, "feat/clean-merge");
setState(rootA, taskA, "to-merge");
const wtA = join(rootA, ".worktrees", "feat/clean-merge");
const cfgA = cfgFor(rootA, caseStub(rootA, ""));
rescan(rootA, cfgA);
assert.equal(parseTask(rootA, taskA.file).state, "merging", "the sweep moved the task to merging");
assert.equal(readMergerSlug(rootA), taskSlug(taskA.file), "the merger slug records the task");
assert.ok(orchLog(rootA).includes(`spawned merger pid=`) && orchLog(rootA).includes(`(cwd=${wtA})`), "the merger spawned in the task worktree");
assert.deepEqual(subjects(rootA, "-1 main"), ["init"], "the sweep itself moved no base commit");
assert.ok(!orchLog(rootA).includes("fast-forwarded"), "nothing was fast-forwarded before the merger finished");
await waitFor(() => !agentAlive(rootA, "merger"), 30000, "the merger exited", () => "");
poll(rootA, 5);
assert.equal(parseTask(rootA, taskA.file).state, "to-live-test", "the clean exit set to-live-test");
assert.ok(subjects(rootA, "-1 main").includes("clean-change"), "the base took the rebased branch commit");
assert.equal(execSync("git log --format=%s --merges main", { cwd: rootA, encoding: "utf8" }).trim(), "", "no merge commit on the base");
assert.equal(rebasing(wtA), false, "the merger left no rebase behind");
console.log("merge.test.ts: + clean rebase smoke passed");

// --- part B: a conflicted rebase. The swap leaves the conflict to the merger, which keeps
// both sides and writes one merge bullet per resolved hunk in the notes ---
const rootB = mergeRoot();
conflicting(rootB, "feat/conflicted", "branch", "main");
const taskB = createTask(rootB, { name: "feat: conflicted merge", summary: "Conflict smoke", specs: "n/a" });
setWorktree(rootB, taskB, "feat/conflicted");
setState(rootB, taskB, "to-merge");
await drive(rootB, cfgFor(rootB, caseStub(rootB, "note")));
const notesB = parseTask(rootB, taskB.file).notes.split("\n").filter((l) => l.startsWith("- merge:"));
assert.equal(notesB.length, 2, `the notes carry one bullet per resolved hunk: ${notesB.join(" | ")}`);
assert.ok(notesB.every((l) => l.includes("both sides")), "each bullet says whether both sides survived");
assert.equal(readFileSync(join(rootB, "README.md"), "utf8"), "branch\n", "the resolved side reached the base");
assert.equal(parseTask(rootB, taskB.file).state, "to-live-test", "a resolved conflict still reaches the live test");
console.log("merge.test.ts: + conflicted rebase smoke passed");

// --- part C: a dropped side. The other change does not fit, so the merger keeps its own side
// and records one open question naming the other task; the merge still completes ---
const rootC = mergeRoot();
const otherC = createTask(rootC, { name: "feat: other side", summary: "Dropped side smoke", specs: "n/a" });
conflicting(rootC, "feat/dropped", "branch", "main");
const taskC = createTask(rootC, { name: "feat: dropped side", summary: "Dropped side smoke", specs: "n/a" });
setWorktree(rootC, taskC, "feat/dropped");
setState(rootC, taskC, "to-merge");
await drive(rootC, cfgFor(rootC, caseStub(rootC, "drop", `#${taskNum(otherC.file)}`)));
const openC = parseTask(rootC, taskC.file).openQuestions;
assert.ok(openC.includes(`#${taskNum(otherC.file)}`), `the open question names the other task: ${openC}`);
assert.equal(readFileSync(join(rootC, "README.md"), "utf8"), "branch\n", "the own side was kept");
assert.equal(parseTask(rootC, taskC.file).state, "to-live-test", "a dropped side still reaches the live test");
console.log("merge.test.ts: + dropped side smoke passed");

// --- part D: a failing suite. The merger sets to-do itself, the poll leaves that move alone,
// the branch stays rebased and the base is never fast-forwarded ---
const rootD = mergeRoot();
execSync("git checkout -qb feat/failing-suite && git commit -q --allow-empty -m suite-branch && git checkout -q main", { cwd: rootD, shell: "/bin/bash" });
const taskD = createTask(rootD, { name: "feat: failing suite", summary: "Suite gate smoke", specs: "n/a" });
setWorktree(rootD, taskD, "feat/failing-suite");
setState(rootD, taskD, "to-merge");
await drive(rootD, cfgFor(rootD, caseStub(rootD, "fail")));
assert.equal(parseTask(rootD, taskD.file).state, "to-do", "the merger's failing-suite move to to-do survives the poll");
assert.deepEqual(subjects(rootD, "-1 main"), ["init"], "no fast-forward for a failing suite");
assert.ok(subjects(rootD, "-1 feat/failing-suite").includes("suite-branch"), "the branch stays rebased");
assert.ok(!orchLog(rootD).includes("fast-forwarded"), "the daemon logs no fast-forward");
console.log("merge.test.ts: + failing suite smoke passed");

// --- part E: the give-up path. A merger that exits 0 with a branch off the base keeps the
// task in merging with the stuck marker, so the whole Merge column waits; the poll does not
// bounce it, and the sweep releases the task once the PM repairs the base by hand ---
const rootE = mergeRoot();
execSync("git checkout -qb feat/off-base && git commit -q --allow-empty -m branch && git checkout -q main && git commit -q --allow-empty -m moved", { cwd: rootE, shell: "/bin/bash" });
const taskE = createTask(rootE, { name: "feat: off base", summary: "Give-up smoke", specs: "n/a" });
setWorktree(rootE, taskE, "feat/off-base");
setState(rootE, taskE, "to-merge");
const cfgE = cfgFor(rootE, caseStub(rootE, "abort"));
await drive(rootE, cfgE);
const slugE = taskSlug(taskE.file);
const stuckE = stuckPath(rootE, slugE);
assert.equal(parseTask(rootE, taskE.file).state, "merging", "a branch off the base keeps the task in merging");
assert.ok(existsSync(stuckE), "the stuck marker is written");
assert.deepEqual(readFileSync(stuckE, "utf8").trim().split("\n"), ["the branch does not sit on the base branch", "feat/off-base", "main"], "the marker names the reason, the branch and the base");
assert.equal(parseTask(rootE, taskE.file).openQuestions, "", "the give-up writes no open question");
const reportsE = () => readdirSync(reportsDir(rootE)).filter((f) => f.endsWith(".md"));
assert.equal(reportsE().length, 1, "one merge-stuck alert");
const alertE = readFileSync(join(reportsDir(rootE), reportsE()[0]), "utf8");
assert.match(alertE, /## Merge stuck/, "the alert names the stuck merge");
assert.ok(alertE.includes(`git -C ${rootE} merge --ff-only feat/off-base`), "the recipe names the root and the branch");
assert.ok(alertE.includes(`git -C ${rootE} stash push --include-untracked`), "the recipe stashes the root work first");
// the poll leaves it alone, and the Merge column stays shut for the next to-merge task
poll(rootE, 5);
assert.equal(parseTask(rootE, taskE.file).state, "merging", "the poll does not bounce a stuck merge");
const nextE = createTask(rootE, { name: "feat: waits behind the stuck merge", summary: "Give-up smoke", specs: "n/a" });
setWorktree(rootE, nextE, "feat/off-base");
setState(rootE, nextE, "to-merge");
rescan(rootE, cfgE);
assert.equal(parseTask(rootE, nextE.file).state, "to-merge", "the stuck merge blocks the whole Merge column");
assert.equal(orchLog(rootE).split("spawned merger").length - 1, 1, "no second merger spawn");
assert.deepEqual(subjects(rootE, "-1 main"), ["moved"], "the base never took the off-base branch");
// the PM repairs by hand: rebase the branch onto the base, then fast-forward the base
execSync("git rebase main", { cwd: join(rootE, ".worktrees", "feat/off-base"), shell: "/bin/bash" });
execSync("git merge -q --ff-only feat/off-base", { cwd: rootE, shell: "/bin/bash" });
rescan(rootE, cfgE);
assert.equal(parseTask(rootE, taskE.file).state, "to-live-test", "the release sends the repaired task to its live test");
assert.equal(existsSync(stuckE), false, "the release deletes the marker");
assert.ok(subjects(rootE, "-1 main").includes("branch"), "the repaired base took the branch");
console.log("merge.test.ts: + give-up smoke passed");

// --- part E2: a merger whose task holds the question token lands in to-do, and the root is
// never fast-forwarded under a stopped task ---
const rootE2 = mergeRoot();
execSync("git checkout -qb feat/asked-merge && git commit -q --allow-empty -m asked-change && git checkout -q main", { cwd: rootE2, shell: "/bin/bash" });
const taskE2 = createTask(rootE2, { name: "feat: asked merge", summary: "Merger question smoke", specs: "n/a" });
setWorktree(rootE2, taskE2, "feat/asked-merge");
setState(rootE2, taskE2, "to-merge");
const cfgE2 = cfgFor(rootE2, caseStub(rootE2, ""));
rescan(rootE2, cfgE2);
await waitFor(() => !agentAlive(rootE2, "merger") && readExitCode(rootE2, "merger") !== null, 30000, "the merger exited and recorded its code", () => "");
updateTask(rootE2, taskE2, { blockedBy: "question" });
poll(rootE2, 5);
assert.equal(parseTask(rootE2, taskE2.file).state, "to-do", "a merger question lands in to-do");
assert.deepEqual(subjects(rootE2, "-1 main"), ["init"], "the root never fast-forwarded under the question");
console.log("merge.test.ts: + merger question smoke passed");

// --- part F: a dirty root checkout. Uncommitted and untracked files survive the fast-forward,
// the merge succeeds and the stash list is empty afterwards ---
const rootF = mergeRoot();
writeFileSync(join(rootF, "dirty.txt"), "clean\n");
execSync("git add dirty.txt && git commit -qm dirty-base", { cwd: rootF, shell: "/bin/bash" });
execSync("git checkout -qb feat/dirty-root && git commit -q --allow-empty -m dirty-branch && git checkout -q main", { cwd: rootF, shell: "/bin/bash" });
const taskF = createTask(rootF, { name: "feat: dirty root", summary: "Dirty root smoke", specs: "n/a" });
setWorktree(rootF, taskF, "feat/dirty-root");
setState(rootF, taskF, "to-merge");
writeFileSync(join(rootF, "dirty.txt"), "uncommitted\n");
writeFileSync(join(rootF, "untracked.txt"), "untracked\n");
await drive(rootF, cfgFor(rootF, caseStub(rootF, "")));
assert.equal(parseTask(rootF, taskF.file).state, "to-live-test", "the merge succeeds over a dirty root");
assert.equal(readFileSync(join(rootF, "dirty.txt"), "utf8"), "uncommitted\n", "the uncommitted change survives");
assert.equal(readFileSync(join(rootF, "untracked.txt"), "utf8"), "untracked\n", "the untracked file survives");
assert.equal(execSync("git stash list", { cwd: rootF, encoding: "utf8" }).trim(), "", "the stash list is empty");
assert.ok(subjects(rootF, "-1 main").includes("dirty-branch"), "the fast-forward landed");
console.log("merge.test.ts: + dirty root smoke passed");

// --- part K5: a detached root checkout has no branch to merge into: the sweep refuses before
// it spawns a merger, the task waits in to-merge for the PM, and the base is untouched ---
const rootK5 = mergeRoot();
execSync("git checkout -qb fix/detached-root && git commit -q --allow-empty -m branch && git checkout -q main && git checkout -q --detach", { cwd: rootK5, shell: "/bin/bash" });
const taskK5 = createTask(rootK5, { name: "fix: detached root", summary: "Detached root smoke", specs: "n/a" });
setWorktree(rootK5, taskK5, "fix/detached-root");
setState(rootK5, taskK5, "to-merge");
rescan(rootK5, cfgFor(rootK5, caseStub(rootK5, "abort")));
assert.ok(orchLog(rootK5).includes("root checkout is detached, left in to-merge"), "the detached root refused the merge");
assert.equal(parseTask(rootK5, taskK5.file).state, "to-merge", "the task waits in to-merge for the PM");
assert.ok(!orchLog(rootK5).includes("spawned merger"), "no merger agent for a detached root");
console.log("merge.test.ts: + detached root smoke passed");

// --- part AL: the merger prompt carries the literal base branch, the conflict recipe, the
// notes contract and the full-suite gate, and no absolute path or placeholder survives ---
const rootAL = fixture();
const taskAL = createTask(rootAL, { name: "fix: merger prompt", summary: "Prompt smoke", specs: "n/a" });
const promptAL = renderPrompt(rootAL, "merger", 60, taskAL.file);
assert.ok(promptAL.includes("Merger agent"), "prompt is the merger's");
assert.ok(promptAL.includes("git rebase --abort"), "the merger aborts a stale rebase first");
assert.ok(promptAL.includes("git rebase main"), "the prompt names the literal base branch");
assert.ok(promptAL.includes("git checkout --theirs"), "the merger keeps its own side per hunk");
assert.ok(promptAL.includes("git blame -L") && promptAL.includes("git log --oneline -1"), "the merger reads the other side from both");
assert.ok(promptAL.includes("(#NNN)") && promptAL.includes("0000NN_"), "the prompt maps the subject suffix to the task file");
assert.ok(promptAL.includes("prefixed `merge:`"), "the notes contract names the merge bullet prefix");
assert.ok(promptAL.includes("pnpm test") && promptAL.includes("Never `pnpm test:changed`"), "the merger runs the full suite only");
assert.ok(promptAL.includes("kanban_set_state") && promptAL.includes("openQuestions"), "the kanban write contract is stated");
assert.ok(promptAL.includes("Keep every tool call's timeout under 60 minutes"), "the prompt carries the configured stall window");
assert.ok(!promptAL.includes(rootAL) && !promptAL.includes("{{"), "no absolute path or placeholder survives rendering");
assert.ok(!promptAL.includes("You run no test suite"), "the merger no longer skips the suite");
const promptRev = renderPrompt(rootAL, "reviewer", 60);
assert.ok(promptRev.includes(`git -C ${rootAL} branch --show-current`), "the reviewer resolves the base branch from the project root checkout");
assert.ok(!promptRev.includes("git diff main"), "the reviewer diffs no hardcoded main");
assert.ok(!promptRev.includes(join(rootAL, ".kanban")) && !promptRev.includes(".worktrees"), "no absolute task-file or worktree path survives rendering");
assert.ok(!promptRev.includes("{{"), "no placeholder survives rendering");
for (const [role, prompt] of [["developer", renderPrompt(rootAL, "developer", 60)], ["merger", promptAL], ["live-tester", renderPrompt(rootAL, "live-tester", 60)]] as const) {
	assert.ok(prompt.toLowerCase().includes("never change the task states"), `the ${role} prompt bans changing the task states`);
	assert.ok(!prompt.includes("doctor maintains"), `the ${role} prompt carries no doctor-maintains sentence`);
	assert.ok(!prompt.includes(".kanban/AGENTS"), `the ${role} prompt names no role-notes path`);
}
console.log("merge.test.ts: + merger prompt smoke passed");
cleanupAll(rootA, rootB, rootC, rootD, rootE, rootE2, rootF, rootK5, rootAL);

// --- part K2: at most one merger runs at a time, even with several tasks in to-merge ---
const rootK2 = mergeRoot();
// merger stub that rebases, then sleeps 2.5s before resolving, so an unserialized sweep would overlap spawns
writeFileSync(
	join(rootK2, "slow-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch {}
if (!front.match(/^state: /m) || !prompt.includes("Merger agent")) process.exit(0);
const trySh = (c) => { try { execSync(c, { stdio: "ignore" }); } catch (e) {} };
trySh("git rebase main");
setTimeout(() => trySh("git checkout --theirs README.md && git add -A && GIT_EDITOR=true git rebase --continue"), 2500);
`,
	{ mode: 0o755 },
);
writeFileSync(join(rootK2, "se-llm-team.json"), JSON.stringify({ agent: join(rootK2, "slow-merger.cjs"), pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
conflicting(rootK2, "feat/merger-one", "one", "main");
// the second branch also stems from init, so both conflicts stop a rebase onto main
execSync("git branch feat/merger-two main~1 && git checkout -q feat/merger-two", { cwd: rootK2, shell: "/bin/bash" });
writeFileSync(join(rootK2, "README.md"), "two\n");
execSync("git commit -qam two && git checkout -q main", { cwd: rootK2, shell: "/bin/bash" });
const taskK2a = createTask(rootK2, { name: "feat: merger one", summary: "Single merger smoke", specs: "n/a" });
const taskK2b = createTask(rootK2, { name: "feat: merger two", summary: "Single merger smoke", specs: "n/a" });
setWorktree(rootK2, taskK2a, "feat/merger-one");
setWorktree(rootK2, taskK2b, "feat/merger-two");
setState(rootK2, taskK2a, "to-merge");
setState(rootK2, taskK2b, "to-merge");

const stateOf = (file: string) => {
	try { return parseTask(rootK2, file).state; } catch { return "gone"; }
};
const k2 = await runDaemon(rootK2);
const spawnedK2 = () => k2.output().split("spawned merger").length - 1;
await waitFor(() => spawnedK2() === 1, 30000, "first merger spawned", k2.output);
await new Promise((r) => setTimeout(r, 1200));
assert.equal(spawnedK2(), 1, "no second merger while the first runs");
await waitFor(
	() => stateOf(taskK2a.file) === "done"
		&& stateOf(taskK2b.file) === "done"
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-one"))
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-two")),
	150000,
	`mergers serialized; both tasks reach done and both worktrees are cleaned (${stateOf(taskK2a.file)}/${stateOf(taskK2b.file)})`,
	k2.output,
);
assert.equal(execSync("git log --format=%s --merges main", { cwd: rootK2, encoding: "utf8" }).trim(), "", "no merge commits on main");
k2.daemon.kill("SIGTERM");
cleanupAll(rootK2);
console.log("merge.test.ts: + one merger at a time smoke passed");

// --- part K3: the base moves between the rebase and the fast-forward: the post-rewrite hook
// in the shared hooks dir fires after the merger's rebase and advances main, so the ancestor
// proof fails and the merger gives up. The task waits in merging with the stuck marker, and the
// PM's hand repair (rebase onto the moved base, then fast-forward) releases it to its live test ---
const rootK3 = mergeRoot();
execSync("git checkout -qb feat/race", { cwd: rootK3, shell: "/bin/bash" });
writeFileSync(join(rootK3, "other.txt"), "other\n");
execSync("git add -A && git commit -qm other && git checkout -q main", { cwd: rootK3, shell: "/bin/bash" });
writeFileSync(join(rootK3, "main-only.txt"), "main-only\n");
execSync("git add -A && git commit -qm main-only", { cwd: rootK3, shell: "/bin/bash" });
// written after the history setup: a stub committed on the branch would vanish on the main checkout
writeFileSync(
	join(rootK3, "probe-live.cjs"),
	`#!/usr/bin/env node
const { readFileSync, appendFileSync, existsSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = "SPECS.md";
let front = "";
try { front = readFileSync(file, "utf8"); } catch {}
if (!front.match(/^state: /m)) process.exit(0);
if (prompt.includes("Merger agent")) {
	try { execSync("git rebase main", { stdio: "ignore" }); } catch (e) {}
	process.exit(0);
}
if (prompt.includes("Live-tester")) {
	const files = ["other.txt", "race.txt", "main-only.txt"].filter((f) => existsSync(f)).join(",");
	appendFileSync(file, "\\nLive test report: worktree has " + files + ".\\n");
}
`,
	{ mode: 0o755 },
);
writeFileSync(
	join(rootK3, ".git", "hooks", "post-rewrite"),
	`#!/bin/sh
# git exports GIT_DIR (the invoking worktree's git dir) into hooks, which would override
# -C discovery and send the commit to the branch instead of main: unset it first
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
common=$(git rev-parse --path-format=absolute --git-common-dir)
dir=$(git rev-parse --path-format=absolute --git-dir)
[ "$common" = "$dir" ] && exit 0
[ -f "$common/race-hook-fired" ] && exit 0
touch "$common/race-hook-fired"
echo race > ${rootK3}/race.txt
git -C ${rootK3} add race.txt
git -C ${rootK3} commit -qm race
`,
	{ mode: 0o755 },
);
writeFileSync(join(rootK3, "se-llm-team.json"), JSON.stringify({ agent: join(rootK3, "probe-live.cjs"), pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
const taskK3 = createTask(rootK3, { name: "feat: base moved", summary: "Base branch race smoke", specs: "n/a" });
setWorktree(rootK3, taskK3, "feat/race");
setState(rootK3, taskK3, "to-merge");

const k3 = await runDaemon(rootK3);
const wtK3 = join(rootK3, ".worktrees", "feat/race");
const stuckK3 = stuckPath(rootK3, taskSlug(taskK3.file));
// the hook moved the base inside the merger's own rebase, so the merger gives up and no retry
// follows: the task waits in merging for the PM
await waitFor(() => parseTask(rootK3, taskK3.file).state === "merging" && existsSync(stuckK3), 120000, "the moved base parks the merge", k3.output);
assert.ok(existsSync(join(rootK3, ".git", "race-hook-fired")), "the post-rewrite hook fired for the rebase");
// the PM repair: rebase the branch onto the moved base, then fast-forward the base by hand
execSync("git rebase main", { cwd: wtK3, shell: "/bin/bash" });
execSync("git merge -q --ff-only feat/race", { cwd: rootK3, shell: "/bin/bash" });
await waitFor(
	() => parseTask(rootK3, taskK3.file).state === "done" && !existsSync(wtK3) && mirrorSubjects(rootK3).includes(`kanban: done ${taskK3.file}`),
	150000,
	"task done through the moving base after the repair",
	k3.output,
);
assert.equal(existsSync(stuckK3), false, "the release dropped the stuck marker");
const committedK3 = execSync(`git show refs/heads/meta/kanban:.kanban/${taskK3.file}`, { cwd: rootK3, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedK3, /Live test report: worktree has other\.txt,race\.txt,main-only\.txt\./, "the live test ran the merged commit (all three files present)");
assert.equal(execSync("git log --format=%s --merges main", { cwd: rootK3, encoding: "utf8" }).trim(), "", "no merge commits on main");
assert.deepEqual(subjects(rootK3, "main"), ["other", "race", "main-only", "init"], "main history stays linear with the branch commits replayed on top");
k3.daemon.kill("SIGTERM");
cleanupAll(rootK3);
console.log("merge.test.ts: + base moved between rebase and fast-forward smoke passed");

// --- part AU: two conflicted to-merge tasks, one merger at a time. The second merger's spawn
// supersedes the first task's unconsumed exit (it clears the shared exit file), so the poll
// must requeue the superseded task instead of false-bouncing it ---
const rootAU = mergeRoot();
writeFileSync(
	join(rootAU, "au-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
if (!prompt.includes("Merger agent")) process.exit(0);
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch (e) {}
if (!front.match(/^state: /m)) process.exit(0);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
`,
	{ mode: 0o755 },
);
conflicting(rootAU, "feat/au-one", "one", "main");
execSync("git checkout -qb feat/au-two", { cwd: rootAU, shell: "/bin/bash" });
writeFileSync(join(rootAU, "README.md"), "two\n");
execSync("git commit -qam two && git checkout -q main && git commit -q --allow-empty -m moved", { cwd: rootAU, shell: "/bin/bash" });
const taskAUa = createTask(rootAU, { name: "fix: merger one", summary: "Misattribution smoke", specs: "n/a" });
const taskAUb = createTask(rootAU, { name: "fix: merger two", summary: "Misattribution smoke", specs: "n/a" });
setWorktree(rootAU, taskAUa, "feat/au-one");
setWorktree(rootAU, taskAUb, "feat/au-two");
setState(rootAU, taskAUa, "to-merge");
setState(rootAU, taskAUb, "to-merge");
const slugAUa = taskSlug(taskAUa.file);
const cfgAU = cfgFor(rootAU, join(rootAU, "au-merger.cjs"));
const spawnsAU = () => orchLog(rootAU).split("spawned merger").length - 1;
rescan(rootAU, cfgAU);
assert.equal(parseTask(rootAU, taskAUa.file).state, "merging", "the first task sits in merging");
await waitFor(() => readExitCode(rootAU, "merger") === 0 && !agentAlive(rootAU, "merger"), 15000, "the first merger exited 0", () => "");
assert.equal(spawnsAU(), 1, "the first merger spawned");
// the exit is still unconsumed: the sweep must wait for the poll, or a second spawn clears the
// shared exit file and the finished merge is lost
rescan(rootAU, cfgAU);
assert.equal(spawnsAU(), 1, "no second merger over an unconsumed exit");
assert.equal(readMergerSlug(rootAU), slugAUa, "the shared pair still records the finished run");
assert.equal(parseTask(rootAU, taskAUb.file).state, "to-merge", "the second task waits in to-merge");
poll(rootAU, 5);
assert.equal(parseTask(rootAU, taskAUa.file).state, "merging", "the give-up keeps the finished run's task in merging");
assert.ok(orchLog(rootAU).includes(`${taskAUa.file}: the branch does not sit on the base branch`), "the exit 0 was consumed by its own task");
assert.ok(!existsSync(pidPath(rootAU, "merger")) && !existsSync(exitFilePath(rootAU, "merger")), "the shared pid/exit pair was consumed");
// the PM repair frees the Merge column, so the next merger spawns once the exit is consumed
execSync("git rebase -X theirs main", { cwd: join(rootAU, ".worktrees", "feat/au-one"), shell: "/bin/bash" });
execSync("git merge -q --ff-only feat/au-one", { cwd: rootAU, shell: "/bin/bash" });
rescan(rootAU, cfgAU);
assert.equal(parseTask(rootAU, taskAUa.file).state, "to-live-test", "the repair released the first task");
assert.equal(spawnsAU(), 2, "the next merger spawns once the exit is consumed");
assert.equal(readMergerSlug(rootAU), taskSlug(taskAUb.file), "the second task's merger is recorded");
cleanupAll(rootAU);
console.log("merge.test.ts: + unconsumed exit serialization smoke passed");

// --- part AV: maxParallel gates the merge lane: at the cap a to-merge task waits, below the
// cap the merger spawns and the clean exit fast-forwards the base ---
const rootAV = mergeRoot();
const cfgAV = cfgFor(rootAV, roleStub(rootAV));
cfgAV.maxParallel = 1;
const holderAV = createTask(rootAV, { name: "fix: working slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAV, holderAV, "doing");
execSync("git checkout -qb feat/cap-merge && git commit -q --allow-empty -m capped && git checkout -q main", { cwd: rootAV, shell: "/bin/bash" });
const taskAV = createTask(rootAV, { name: "feat: capped merge", summary: "MaxParallel smoke", specs: "n/a" });
setWorktree(rootAV, taskAV, "feat/cap-merge");
setState(rootAV, taskAV, "to-merge");
rescan(rootAV, cfgAV);
assert.equal(parseTask(rootAV, taskAV.file).state, "to-merge", "at the cap the merge waits in to-merge");
assert.equal(execSync("git log --format=%s -1 main", { cwd: rootAV, encoding: "utf8" }).trim(), "init", "main unmoved at the cap");
setState(rootAV, holderAV, "done");
await drive(rootAV, cfgAV);
assert.equal(parseTask(rootAV, taskAV.file).state, "to-live-test", "below the cap the merger ran and set to-live-test");
assert.ok(subjects(rootAV, "-1 main").includes("capped"), "main took the branch commit below the cap");
assert.equal(listAll(rootAV).filter((t) => t.issuer === "auto").length, 0, "the merge step opens no follow-up task");
cleanupAll(rootAV);
console.log("merge.test.ts: + maxParallel merge cap smoke passed");

// --- part UH3: a user hold skips the merge lane before any side effect: no merger spawn, no
// fast-forward and no attempt marker, and the next eligible task still merges ---
const rootUH3 = mergeRoot();
const cfgUH3 = cfgFor(rootUH3, roleStub(rootUH3));
execSync("git checkout -qb feat/held-merge && git commit -q --allow-empty -m held-change && git checkout -q main", { cwd: rootUH3, shell: "/bin/bash" });
execSync("git checkout -qb feat/next-merge && git commit -q --allow-empty -m next-change && git checkout -q main", { cwd: rootUH3, shell: "/bin/bash" });
const heldUH3 = createTask(rootUH3, { name: "feat: held merge", priority: "critical", summary: "User hold smoke", specs: "n/a", blockedBy: "user" });
setWorktree(rootUH3, heldUH3, "feat/held-merge");
setState(rootUH3, heldUH3, "to-merge");
const nextUH3 = createTask(rootUH3, { name: "feat: next merge", priority: "low", summary: "User hold smoke", specs: "n/a" });
setWorktree(rootUH3, nextUH3, "feat/next-merge");
setState(rootUH3, nextUH3, "to-merge");
rescan(rootUH3, cfgUH3);
assert.equal(parseTask(rootUH3, heldUH3.file).state, "to-merge", "the held task stays in to-merge");
assert.equal(readMergerSlug(rootUH3), taskSlug(nextUH3.file), "the merger serves the eligible task, not the held one");
assert.equal(existsSync(join(kanbanDir(rootUH3), ".pids", `${taskSlug(heldUH3.file)}.merge-attempted`)), false, "no attempt marker for a held task");
await waitFor(() => !agentAlive(rootUH3, "merger"), 30000, "the merger exited", () => "");
poll(rootUH3, 5);
assert.equal(parseTask(rootUH3, nextUH3.file).state, "to-live-test", "the next eligible task still merged");
assert.ok(subjects(rootUH3, "main").includes("next-change"), "the base took the eligible branch");
assert.ok(!subjects(rootUH3, "main").includes("held-change"), "the held branch never reached the base");
updateTask(rootUH3, heldUH3, { blockedBy: "" });
await drive(rootUH3, cfgUH3);
assert.ok(subjects(rootUH3, "main").includes("held-change"), "the released branch rebased onto the moved base and fast-forwarded into it");
assert.equal(parseTask(rootUH3, heldUH3.file).state, "to-live-test", "the released task left to-merge for its live test");
cleanupAll(rootUH3);
console.log("merge.test.ts: + user hold skips the merge lane smoke passed");
