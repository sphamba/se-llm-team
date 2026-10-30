import assert from "node:assert/strict";
import { spawn, execSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createTask, kanbanDir, parseTask, setState, setWorktree, taskSlug } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline/index.ts";
import { pidAlive, pidPath } from "../../src/pid.ts";
import { exitFilePath, spawnRunAnalysis } from "../../src/orchestrator/spawn.ts";
import { fixture, waitFor, cleanupAll, cleaned, HERE } from "../helpers.ts";

// --- part AT2: the auto-run analysis: every successful agent run (exit 0) spawns the
// detached analyst+doctor runner (spawnRunAnalysis) exactly once, with skip paths for
// already analysed or in-flight runs. poll driven directly: hand-written finished runs
// (per-run log + wrapper exit file) fire the spawn in the exit-0 path, and a fast JSONL
// stub stands in for the real agent so no LLM is ever called ---
const rootAT2 = fixture();
cleaned.push(rootAT2);
const homeAT2 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAT2);
mkdirSync(kanbanDir(rootAT2), { recursive: true });
// the detached runner loads the project config itself (the spawn carries only root, log,
// role), so the stub agent must be on disk: otherwise the analysis would run the ambient
// user-level agent. The stub prints one valid JSONL answer line and exits 0, from any cwd
const fastStubAT2 = join(rootAT2, "fast-analyst.cjs");
writeFileSync(
	fastStubAT2,
	`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "S: x\\nStruggle: none" }] } }) + "\\n");
`,
);
chmodSync(fastStubAT2, 0o755);
writeFileSync(join(rootAT2, "se-llm-team.json"), JSON.stringify({ agent: fastStubAT2 }));
const logsAT2 = join(kanbanDir(rootAT2), ".logs");
const pidsAT2 = join(kanbanDir(rootAT2), ".pids");
const orchLogAT2 = () => readFileSync(join(logsAT2, "orchestrator.log"), "utf8");
const analysisFilesAT2 = (base: string) => ({
	pid: join(pidsAT2, `${base}.analysis.pid`),
	exit: join(pidsAT2, `${base}.analysis.exit`),
	doctor: join(logsAT2, `${base}.doctor.log`),
	report: join(logsAT2, `${base}.analysis.md`),
});
// a finished run: the per-run log with real content plus the wrapper's exit file. The
// merger's shared pid name needs its slug file too, so the poll serves this task's merger
const finishedRunAT2 = (slug: string, role: string) => {
	mkdirSync(logsAT2, { recursive: true });
	mkdirSync(pidsAT2, { recursive: true });
	writeFileSync(
		join(logsAT2, `${slug}.${role}.0.log`),
		[
			JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "did the work" }] } }),
		].join("\n") + "\n",
	);
	writeFileSync(join(pidsAT2, `${role === "merger" ? "merger" : slug}.exit`), "0");
	if (role === "merger") writeFileSync(join(pidsAT2, "merger.slug"), `${slug}\n`);
};
// one task per working state: doing (developer), reviewing (the reviewer only reports; the
// daemon decides from the recorded base — no marker reads as approved), merging (merger),
// live-testing (live-tester)
const rolesAT2: Array<{ role: string; state: "doing" | "reviewing" | "merging" | "live-testing" }> = [
	{ role: "developer", state: "doing" },
	{ role: "reviewer", state: "reviewing" },
	{ role: "merger", state: "merging" },
	{ role: "live-tester", state: "live-testing" },
];
const slugsAT2: Record<string, string> = {};
const taskFilesAT2: Record<string, string> = {};
for (const { role, state } of rolesAT2) {
	const task = createTask(rootAT2, { name: `feat: auto-run ${role}`, summary: "Auto-run analysis smoke", specs: "n/a" });
	setState(rootAT2, task, state);
	slugsAT2[role] = taskSlug(task.file);
	taskFilesAT2[role] = task.file;
	finishedRunAT2(slugsAT2[role], role);
}
// a temp HOME around the polls keeps the ambient user-level config out of loadConfig, for
// the in-process cfg and for the detached runner's own loadConfig (inherited env) alike
const savedHomeAT2 = process.env.HOME;
process.env.HOME = homeAT2;
// the skip paths run on their own root: the slugs never collide with the fired runs above,
// so the no-spawn asserts can read the whole orchestrator log
const rootAT3 = fixture();
cleaned.push(rootAT3);
const stubAT3 = join(rootAT3, "fast-analyst.cjs");
writeFileSync(stubAT3, readFileSync(fastStubAT2, "utf8"));
chmodSync(stubAT3, 0o755);
mkdirSync(kanbanDir(rootAT3), { recursive: true });
writeFileSync(join(rootAT3, "se-llm-team.json"), JSON.stringify({ agent: stubAT3 }));
const logsAT3 = join(kanbanDir(rootAT3), ".logs");
const pidsAT3 = join(kanbanDir(rootAT3), ".pids");
mkdirSync(logsAT3, { recursive: true });
mkdirSync(pidsAT3, { recursive: true });
const pidFileAT3 = (base: string) => join(pidsAT3, `${base}.analysis.pid`);
const orchLogAT3 = () => {
	try {
		return readFileSync(join(logsAT3, "orchestrator.log"), "utf8");
	} catch {
		return ""; // no log yet: nothing was ever logged on this root
	}
};
const noSpawnAT3 = (what: string, base: string) => {
	assert.ok(!existsSync(pidFileAT3(base)), `${what}: no analysis pid file`);
	assert.ok(!existsSync(join(pidsAT3, `${base}.analysis.exit`)), `${what}: no analysis exit file`);
};
try {
	const cfgAT2 = loadConfig(rootAT2);
	assert.equal(cfgAT2.agent, fastStubAT2, "the project config's stub agent resolved");
	poll(rootAT2, 5, Date.now(), 0);
	// one analysis per finished run, each with a live-wrapped pid file (pid + discriminator):
	// the spawn is detached, the wrapper heads its own process group
	for (const { role } of rolesAT2) {
		const base = `${slugsAT2[role]}.${role}.0`;
		const files = analysisFilesAT2(base);
		assert.ok(existsSync(files.pid), `the ${role} run spawned its analysis (pid file written)`);
		const [pidStr, ...rest] = readFileSync(files.pid, "utf8").trim().split(/\s+/);
		const pid = parseInt(pidStr, 10);
		assert.ok(pid > 0 && rest.length > 0, `the ${role} analysis pid file is the wrapped pid+discriminator shape`);
		assert.ok(pidAlive(pid, rest.join(" ")), `the ${role} analysis runner is alive`);
	}
	assert.equal(orchLogAT2().split("spawned analysis pid=").length - 1, 4, "one analysis spawned per finished run");
	// the exit-0 state moves happened before the spawn: the orchestrator's own moves, and the
	// reviewer's daemon decision (no base marker reads as approved)
	assert.equal(parseTask(rootAT2, taskFilesAT2.developer).state, "to-review", "the developer's exit 0 moved doing -> to-review");
	assert.equal(parseTask(rootAT2, taskFilesAT2.reviewer).state, "to-merge", "the reviewer's exit 0 with no base marker decided as approved -> to-merge");
	assert.ok(!existsSync(join(pidsAT2, `${slugsAT2.reviewer}.exit`)), "every end clears the exit file, the reviewer's included");
	assert.equal(parseTask(rootAT2, taskFilesAT2.merger).state, "merging", "the merger's give-up keeps it in merging for the repair");
	assert.equal(parseTask(rootAT2, taskFilesAT2["live-tester"]).state, "done", "the live-tester's exit 0 moved live-testing -> done");
	// wait for every detached analysis: the runner's exit file, the doctor stream and the report
	await waitFor(
		() =>
			rolesAT2.every(({ role }) => {
				const files = analysisFilesAT2(`${slugsAT2[role]}.${role}.0`);
				return existsSync(files.exit) && existsSync(files.doctor) && existsSync(files.report);
			}),
		20000,
		"every auto-run analysis finished (exit file, doctor log, report)",
		() => "",
	);
	for (const { role } of rolesAT2) {
		const files = analysisFilesAT2(`${slugsAT2[role]}.${role}.0`);
		assert.equal(readFileSync(files.exit, "utf8").trim(), "0", `the ${role} analysis exited 0`);
		assert.ok(!existsSync(files.pid), `the ${role} analysis pid file self-removed at exit`);
		const doctor = readFileSync(files.doctor, "utf8");
		assert.ok(doctor.includes('"message_end"') && doctor.includes("Struggle: none"), `the ${role} doctor log carries the stub's output`);
		const report = readFileSync(files.report, "utf8");
		assert.ok(report.includes("## Analysis") && report.includes("S: x"), `the ${role} report carries the doctor answer`);
	}
	// exactly once: the finished analysis is never re-fired (no new pid file). One run ends on
	// this pass (the late developer run), because the reviewer's decided move left no sticky
	// exit file to re-take, and the sweep gzips the finished analysis's doctor log like any
	// role log, content intact (000250)
	const taskLateAT2 = createTask(rootAT2, { name: "feat: auto-run late developer", summary: "Auto-run analysis smoke", specs: "n/a" });
	setState(rootAT2, taskLateAT2, "doing");
	finishedRunAT2(taskSlug(taskLateAT2.file), "developer");
	const reviewerFilesAT2 = analysisFilesAT2(`${slugsAT2.reviewer}.reviewer.0`);
	const doctorMtimeAT2 = statSync(reviewerFilesAT2.doctor).mtimeMs;
	poll(rootAT2, 5, Date.now(), 0);
	assert.equal(parseTask(rootAT2, taskFilesAT2.reviewer).state, "to-merge", "the decided reviewer task stays in to-merge on the second poll");
	assert.ok(!existsSync(reviewerFilesAT2.pid), "the second poll spawned no new analysis for the reviewer run");
	assert.ok(existsSync(`${reviewerFilesAT2.doctor}.gz`) && !existsSync(reviewerFilesAT2.doctor), "the second poll's sweep gzipped the finished analysis's doctor log");
	assert.ok(gunzipSync(readFileSync(`${reviewerFilesAT2.doctor}.gz`)).toString().includes("Struggle: none"), "the gzipped doctor log keeps the stub's output");
	// a third poll leaves the .gz: the finished analysis is never re-fired or rewritten
	const doctorGzMtimeAT2 = statSync(`${reviewerFilesAT2.doctor}.gz`).mtimeMs;
	poll(rootAT2, 5, Date.now(), 0);
	assert.equal(statSync(`${reviewerFilesAT2.doctor}.gz`).mtimeMs, doctorGzMtimeAT2, "the finished analysis was not re-fired or rewritten");

	// skip paths: direct spawnRunAnalysis calls on a quiet root, nothing spawns
	// nothing indexed at all: n < 0, silent return
	const slugAT3 = "000901_skip_empty";
	spawnRunAnalysis(rootAT3, slugAT3, "developer");
	noSpawnAT3("no run log at all", `${slugAT3}.developer.0`);
	// only another role's run log: n < 0 for the asked role
	writeFileSync(join(logsAT3, `${slugAT3}.developer.0.log`), "other role\n");
	spawnRunAnalysis(rootAT3, slugAT3, "reviewer");
	noSpawnAT3("only another role's run log", `${slugAT3}.reviewer.0`);
	// only a legacy unsuffixed log: it never counts toward the index, n < 0
	writeFileSync(join(logsAT3, `${slugAT3}.merger.log`), "legacy\n");
	spawnRunAnalysis(rootAT3, slugAT3, "merger");
	noSpawnAT3("only a legacy unsuffixed run log", `${slugAT3}.merger.0`);
	// the run log missing in both variants: the name lists in readdir (so n = 0) but neither
	// the plain nor the .gz file resolves (a broken symlink), the vanished-log race the
	// existsSync guard covers
	symlinkSync(join(logsAT3, "gone.log"), join(logsAT3, `${slugAT3}.live-tester.0.log`));
	spawnRunAnalysis(rootAT3, slugAT3, "live-tester");
	noSpawnAT3("run log missing in both variants", `${slugAT3}.live-tester.0`);
	// already analysed: the report exists
	const slugMdAT3 = "000902_skip_report";
	writeFileSync(join(logsAT3, `${slugMdAT3}.developer.0.log`), "run\n");
	writeFileSync(join(logsAT3, `${slugMdAT3}.developer.0.analysis.md`), "old report\n");
	spawnRunAnalysis(rootAT3, slugMdAT3, "developer");
	noSpawnAT3("the report already exists", `${slugMdAT3}.developer.0`);
	// analysing right now: the doctor log exists from the runner's first moment
	const slugDoctorAT3 = "000903_skip_doctor";
	writeFileSync(join(logsAT3, `${slugDoctorAT3}.developer.0.log`), "run\n");
	writeFileSync(join(logsAT3, `${slugDoctorAT3}.developer.0.doctor.log`), "");
	spawnRunAnalysis(rootAT3, slugDoctorAT3, "developer");
	noSpawnAT3("the doctor log already exists", `${slugDoctorAT3}.developer.0`);
	// an in-flight analysis: the pid file names a live process (this test's own pid)
	const slugAliveAT3 = "000904_skip_alive";
	writeFileSync(join(logsAT3, `${slugAliveAT3}.developer.0.log`), "run\n");
	writeFileSync(pidFileAT3(`${slugAliveAT3}.developer.0`), String(process.pid));
	spawnRunAnalysis(rootAT3, slugAliveAT3, "developer");
	// the hand-written pid file stays untouched: a spawn would rewrite it with the wrapped
	// pid+disc shape, and only a spawn writes the exit file
	assert.equal(readFileSync(pidFileAT3(`${slugAliveAT3}.developer.0`), "utf8").trim(), String(process.pid), "the in-flight analysis case left the pid file untouched");
	assert.ok(!existsSync(join(pidsAT3, `${slugAliveAT3}.developer.0.analysis.exit`)), "the in-flight analysis case wrote no exit file");
	rmSync(pidFileAT3(`${slugAliveAT3}.developer.0`)); // our own pid: never leave it for the cleanup kill
	assert.ok(!orchLogAT3().includes("spawned analysis"), "no skip case spawned an analysis");
	// the compacted variant fires: only the .log.gz exists, the spawn resolves it and the
	// runner reads the gz (the compactor may gzip between the spawn and the read)
	const slugGzAT3 = "000905_gz_run";
	const gzLogAT3 = join(logsAT3, `${slugGzAT3}.developer.0.log`);
	writeFileSync(gzLogAT3, [JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "gz run" }] } })].join("\n") + "\n");
	writeFileSync(`${gzLogAT3}.gz`, gzipSync(readFileSync(gzLogAT3)));
	rmSync(gzLogAT3);
	spawnRunAnalysis(rootAT3, slugGzAT3, "developer");
	assert.ok(existsSync(pidFileAT3(`${slugGzAT3}.developer.0`)), "the .gz variant resolves and spawns the analysis");
	await waitFor(() => existsSync(join(pidsAT3, `${slugGzAT3}.developer.0.analysis.exit`)), 20000, "the gz-variant analysis finished", () => "");
	assert.ok(existsSync(join(logsAT3, `${slugGzAT3}.developer.0.analysis.md`)), "the gz-variant analysis wrote its report");
	assert.ok(existsSync(join(logsAT3, `${slugGzAT3}.developer.0.doctor.log`)), "the gz-variant analysis wrote the doctor log");
	// the self-advanced path: a to-merge task whose stale pid file names a dead process, the
	// reviewer log already gzipped by a sweep — the newest run log is the .gz and it names the
	// reviewer role (m[2], not the slug m[1]), so the analysis still fires
	const taskSelfAT3 = createTask(rootAT3, { name: "feat: self-advanced gz", summary: "s", specs: "n/a" });
	setState(rootAT3, taskSelfAT3, "to-merge");
	const selfSlugAT3 = taskSlug(taskSelfAT3.file);
	const selfBaseAT3 = `${selfSlugAT3}.reviewer.0`;
	writeFileSync(
		join(logsAT3, `${selfBaseAT3}.log.gz`),
		gzipSync(Buffer.from(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "self-advanced" }] } }) + "\n")),
	);
	writeFileSync(pidPath(rootAT3, selfSlugAT3), "999999999\n");
	writeFileSync(exitFilePath(rootAT3, selfSlugAT3), "0\n");
	poll(rootAT3, 5, Date.now(), 0);
	assert.ok(existsSync(pidFileAT3(selfBaseAT3)), "the self-advanced run's .gz log fires its analysis");
	await waitFor(() => existsSync(join(pidsAT3, `${selfBaseAT3}.analysis.exit`)), 20000, "the self-advanced analysis finished", () => "");
	assert.equal(readFileSync(join(pidsAT3, `${selfBaseAT3}.analysis.exit`), "utf8").trim(), "0", "the self-advanced analysis exited 0");
	assert.ok(existsSync(join(logsAT3, `${selfBaseAT3}.doctor.log`)), "the self-advanced analysis wrote its doctor log");
} finally {
	process.env.HOME = savedHomeAT2;
}
console.log("orchestrator.test.ts: ... + auto-run analysis smoke passed");

