import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, kanbanDir, listAll, parseTask, setState, setWorktree, taskNum, taskSlug, type Task } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import type { Config } from "../../src/orchestrator/config.ts";
import { killTree, pidAlive, pidEntry } from "../../src/pid.ts";
import { cleaned, fixture } from "../helpers.ts";

// The integration-test lane end to end, driven through poll() and rescan() directly on fixture
// roots (no daemon): the merge fast-forward opens or extends the ONE task waiting in
// to-integration-test while the covered task still waits in to-live-test, and the rescan runs the
// single integration-tester over the merged base branch in the root checkout. Nothing here
// reaches a real agent: the stubs record their argv and exit.

// the project-wide lane pid names (pid, exit code and served slug live beside each other)
const LANE = "integration-tester";
const laneFile = (root: string, ext: string) => join(kanbanDir(root), ".pids", `${LANE}.${ext}`);
// no quiet window: these parts are about the lane, never about backlog promotion
const IDLE = 0;

// --- helpers ---

// every lane-file read is guarded: a missing file fails with the name the test wanted, never
// with a raw ENOENT that hides which piece of evidence is absent
const readText = (path: string, what: string): string => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		assert.fail(`${what}: expected ${path} to exist`);
	}
};

const readLines = (path: string): string[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : []);

const waitUntil = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (cond()) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	assert.fail(`timed out after ${ms}ms waiting for ${what}`);
};

const inState = (root: string, state: string): Task[] => listAll(root).filter((t) => t.state === state);