// --- part AT4: the poll's recognition of a self-advanced exit: the pass that consumes a
// non-working task's stale pid/exit pair (exit 0) fires the analysis for the exited run; and
// newestRunRole never names a merger log (the stale pair is the slug's own, so the exited
// run is never a merger run) — a crashed merger's log is never analysed instead ---
const rootAT4 = fixture();
cleaned.push(rootAT4);
const homeAT4 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAT4);
mkdirSync(kanbanDir(rootAT4), { recursive: true });
const stubAT4 = join(rootAT4, "fast-analyst.cjs");
writeFileSync(stubAT4, readFileSync(fastStubAT2, "utf8"));
chmodSync(stubAT4, 0o755);
writeFileSync(join(rootAT4, "se-llm-team.json"), JSON.stringify({ agent: stubAT4 }));
const logsAT4 = join(kanbanDir(rootAT4), ".logs");
const pidsAT4 = join(kanbanDir(rootAT4), ".pids");
mkdirSync(logsAT4, { recursive: true });
mkdirSync(pidsAT4, { recursive: true });
const runLogAT4 = (slug: string, role: string) => {
	writeFileSync(
		join(logsAT4, `${slug}.${role}.0.log`),
		[
			JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "did the work" }] } }),
		].join("\n") + "\n",
	);
};
// the stale pair the self-advanced recognition keys on: a dead wrapper pid + exit 0
const stalePairAT4 = (slug: string) => {
	writeFileSync(pidPath(rootAT4, slug), "999999999\n");
	writeFileSync(exitFilePath(rootAT4, slug), "0\n");
};
const analysisTouchedAT4 = (base: string) =>
	existsSync(join(pidsAT4, `${base}.analysis.pid`)) || existsSync(join(pidsAT4, `${base}.analysis.exit`)) || existsSync(join(logsAT4, `${base}.analysis.md`));
const savedHomeAT4 = process.env.HOME;
try {
	process.env.HOME = homeAT4;
	// the clean self-advance: the poll's stale-pair pass fires the analysis on consumption
	const taskAT4a = createTask(rootAT4, { name: "feat: self-advanced analysis", summary: "Self-advanced recognition smoke", specs: "n/a" });
	setState(rootAT4, taskAT4a, "to-merge");
	const slugAT4a = taskSlug(taskAT4a.file);
	runLogAT4(slugAT4a, "reviewer");
	stalePairAT4(slugAT4a);
	poll(rootAT4, 5, Date.now(), 0);
	assert.ok(analysisTouchedAT4(`${slugAT4a}.reviewer.0`), "the poll's stale-pair pass spawned the analysis for the self-advanced run");
	await waitFor(
		() => existsSync(join(pidsAT4, `${slugAT4a}.reviewer.0.analysis.exit`)) && existsSync(join(logsAT4, `${slugAT4a}.reviewer.0.doctor.log`)),
		20000,
		"the self-advanced analysis finished (exit file, doctor log)",
		() => "",
	);
	// only a merger log: the stale pair is the slug's own (the merger's exits ride the global
	// merger pair), so the exited run is never a merger run and its log is never named
	const taskAT4b = createTask(rootAT4, { name: "feat: crashed merger log", summary: "Crashed merger no-misfire smoke", specs: "n/a" });
	setState(rootAT4, taskAT4b, "to-merge");
	const slugAT4b = taskSlug(taskAT4b.file);
	runLogAT4(slugAT4b, "merger");
	stalePairAT4(slugAT4b);
	poll(rootAT4, 5, Date.now(), 0);
	assert.ok(!analysisTouchedAT4(`${slugAT4b}.merger.0`), "a crashed merger's log is never analysed by the stale-pair recognition");
	// the conflict requeue: a crashed merger's log (newest by mtime) must not shadow the
	// self-advanced reviewer run the stale pair belongs to
	const taskAT4c = createTask(rootAT4, { name: "feat: requeue misfire", summary: "Requeue misfire smoke", specs: "n/a" });
	setState(rootAT4, taskAT4c, "to-merge");
	const slugAT4c = taskSlug(taskAT4c.file);
	runLogAT4(slugAT4c, "reviewer");
	runLogAT4(slugAT4c, "merger");
	stalePairAT4(slugAT4c);
	poll(rootAT4, 5, Date.now(), 0);
	assert.ok(analysisTouchedAT4(`${slugAT4c}.reviewer.0`), "the self-advanced reviewer run is analysed at the requeue");
	assert.ok(!analysisTouchedAT4(`${slugAT4c}.merger.0`), "the crashed merger's log is not analysed instead");
} finally {
	process.env.HOME = savedHomeAT4;
}
cleanupAll(rootAT4);
console.log("orchestrator.test.ts: ... + self-advanced analysis smoke passed");