// the generated # Specs body, read by shape: the level-2 sections, the covered-ref headings in
// file order, and the head sentence under ## Own task
const h2 = (specs: string): string[] => specs.split("\n").filter((line) => line.startsWith("## "));
const entries = (specs: string): string[] => specs.split("\n").filter((line) => line.startsWith("### "));
const entryRefs = (specs: string): string[] => entries(specs).map((line) => /^### #(\d+) /.exec(line)![1]);
const ownSentence = (specs: string): string => {
	const lines = specs.split("\n");
	return lines.slice(lines.indexOf("## Own task") + 1).find((line) => line.trim() !== "")!;
};
const ownRefs = (specs: string): string[] => [...ownSentence(specs).matchAll(/#(\d+)/g)].map((m) => m[1]);
const quoted = (specs: string): string[] => specs.split("\n").filter((line) => line.startsWith(">"));
const quoteOf = (summary: string): string[] => summary.split("\n").map((line) => (line.trim() ? `> ${line}` : ">"));
const entryOf = (root: string, task: Task): string => {
	const fresh = parseTask(root, task.file);
	return [`### #${taskNum(task.file)} ${fresh.name}`, "", ...quoteOf(fresh.summary)].join("\n");
};

// the one task waiting for the integration run
const onlyWaiting = (root: string): Task => {
	const waiting = inState(root, "to-integration-test");
	assert.equal(
		waiting.length,
		1,
		`exactly one task waits in to-integration-test, found ${waiting.map((t) => `${t.file} (${t.name})`).join(", ") || "none"}`,
	);
	return waiting[0];
};

// a schedulable task: once its branch merges it is a covered ref
const liveTask = (root: string, name: string, summary: string, extra: { priority?: string; complexity?: string } = {}): Task => {
	const task = createTask(root, { name, summary, specs: "n/a", ...extra });
	setState(root, task, "to-do");
	return task;
};

// the poll's live-testing -> done success branch: a dead live-tester pid plus the exit-0 file
// the sh wrapper writes when the agent succeeds, then one poll pass
const finishLiveTest = (root: string, task: Task): void => {
	const slug = taskSlug(task.file);
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	setState(root, task, "live-testing");
	writeFileSync(join(kanbanDir(root), ".pids", `${slug}.pid`), "999999");
	writeFileSync(join(kanbanDir(root), ".pids", `${slug}.exit`), "0");
	poll(root, 60, Date.now(), IDLE);
	assert.equal(parseTask(root, task.file).state, "done", `the live-tester's exit 0 moved ${task.file} to done`);
};

// a live pid for a lane or task name the part already placed: a rescan reads it as a run in
// flight, so the sweep defers that spawn instead of moving the task on
const hold = (root: string, name: string): void => {
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	writeFileSync(join(kanbanDir(root), ".pids", `${name}.pid`), String(process.pid));
};
const release = (root: string, name: string): void => writeFileSync(join(kanbanDir(root), ".pids", `${name}.pid`), "");

// an agent that exits at once and does nothing: the merge parts never want a real run, only the
// spawn decision the sweep makes
const inertAgent = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "orch-inert-agent-"));
	cleaned.push(dir);
	const agent = join(dir, "inert.cjs");
	writeFileSync(agent, "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });
	chmodSync(agent, 0o755);
	return agent;
};

// the config a merge part needs: no cap, and an agent that does nothing, since the merge pass is
// what these parts drive
const mergeCfg = (root: string): Config => configFor(root, inertAgent(), 0);

// the merge trigger: a branch one commit ahead of the base, the task in to-merge, then one rescan
// that rebases, fast-forwards and runs the integration hook. The covered task's own live test and
// the integration run are not what these parts drive, so their pids are held: a later rescan
// defers both spawns and the board keeps the states the assertions read
const mergeTask = (root: string, task: Task, cfg: Config): void => {
	hold(root, LANE);
	const branch = `feat/covered-${taskNum(task.file)}`;
	execSync(`git checkout -qb ${branch} && git commit -q --allow-empty -m covered && git checkout -q main`, { cwd: root, shell: "/bin/bash" });
	setWorktree(root, task, branch);
	setState(root, task, "to-merge");
	rescan(root, cfg);
	assert.equal(parseTask(root, task.file).state, "to-live-test", `the merge fast-forwarded ${task.file} and set to-live-test`);
	hold(root, taskSlug(task.file));
};

// an integration task already waiting for the lane, as the hook itself would have built it
const waitingTask = (root: string, ref: number, priority: string, coveredName = "feat: an earlier covered ref", coveredSummary = "Its summary."): Task => {
	const task = createTask(root, {
		name: `test: integration of #${ref}`,
		shortName: `integration-of-${ref}`,
		priority,
		complexity: "simple",
		issuer: "auto",
		summary: `Integration test of the merged base branch after #${ref}.`,
		specs: [
			"## Own task",
			"",
			`Perform integration testing following the merge of #${ref}.`,
			"",
			"Run the project test script in the root checkout.",
			"",
			"## Covered tasks",
			"",
			`### #${ref} ${coveredName}`,
			"",
			`> ${coveredSummary}`,
		].join("\n"),
	});
	setState(root, task, "to-integration-test");
	return task;
};

// an integration task the lane is already running: the shared pid/exit/slug trio names the test
// process itself, which is a live pid, so the poll keeps the task in integration-testing instead
// of requeueing a run it cannot attribute
const runLaneFor = (root: string, task: Task): void => {
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	setState(root, task, "integration-testing");
	writeFileSync(laneFile(root, "pid"), String(process.pid));
	writeFileSync(laneFile(root, "slug"), `${taskSlug(task.file)}\n`);
};

// a stub agent for the integration-tester lane: it records one JSON line (role, cwd, the task
// the cwd SPECS.md link names, argv) and then stays alive for the whole part, so no sweep can
// ever see a run that already exited and start a second one behind it; the test kills it
const laneStub = (dir: string): { agent: string; log: string } => {
	const agent = join(dir, "integration-agent.cjs");
	const log = join(dir, "integration-argv.log");
	writeFileSync(
		agent,
		`#!/usr/bin/env node
const { readFileSync, appendFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch {}
const name = (front.match(/^name: "(.*)"$/m) ?? [])[1] ?? "";
const role = /integration[ -]tester/i.test(prompt) ? "integration-tester" : "other";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ role, cwd: process.cwd(), name, argv: process.argv }) + "\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
process.exit(0);
`,
		{ mode: 0o755 },
	);
	chmodSync(agent, 0o755);
	return { agent, log };
};

// the spawns the stub recorded, in order
const laneRuns = (log: string): { role: string; cwd: string; name: string; argv: string[] }[] =>
	readLines(log).map((line) => JSON.parse(line) as { role: string; cwd: string; name: string; argv: string[] });

// the project config for a fixture root: a throwaway HOME, so the machine's own config never
// leaks in, then the stub and the cap this part needs
const configFor = (root: string, agent: string, maxParallel: number): Config => {
	const home = mkdtempSync(join(tmpdir(), "orch-home-"));
	cleaned.push(home);
	const saved = process.env.HOME;
	process.env.HOME = home;
	let cfg: Config;
	try {
		cfg = loadConfig(root);
	} finally {
		if (saved === undefined) delete process.env.HOME;
		else process.env.HOME = saved;
	}
	cfg.agent = agent;
	cfg.maxParallel = maxParallel;
	cfg.backlogIdleMinutes = 0;
	return cfg;
};

// a lane run the test spawned stays alive for the whole part on purpose: kill it, and prove it
// is gone, so no stub outlives its part
const stopLane = async (root: string): Promise<void> => {
	const { pid, disc } = pidEntry(root, LANE);
	if (pid > 0 && pid !== process.pid && pidAlive(pid, disc)) {
		killTree(pid, "SIGKILL");
		await waitUntil(() => !pidAlive(pid, disc), 5000, `the spawned lane run pid=${pid} to exit`);
	}
};

// --- part 1: a to-merge task fast-forwards and opens exactly one waiting integration task, while
// the covered task is still in to-live-test ---
const root1 = fixture();
cleaned.push(root1);
const cfg1 = mergeCfg(root1);
const covered1 = liveTask(root1, "feat: the covered change", "The one change this integration run covers.");
mergeTask(root1, covered1, cfg1);
const created1 = onlyWaiting(root1);
assert.equal(parseTask(root1, covered1.file).state, "to-live-test", "the merged task waits for its own live test");
assert.equal(listAll(root1).length, 2, "the board holds the covered task and the one new integration task");
assert.match(created1.file, /^\d{6}_integration_of_\d+\.md$/, "the new task is a board file of the integration lane");
console.log("integration.test.ts: ... + one waiting task opened at the merge passed");

// --- part 2: the created task carries the auto issuer, the low/simple lane, no blockers, no
// worktree, empty open questions and the generated Specs ---
const num1 = taskNum(covered1.file);
const covered1Fresh = parseTask(root1, covered1.file);
assert.equal(created1.name, `test: integration of #${num1}`, "the name quotes the covered ref");
assert.equal(created1.shortName, `integration-of-${num1}`, "the shortName quotes the covered ref");
assert.equal(created1.priority, "low", "the integration lane runs low priority");
assert.equal(created1.complexity, "simple", "the integration lane runs simple");
assert.equal(created1.state, "to-integration-test", "the task opens in to-integration-test, not backlog");
assert.equal(created1.issuer, "auto", "the orchestrator is the issuer");
assert.equal(created1.blockedBy, "", "no blockedBy is ever set");
assert.equal(created1.worktree, "", "no worktree: the run works the root checkout");
assert.equal(created1.summary, `Integration test of the merged base branch after #${num1}.`);
assert.equal(created1.notes, `Generated by the orchestrator when #${num1} was merged to the base branch.`);
assert.equal(created1.openQuestions, "", "empty open questions, so the task promotes");
assert.equal(
	created1.specs,
	[
		"## Own task",
		"",
		`Perform integration testing following the merge of #${num1}.`,
		"",
		"Run the project test script in the root checkout.",
		"Report defects and coverage gaps in `# Open questions`.",
		"Read the full task file of a covered ref when its summary is not enough.",
		"Do not edit code. Do not commit. Do not create a task. Do not change task states.",
		"",
		"## Covered tasks",
		"",
		`### #${num1} ${covered1Fresh.name}`,
		"",
		`> ${covered1Fresh.summary}`,
	].join("\n"),
	"the Specs are the own-instruction section, then a quoted entry per covered ref",
);
assert.deepEqual(h2(created1.specs), ["## Own task", "## Covered tasks"], "the two level-2 sections come in order");
assert.ok(created1.specs.indexOf("## Covered tasks") < created1.specs.indexOf("### "), "both sections precede the first covered entry");
assert.deepEqual(entryRefs(created1.specs), [`${num1}`], "one heading for the one covered ref");
assert.deepEqual(quoted(created1.specs), quoteOf(covered1Fresh.summary), "every summary line is quoted");
assert.deepEqual(ownRefs(created1.specs), entryRefs(created1.specs), "the head sentence names the same refs as the headings");
console.log("integration.test.ts: ... + created-task fields and generated Specs passed");

// --- part 3: a second covered ref appends to the waiting task: refs in ascending order, one
// bullet per ref with its own summary, and the creation attributes never move ---
const root3 = fixture();
cleaned.push(root3);
const cfg3 = mergeCfg(root3);
// the higher number is covered first, so ascending order is a real reordering of the refs
const low3 = liveTask(root3, "fix: covered first", "The first covered ref's summary.");
const high3 = liveTask(root3, "feat: covered second", "The second covered ref's summary.");
const numHigh3 = taskNum(high3.file);
const numLow3 = taskNum(low3.file);
assert.ok(numLow3 < numHigh3, "the second created task carries the higher number");
mergeTask(root3, high3, cfg3);
const waiting3 = onlyWaiting(root3);
assert.equal(waiting3.name, `test: integration of #${numHigh3}`);
const shortName3 = waiting3.shortName;
const issuer3 = waiting3.issuer;
const priority3 = waiting3.priority;
const complexity3 = waiting3.complexity;
const file3 = waiting3.file;
const state3 = waiting3.state;
const oldEntry3 = entryOf(root3, high3);
assert.ok(waiting3.specs.includes(oldEntry3), "the first entry carries the first ref and its quoted summary");
mergeTask(root3, low3, cfg3);
const appended3 = getTask(root3, file3);
assert.ok(appended3, `the waiting task ${file3} still exists after the append`);
assert.equal(inState(root3, "to-integration-test").length, 1, "the second finish extends the waiting task instead of creating a new one");
assert.equal(appended3!.name, `test: integration of #${numLow3}, #${numHigh3}`, "the refs are re-ordered ascending");
assert.equal(appended3!.summary, `Integration test of the merged base branch after #${numLow3}, #${numHigh3}.`, "the summary names the full set");
assert.equal(appended3!.shortName, shortName3, "shortName never changes");
assert.equal(appended3!.issuer, issuer3, "issuer never changes");
assert.equal(appended3!.priority, priority3, "priority never changes");
assert.equal(appended3!.complexity, complexity3, "complexity never changes");
assert.equal(appended3!.state, state3, "the state never changes");
assert.equal(appended3!.file, file3, "the file number never changes");
assert.ok(appended3!.specs.includes(oldEntry3), "the earlier entry stays byte-identical");
assert.deepEqual(
	appended3!.specs.split("\n").filter((line) => line.startsWith(`### #${numHigh3} `)),
	[`### #${numHigh3} ${parseTask(root3, high3.file).name}`],
	"the earlier entry keeps its one heading",
);
assert.equal(entryRefs(appended3!.specs).length, entryRefs(waiting3.specs).length + 1, "exactly one entry was added");
assert.deepEqual(entryRefs(appended3!.specs), [`${numLow3}`, `${numHigh3}`], "one heading per ref, ascending");
assert.deepEqual(ownRefs(appended3!.specs), entryRefs(appended3!.specs), "the head sentence names the same refs as the headings");
assert.deepEqual(
	quoted(appended3!.specs),
	[...quoteOf(parseTask(root3, low3.file).summary), ...quoteOf(parseTask(root3, high3.file).summary)],
	"every summary line of both refs is quoted, in heading order",
);
for (const ref of [low3, high3]) assert.ok(appended3!.specs.includes(entryOf(root3, ref)), `the entry for ${ref.file} names the ref and quotes its summary`);
// the same ref merges again while the waiting task still names it: nothing may move
const specsAfterAppend = appended3!.specs;
release(root3, taskSlug(low3.file));
setState(root3, low3, "to-merge");
rescan(root3, cfg3);
assert.equal(parseTask(root3, low3.file).state, "to-live-test", "the re-merge fast-forwards again");
assert.equal(getTask(root3, file3)!.specs, specsAfterAppend, "a second merge of the same ref changes nothing at all");
console.log("integration.test.ts: ... + append with ascending refs and one quoted entry per ref passed");

// --- part 3b: a ref the waiting task names but the board no longer holds is dropped, so the head
// sentence and the headings keep naming the same set ---
const root3b = fixture();
cleaned.push(root3b);
const cfg3b = mergeCfg(root3b);
const ghost3b = waitingTask(root3b, 999999, "low");
const real3b = liveTask(root3b, "feat: the surviving ref", "The summary of the ref that stays.");
mergeTask(root3b, real3b, cfg3b);
const rebuilt3b = getTask(root3b, ghost3b.file)!;
assert.deepEqual(entryRefs(rebuilt3b.specs), [`${taskNum(real3b.file)}`], "the vanished ref leaves no empty entry behind");
assert.deepEqual(ownRefs(rebuilt3b.specs), [`${taskNum(real3b.file)}`], "the head sentence names only the surviving ref");
assert.equal(rebuilt3b.name, `test: integration of #${taskNum(real3b.file)}`, "the name names only the surviving ref");
assert.ok(!rebuilt3b.specs.includes("999999"), "nothing quotes the vanished ref");
console.log("integration.test.ts: ... + a ref that left the board is dropped passed");

// --- part 4: a second merge opens a NEW waiting task while the first integration task runs ---
const root4 = fixture();
cleaned.push(root4);
const cfg4 = mergeCfg(root4);
const first4 = liveTask(root4, "feat: covered while running", "The first covered ref's summary.");
const second4 = liveTask(root4, "feat: covered next", "The second covered ref's summary.");
mergeTask(root4, first4, cfg4);
const running4 = onlyWaiting(root4);
// the lane picks the first task up: it is in integration-testing before the second merge lands
runLaneFor(root4, running4);
mergeTask(root4, second4, cfg4);
const waiting4 = onlyWaiting(root4);
assert.notEqual(waiting4.file, running4.file, "the new done task opened a fresh waiting task, not the running one");
assert.equal(waiting4.name, `test: integration of #${taskNum(second4.file)}`, "the new waiting task names only the second ref");
assert.equal(parseTask(root4, running4.file).state, "integration-testing", "the running integration task is untouched");
assert.equal(inState(root4, "integration-testing").length, 1, "one integration task runs");
assert.equal(inState(root4, "to-integration-test").length, 1, "one integration task waits");
console.log("integration.test.ts: ... + second done opens a new waiting task while one runs passed");

// --- part 5: an integration task reaching done creates nothing ---
const root5 = fixture();
cleaned.push(root5);
const covered5 = createTask(root5, { name: "feat: covered before", summary: "Covered summary.", specs: "n/a" });
setState(root5, covered5, "done");
const num5 = taskNum(covered5.file);
const integration5 = createTask(root5, {
	name: `test: integration of #${num5}`,
	shortName: `integration-of-${num5}`,
	priority: "low",
	complexity: "simple",
	issuer: "auto",
	summary: `Integration test of the merged base branch after #${num5}.`,
	specs: `## Own task\n\nPerform integration testing following the merge of #${num5}.\n\nRun the project test script in the root checkout.\n\n## Covered tasks\n\n### #${num5} feat: covered before\n\n> Covered summary.`,
});
mkdirSync(join(kanbanDir(root5), ".pids"), { recursive: true });
setState(root5, integration5, "integration-testing");
// the lane run serving this very task finished 0
writeFileSync(laneFile(root5, "pid"), "999999");
writeFileSync(laneFile(root5, "exit"), "0");
writeFileSync(laneFile(root5, "slug"), `${taskSlug(integration5.file)}\n`);
poll(root5, 60, Date.now(), IDLE);
assert.equal(parseTask(root5, integration5.file).state, "done", "the integration-tester's exit 0 ends the task at done");
assert.equal(inState(root5, "to-integration-test").length, 0, "an integration task reaching done never queues another integration test");
assert.equal(listAll(root5).filter((t) => t.name.startsWith("test: integration of ")).length, 1, "no second integration task was created");
console.log("integration.test.ts: ... + no creation from integration-testing -> done passed");

// --- part 6: a PM-moved done creates nothing, with or without a pid ---
const root6 = fixture();
cleaned.push(root6);
const pm6 = liveTask(root6, "feat: moved by the PM", "A completed live test the PM moved on.");
const slug6 = taskSlug(pm6.file);
mkdirSync(join(kanbanDir(root6), ".pids"), { recursive: true });
// the live-tester's success landed, then the PM moved the task to done by hand before the poll
setState(root6, pm6, "live-testing");
writeFileSync(join(kanbanDir(root6), ".pids", `${slug6}.pid`), "999999");
writeFileSync(join(kanbanDir(root6), ".pids", `${slug6}.exit`), "0");
setState(root6, pm6, "done");
poll(root6, 60, Date.now(), IDLE);
assert.equal(parseTask(root6, pm6.file).state, "done", "the PM's done move stands");
assert.equal(inState(root6, "to-integration-test").length, 0, "a PM-moved done creates no integration task");
// and a done task that never had a pid at all
const bare6 = createTask(root6, { name: "feat: hand-set done", summary: "No agent ever ran it.", specs: "n/a" });
setState(root6, bare6, "done");
poll(root6, 60, Date.now(), IDLE);
assert.equal(parseTask(root6, bare6.file).state, "done", "the hand-set done stays done");
assert.equal(inState(root6, "to-integration-test").length, 0, "a done task with no pid creates no integration task");
assert.equal(listAll(root6).filter((t) => t.name.startsWith("test: integration of ")).length, 0, "no integration task at all on this board");
console.log("integration.test.ts: ... + no creation for a PM-moved done passed");

// --- part 7: a ref a waiting or running integration task already names is skipped ---
// 7a: the waiting task already covers the ref (a task can reach done twice when a dead
// live-tester bounces it back to to-live-test)
const root7 = fixture();
cleaned.push(root7);
const cfg7 = mergeCfg(root7);
const again7 = liveTask(root7, "feat: already covered", "The ref the waiting task already covers.");
const num7 = taskNum(again7.file);
const covering7 = waitingTask(root7, num7, "low", parseTask(root7, again7.file).name, parseTask(root7, again7.file).summary);
mergeTask(root7, again7, cfg7);
const waiting7 = onlyWaiting(root7);
assert.equal(waiting7.file, covering7.file, "the waiting task is the one that already covered the ref");
assert.equal(waiting7.name, `test: integration of #${num7}`, "the ref appears once, never duplicated");
assert.deepEqual(entryRefs(waiting7.specs), [`${num7}`], "one entry, no duplicate");
assert.equal(listAll(root7).filter((t) => t.name.startsWith("test: integration of ")).length, 1, "no extra integration task was created");
// 7b: the RUNNING integration task already covers the ref
const root7b = fixture();
cleaned.push(root7b);
const cfg7b = mergeCfg(root7b);
const again7b = liveTask(root7b, "feat: covered by the running test", "The ref the running task already covers.");
const num7b = taskNum(again7b.file);
const running7b = waitingTask(root7b, num7b, "low", parseTask(root7b, again7b.file).name, parseTask(root7b, again7b.file).summary);
runLaneFor(root7b, running7b);
mergeTask(root7b, again7b, cfg7b);
const stillRunning7b = parseTask(root7b, running7b.file);
assert.equal(stillRunning7b.state, "integration-testing", "the running integration task never gains a ref mid-run");
assert.equal(stillRunning7b.name, `test: integration of #${num7b}`, "the running task's name is unchanged");
assert.equal(inState(root7b, "to-integration-test").length, 0, "no waiting task was opened for a ref the run already covers");
assert.equal(listAll(root7b).filter((t) => t.name.startsWith("test: integration of ")).length, 1, "no extra integration task was created");
console.log("integration.test.ts: ... + an already covered ref is skipped passed");

// --- part 8: one run at a time: one rescan spawns exactly one integration-tester, the highest
// priority waiting task first and the lowest task number inside a priority tier ---
const root8 = fixture();
cleaned.push(root8);
const stubDir8 = mkdtempSync(join(tmpdir(), "orch-lane-"));
cleaned.push(stubDir8);
const stub8 = laneStub(stubDir8);
const cfg8 = configFor(root8, stub8.agent, 0);
const low8 = waitingTask(root8, 901, "low");
const high8a = waitingTask(root8, 902, "high");
const high8b = waitingTask(root8, 903, "high");
assert.ok(taskNum(high8a.file) < taskNum(high8b.file), "the equal-priority pair is ordered by task number");
rescan(root8, cfg8, true);
assert.equal(existsSync(laneFile(root8, "pid")), true, "the rescan spawned the integration-tester");
assert.equal(readText(laneFile(root8, "slug"), "the lane slug file").trim(), taskSlug(high8a.file), "the lane records the slug of the task its run serves");
assert.equal(parseTask(root8, high8a.file).state, "integration-testing", "the highest priority task took the slot");
assert.equal(parseTask(root8, low8.file).state, "to-integration-test", "the low priority task keeps waiting");
assert.equal(parseTask(root8, high8b.file).state, "to-integration-test", "the equal-priority higher number keeps waiting");
assert.equal(parseTask(root8, high8a.file).worktree, "", "the lane run carries no worktree");
await waitUntil(() => laneRuns(stub8.log).length === 1, 15000, "the stub agent to record its spawn");
const first8 = laneRuns(stub8.log)[0];
assert.equal(first8.role, "integration-tester", "the spawned prompt is the integration-tester's");
assert.equal(first8.cwd, realpathSync(root8), "the integration-tester runs in the root checkout, not a worktree");
assert.equal(first8.name, high8a.name, "the run serves the highest priority, lowest number waiting task");
// the live run is the single slot: a second sweep never twins it
rescan(root8, cfg8, true);
assert.equal(laneRuns(stub8.log).length, 1, "a second sweep never starts a second integration-tester");
assert.equal(inState(root8, "to-integration-test").length, 2, "two tasks still wait while the run is alive");
await stopLane(root8);
console.log("integration.test.ts: ... + one run at a time, priority then task number passed");

// --- part 9: maxParallel gates the integration-tester spawn ---
const root9 = fixture();
cleaned.push(root9);
const stubDir9 = mkdtempSync(join(tmpdir(), "orch-lane-"));
cleaned.push(stubDir9);
const stub9 = laneStub(stubDir9);
const cfg9 = configFor(root9, stub9.agent, 1);
const holder9 = createTask(root9, { name: "feat: working slot", summary: "Holds the only slot.", specs: "n/a" });
setState(root9, holder9, "doing");
const capped9 = waitingTask(root9, 911, "medium");
rescan(root9, cfg9, true);
assert.equal(parseTask(root9, capped9.file).state, "to-integration-test", "at the cap the integration task stays in to-integration-test");
assert.equal(existsSync(laneFile(root9, "pid")), false, "at the cap no integration-tester spawned");
assert.equal(laneRuns(stub9.log).length, 0, "the stub never ran while the cap was full");
// the slot frees: the next sweep starts the run
setState(root9, holder9, "done");
rescan(root9, cfg9, true);
assert.equal(parseTask(root9, capped9.file).state, "integration-testing", "below the cap the integration-tester spawned");
assert.equal(existsSync(laneFile(root9, "pid")), true, "below the cap the lane pid file exists");
await waitUntil(() => laneRuns(stub9.log).length === 1, 15000, "the stub agent to record its spawn below the cap");
await stopLane(root9);
console.log("integration.test.ts: ... + maxParallel gates the integration-tester spawn passed");

// --- part 10: a crashed integration-tester bounces integration-testing -> to-integration-test ---
const root10 = fixture();
cleaned.push(root10);
const crashed10 = waitingTask(root10, 921, "medium");
mkdirSync(join(kanbanDir(root10), ".pids"), { recursive: true });
setState(root10, crashed10, "integration-testing");
writeFileSync(laneFile(root10, "pid"), "999999");
writeFileSync(laneFile(root10, "exit"), "3");
writeFileSync(laneFile(root10, "slug"), `${taskSlug(crashed10.file)}\n`);
poll(root10, 60, Date.now(), IDLE);
assert.equal(parseTask(root10, crashed10.file).state, "to-integration-test", "a non-zero exit bounces the task back to to-integration-test");
assert.equal(existsSync(laneFile(root10, "pid")), false, "the bounce clears the lane pid");
assert.equal(existsSync(laneFile(root10, "exit")), false, "the bounce consumes the lane exit code");
assert.equal(inState(root10, "integration-testing").length, 0, "nothing runs after the crash bounce");
console.log("integration.test.ts: ... + crash bounce to to-integration-test passed");


// --- part 11: live-testing -> done creates nothing and never extends the waiting task ---
const root11 = fixture();
cleaned.push(root11);
const waiting11 = waitingTask(root11, 940, "low");
const covered11 = liveTask(root11, "feat: finished after its merge", "The ref whose live test ends the old way.");
finishLiveTest(root11, covered11);
assert.equal(inState(root11, "to-integration-test").length, 1, "still exactly the one pre-existing waiting task");
assert.equal(getTask(root11, waiting11.file)!.specs, waiting11.specs, "the waiting task was not extended");
assert.equal(getTask(root11, waiting11.file)!.name, waiting11.name, "the waiting task keeps its name");
assert.equal(listAll(root11).filter((t) => t.name.startsWith("test: integration of ")).length, 1, "no integration task was created");
console.log("integration.test.ts: ... + no creation and no append from live-testing -> done passed");

// --- part 12: a PM move into to-live-test creates nothing ---
const root12 = fixture();
cleaned.push(root12);
const cfg12 = mergeCfg(root12);
const pm12 = liveTask(root12, "feat: moved into the live test", "A task the PM placed in to-live-test.");
hold(root12, LANE);
setState(root12, pm12, "to-live-test");
rescan(root12, cfg12);
assert.equal(parseTask(root12, pm12.file).state, "to-merge", "with no merged branch the sweep sends the task back to to-merge");
assert.equal(listAll(root12).filter((t) => t.name.startsWith("test: integration of ")).length, 0, "a PM move into to-live-test creates no integration task");
console.log("integration.test.ts: ... + no creation for a PM move into to-live-test passed");

// --- part 13: a failed fast-forward creates nothing and keeps the task in to-merge ---
const root13 = fixture();
cleaned.push(root13);
const cfg13 = mergeCfg(root13);
const ff13 = liveTask(root13, "feat: fast-forward refused", "A merge an untracked file blocks.");
hold(root13, LANE);
// the branch adds a file, and the root checkout holds an untracked file of that name: the rebase
// succeeds and git refuses the fast-forward
const ffBranch = "git checkout -qb feat/covered-ff && printf 'branch\\n' > covered.txt && git add covered.txt && git commit -qm covered && git checkout -q main";
execSync(ffBranch, { cwd: root13, shell: "/bin/bash" });
writeFileSync(join(root13, "covered.txt"), "untracked\n");
setWorktree(root13, ff13, "feat/covered-ff");
setState(root13, ff13, "to-merge");
rescan(root13, cfg13);
assert.equal(parseTask(root13, ff13.file).state, "to-merge", "the refused fast-forward leaves the task in to-merge");
assert.equal(listAll(root13).filter((t) => t.name.startsWith("test: integration of ")).length, 0, "a failed fast-forward creates no integration task");
console.log("integration.test.ts: ... + no creation for a failed fast-forward passed");

// --- part 14: a rebase conflict creates nothing ---
const root14 = fixture();
cleaned.push(root14);
const cfg14 = mergeCfg(root14);
const conflict14 = liveTask(root14, "fix: conflicting branch", "A branch whose rebase stops.");
hold(root14, LANE);
// both the branch and the base edit README.md, so the rebase stops and the merger takes the task
const conflictBranch = "git checkout -qb feat/covered-conflict && printf 'branch\\n' > README.md && git commit -qam branch && git checkout -q main && printf 'main\\n' > README.md && git commit -qam main";
execSync(conflictBranch, { cwd: root14, shell: "/bin/bash" });
setWorktree(root14, conflict14, "feat/covered-conflict");
setState(root14, conflict14, "to-merge");
rescan(root14, cfg14);
assert.equal(parseTask(root14, conflict14.file).state, "merging", "the stopped rebase left the task with the merger");
assert.equal(listAll(root14).filter((t) => t.name.startsWith("test: integration of ")).length, 0, "a rebase conflict creates no integration task");
console.log("integration.test.ts: ... + no creation for a rebase conflict passed");

// --- part 15: a ref whose entry already reached done opens a new entry when it merges again ---
const root15 = fixture();
cleaned.push(root15);
const cfg15 = mergeCfg(root15);
const twice15 = liveTask(root15, "feat: merged twice", "A ref that merges again after its entry finished.");
mergeTask(root15, twice15, cfg15);
const entry15 = onlyWaiting(root15);
// the lane's exit 0 ends the entry at done
mkdirSync(join(kanbanDir(root15), ".pids"), { recursive: true });
setState(root15, entry15, "integration-testing");
writeFileSync(laneFile(root15, "pid"), "999999");
writeFileSync(laneFile(root15, "exit"), "0");
writeFileSync(laneFile(root15, "slug"), `${taskSlug(entry15.file)}\n`);
poll(root15, 60, Date.now(), IDLE);
assert.equal(parseTask(root15, entry15.file).state, "done", "the finished entry reached done");
// the ref merges again: the lane no longer names it, so it opens a new entry
release(root15, taskSlug(twice15.file));
setState(root15, twice15, "to-merge");
rescan(root15, cfg15);
const fresh15 = inState(root15, "to-integration-test");
assert.equal(fresh15.length, 1, "one new entry waits after the ref merged again");
assert.notEqual(fresh15[0].file, entry15.file, "the new entry is a fresh task, not the done one");
assert.equal(fresh15[0].name, `test: integration of #${taskNum(twice15.file)}`, "the new entry names the ref");
assert.equal(parseTask(root15, entry15.file).state, "done", "the done entry stays done");
console.log("integration.test.ts: ... + a new entry after the earlier one reached done passed");

console.log("integration.test.ts: integration-test lane smoke passed (creation at the merge, fields, append, second wait, no-create, skip, one run at a time, maxParallel, crash bounce, trigger moves, failed merge)");