// --- part AT5: one failed analysis attempt per run (#229): the poll's stale-pair pass fires
// spawnRunAnalysis once per finished run while the task sits in to-merge, and a failed
// analysis (an early throw: no report, no doctor log, pid self-removed) used to respawn
// forever when the sweep re-fired it. The wrapper's exit marker caps any re-attempt to one,
// the janitor keeps the marker while the task exists, the skip is logged, and a fresh run
// (new index) keys its own marker ---
const rootAT5 = fixture();
cleaned.push(rootAT5);
const homeAT5 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAT5);
mkdirSync(kanbanDir(rootAT5), { recursive: true });
const stubAT5 = join(rootAT5, "fast-analyst.cjs");
writeFileSync(stubAT5, readFileSync(fastStubAT2, "utf8"));
chmodSync(stubAT5, 0o755);
writeFileSync(join(rootAT5, "se-llm-team.json"), JSON.stringify({ agent: stubAT5 }));
const logsAT5 = join(kanbanDir(rootAT5), ".logs");
const pidsAT5 = join(kanbanDir(rootAT5), ".pids");
mkdirSync(logsAT5, { recursive: true });
mkdirSync(pidsAT5, { recursive: true });
const taskAT5 = createTask(rootAT5, { name: "fix: failed analysis respawn", summary: "One failed attempt per run", specs: "n/a" });
setState(rootAT5, taskAT5, "to-merge");
const slugAT5 = taskSlug(taskAT5.file);
setWorktree(rootAT5, taskAT5, "tmp-wt");
execSync("git branch -q tmp-wt", { cwd: rootAT5, shell: "/bin/bash" });
// a detached root keeps the task in to-merge (the sweep's PM-resolves-manually path), so
// every sweep re-takes the analysis spawn, which is the reported loop
execSync("git checkout -q --detach", { cwd: rootAT5, shell: "/bin/bash" });
// the finished run: a corrupt .log.gz (the compactor pattern skips it, the runner's gunzip
// throws) plus the stale wrapper pair (dead pid, exit 0) the sweep keys on
const baseAT5 = `${slugAT5}.developer.0`;
writeFileSync(join(logsAT5, `${baseAT5}.log.gz`), Buffer.from("not gzip"));
writeFileSync(pidPath(rootAT5, slugAT5), "999999999\n");
writeFileSync(exitFilePath(rootAT5, slugAT5), "0\n");
const orchLogAT5 = () => readFileSync(join(logsAT5, "orchestrator.log"), "utf8");
const spawnedCountAT5 = () => orchLogAT5().split("spawned analysis pid=").length - 1;
const savedHomeAT5 = process.env.HOME;
try {
	process.env.HOME = homeAT5;
	rescan(rootAT5, loadConfig(rootAT5));
	// the sweep no longer fires analyses itself: the poll's stale-pair pass does, exactly once
	poll(rootAT5, 5, Date.now(), 0);
	// the poll fired the failing analysis: the runner cannot gunzip the log, so the wrapper
	// records a non-zero exit and the pid file self-removes, leaving only the marker
	await waitFor(() => existsSync(join(pidsAT5, `${baseAT5}.analysis.exit`)), 20000, "the failing analysis left its exit marker", () => "");
	assert.ok(!existsSync(join(logsAT5, `${baseAT5}.analysis.md`)), "the failed analysis wrote no report");
	assert.ok(!existsSync(join(logsAT5, `${baseAT5}.doctor.log`)), "the failed analysis wrote no doctor log");
	assert.notEqual(readFileSync(join(pidsAT5, `${baseAT5}.analysis.exit`), "utf8").trim(), "0", "the failing analysis exited non-zero");
	assert.equal(spawnedCountAT5(), 1, "the first poll spawned the analysis once");
	// the exit marker caps any re-attempt: later sweeps and polls fire none (the stale pair is
	// consumed), the janitor keeps the marker while the task exists, and a direct re-attempt
	// into spawnRunAnalysis is skipped with a log line
	rescan(rootAT5, loadConfig(rootAT5));
	poll(rootAT5, 5, Date.now(), 0);
	assert.ok(existsSync(join(pidsAT5, `${baseAT5}.analysis.exit`)), "the exit marker survives the sweeps (the janitor keeps it)");
	assert.equal(spawnedCountAT5(), 1, "later sweeps and polls never respawned the failed analysis");
	spawnRunAnalysis(rootAT5, slugAT5, "developer");
	assert.ok(orchLogAT5().includes("skipping respawn"), "the skip is logged");
	assert.ok(!existsSync(join(pidsAT5, `${baseAT5}.analysis.pid`)), "the capped re-attempt spawned nothing");
	assert.equal(parseTask(rootAT5, taskAT5.file).state, "to-merge", "the task stays in to-merge, the pipeline unharmed");
	// a fresh run (new index) keys its own marker: the stale marker never blocks it
	const freshBaseAT5 = `${slugAT5}.reviewer.0`;
	writeFileSync(
		join(logsAT5, `${freshBaseAT5}.log`),
		JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "did the work" }] } }) + "\n",
	);
	// a fresh finished run: its own stale pair for the poll's next pass to consume
	writeFileSync(pidPath(rootAT5, slugAT5), "999999999\n");
	writeFileSync(exitFilePath(rootAT5, slugAT5), "0\n");
	poll(rootAT5, 5, Date.now(), 0);
	assert.ok(existsSync(join(pidsAT5, `${freshBaseAT5}.analysis.pid`)), "the fresh run's analysis fires despite the stale marker");
	await waitFor(() => existsSync(join(logsAT5, `${freshBaseAT5}.analysis.md`)), 20000, "the fresh run's analysis completed", () => "");
	assert.equal(spawnedCountAT5(), 2, "exactly two analysis spawns in total");
} finally {
	process.env.HOME = savedHomeAT5;
}
cleanupAll(rootAT5, homeAT5);
console.log("orchestrator.test.ts: ... + one failed analysis attempt per run passed");

// --- part AT6: the splitter has no role notes and no analysis: the detached runner leaves
// .kanban/AGENTS.splitter.md absent even when it is asked for a splitter role ---
const rootAT6 = fixture();
cleaned.push(rootAT6);
const homeAT6 = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAT6);
mkdirSync(kanbanDir(rootAT6), { recursive: true });
const runAT6 = spawnSync(
	process.execPath,
	[join(HERE, "..", "src", "analysis-run.ts"), rootAT6, join(kanbanDir(rootAT6), ".logs", "000999_splitter_log.splitter.0.log"), "splitter"],
	{ env: { ...process.env, HOME: homeAT6 }, encoding: "utf8" },
);
assert.notEqual(runAT6.status, 0, "the runner exits non-zero on the missing log");
assert.ok(!existsSync(join(kanbanDir(rootAT6), "AGENTS.splitter.md")), "a splitter analysis creates no role notes file");
cleanupAll(rootAT6, homeAT6);
console.log("orchestrator.test.ts: ... + splitter analysis creates no role notes passed");
