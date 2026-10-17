import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, ROLE_NOTES_RE } from "../../src/kanban.ts";
import { loadConfig, promoteBacklog } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { HERE, fixture, mirrorSubjects, showTip, roleStub, argvStub, llmArgs, runDaemon, waitFor, cleanupAll, daemons, cleaned } from "../helpers.ts";

// --- part A: happy pipeline with a working stub ---
const rootA = fixture();
cleaned.push(rootA);
// bare origin for the auto-push checks: the daemon must push only the board mirror there
const remoteA = `${rootA}-origin.git`;
execSync(`git init -q --bare ${remoteA}`, { shell: "/bin/bash" });
execSync(`git remote add origin ${remoteA}`, { cwd: rootA, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootA), { recursive: true });
writeFileSync(join(kanbanDir(rootA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootA), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskA = createTask(rootA, { name: "feat: smoke test", summary: "Pipeline smoke", specs: "Run the full pipeline" });
setState(rootA, taskA, "to-do");
// a legacy unsuffixed log from the old naming: never renamed or rewritten, and it never
// counts toward the per-run index, so the first indexed run is still 0
const slugA = taskA.file.replace(/\.md$/, "");
mkdirSync(join(kanbanDir(rootA), ".logs"), { recursive: true });
writeFileSync(join(kanbanDir(rootA), ".logs", `${slugA}.developer.log`), "legacy\n");

const a = await runDaemon(rootA);
const readA = () => parseTask(rootA, taskA.file);

const taskClean = () => mirrorSubjects(rootA).includes(`kanban: done ${taskA.file}`);
// to-do -> doing -> to-review -> reviewing -> to-merge -> to-live-test -> live-testing -> done ->
// done mirror commit. The orchestrator merges itself (no merger agent on the clean path), the
// developer and the live-tester just finish and the orchestrator moves their states on the
// recorded exit 0. The stub transitions in milliseconds, so intermediate states are asserted
// through the daemon log.
await waitFor(() => readA().state === "done" && readA().worktree === "" && taskClean(), 60000, "full pipeline + merge + done mirror commit", a.output);
for (const marker of ["spawned developer", "spawned reviewer", "spawned live-tester", "fast-forwarded main to feat/1-smoke-test, set to-live-test", "merged feat/1-smoke-test"]) {
	assert.ok(a.output().includes(marker), `expected daemon log to contain: ${marker}`);
}
// no merger on the clean path: the orchestrator merged, so no merger pid file or agent run
assert.ok(!a.output().includes("spawned merger"), "the clean pipeline spawns no merger agent");
assert.ok(!existsSync(join(kanbanDir(rootA), ".pids", "merger.pid")), "no merger pid file on the clean path");
assert.ok(a.output().includes(": agent exited 0, doing -> to-review"), "the developer's exit 0 moved the task to to-review");
assert.ok(a.output().includes(": agent exited 0, live-testing -> done"), "the live-tester's exit 0 moved the task to done");
assert.ok(a.output().includes(`(cwd=${join(rootA, ".worktrees", "feat/1-smoke-test")})`), "the live-tester spawns in the task worktree");
assert.ok(!existsSync(join(rootA, ".worktrees", "feat/1-smoke-test")), "worktree removed");
// the board mirrors to refs/heads/meta/kanban via plumbing, never onto the current branch:
// done folds in the whole task life, exactly one create and one done commit, newest first;
// the merged work never touched .kanban and main history gets no board commits
const boardLog = mirrorSubjects(rootA).split("\n");
assert.deepEqual(boardLog, [`kanban: done ${taskA.file}`, `kanban: create ${taskA.file}`]);
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: rootA, encoding: "utf8" }).trim(), "", "board commits landed on main history");
const committed = execSync(`git show refs/heads/meta/kanban:.kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8", shell: "/bin/bash" });
assert.match(committed, /^state: "done"$/m);
assert.match(committed, /^worktree: ""$/m);
// auto-push: the board mirror reaches origin, and nothing else does. The push is detached
// now, so wait for it to land before comparing the refs
const mirrorSha = execSync("git rev-parse refs/heads/meta/kanban", { cwd: rootA, encoding: "utf8" }).trim();
await waitFor(
	() => {
		try {
			return execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteA, encoding: "utf8" }).trim() === mirrorSha;
		} catch {
			return false; // ref not on origin yet
		}
	},
	10000,
	"meta/kanban auto-pushed to origin",
	a.output,
);
assert.equal(execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteA, encoding: "utf8" }).trim(), mirrorSha, "meta/kanban auto-pushed to origin");
assert.equal(
	execSync("git for-each-ref --format='%(refname)' refs/heads", { cwd: remoteA, encoding: "utf8" }).trim(),
	"refs/heads/meta/kanban",
	"only meta/kanban is pushed to origin",
);
// --mode json: the agent log carries the full JSONL event stream (message, thinking, tool
// events), not print mode's final text only; per-run naming: the first indexed run is 0.
// The run ended while the pipeline moved on, so the sweep compacted its raw log into .log.gz
// (the fd redirect removed the write-time pipe): wait for the gz, then read it decompressed
const logsA = join(kanbanDir(rootA), ".logs");
const logOnDisk = (base: string) => existsSync(join(logsA, `${base}.log`)) || existsSync(join(logsA, `${base}.log.gz`));
await waitFor(() => existsSync(join(logsA, `${slugA}.developer.0.log.gz`)), 30000, "sweep compaction+gzip of the finished developer log", a.output);
const devLogA = gunzipSync(readFileSync(join(logsA, `${slugA}.developer.0.log.gz`))).toString();
for (const record of ['"type":"message_update"', '"type":"tool_execution_start"', '"type":"message_end"']) {
	assert.ok(devLogA.includes(record), `developer log carries JSONL ${record}`);
}
// the retro compact dropped the dead weight, the streamed deltas survive the rewrite
assert.ok(!devLogA.includes('"usage"'), "message_update usage envelope stripped");
assert.ok(!devLogA.includes('"sections"'), "run-opening system prompt echo dropped");
assert.ok(devLogA.includes('"text_delta"'), "streamed text deltas survive the compactor");
assert.equal(devLogA.split('"result echo"').length - 1, 1, "toolResult message_start dropped, its message_end kept");
assert.ok(devLogA.includes('"willRetry":false') && !devLogA.includes('"full replay"'), "agent_end messages dropped, the rest of the record kept");
assert.ok(devLogA.includes("stub stderr diagnostic: not json"), "non-JSON stderr passes through the compactor");
assert.ok(logOnDisk(`${slugA}.reviewer.0`) && logOnDisk(`${slugA}.live-tester.0`), "reviewer and live-tester runs got indexed log files");
// every run here exits 0 and the orchestrator (or the reviewer) moved the state, so no bounce
// fired and no death marker lingers
assert.deepEqual(readdirSync(logsA).filter((f) => f.endsWith(".dead")), [], "a run that advances the state itself leaves no death marker");
const legacyA = existsSync(join(logsA, `${slugA}.developer.log`))
	? readFileSync(join(logsA, `${slugA}.developer.log`), "utf8")
	: gunzipSync(readFileSync(join(logsA, `${slugA}.developer.log.gz`))).toString();
assert.equal(legacyA, "legacy\n", "legacy unsuffixed log content survives the sweep; spawns never renamed or rewrote it");
// the reviewer's approval (to-merge) is a successful run: counted once per task
assert.equal(readFileSync(join(logsA, `${slugA}.reviewer-runs.count`), "utf8").trim(), "1", "reviewer approval counted as one successful run");
a.daemon.kill("SIGTERM");

// --- part H: the main-entry guard holds when the daemon is spawned through a symlink ---
// pi loads the extension (which computes the daemon path from import.meta.url) through a
// symlink, so the tool spawns the daemon through a symlinked path; the guard must still run main
const rootH = fixture();
cleaned.push(rootH);
const symDir = mkdtempSync(join(tmpdir(), "orch-sym-"));
const symScript = join(symDir, "orchestrator.ts");
symlinkSync(join(HERE, "../src/orchestrator.ts"), symScript);
const h = await runDaemon(rootH, symScript);
await waitFor(() => h.output().includes("orchestrator started"), 10000, "daemon start through symlinked script", h.output);
assert.ok(existsSync(join(kanbanDir(rootH), ".orchestrator.lock")), "lock created when spawned through a symlink");
h.daemon.kill("SIGTERM");
rmSync(symDir, { recursive: true, force: true });

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn smoke passed");

// --- part S: --no-webui / SE_LLM_TEAM_NO_WEBUI keep smoke daemons off the global webui config ---
// the global config (like the production ~/.pi/agent/se-llm-team.json) enables the webui on a fixed
// port; a smoke daemon without the override binds it and steals the real UI
const rootS = fixture();
cleaned.push(rootS);
const homeS = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeS);
mkdirSync(join(homeS, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeS, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: 4277 }, backlogIdleMinutes: 0 }));

const sEnv = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootS, "--rescan-seconds", "1"], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: homeS, SE_LLM_TEAM_NO_WEBUI: "1" },
});
daemons.push({ daemon: sEnv, root: rootS });
let sEnvOut = "";
sEnv.stdout.on("data", (d) => (sEnvOut += d));
sEnv.stderr.on("data", (d) => (sEnvOut += d));
await waitFor(() => sEnvOut.includes("web ui disabled"), 10000, "SE_LLM_TEAM_NO_WEBUI disables the webui", () => sEnvOut);
assert.ok(!sEnvOut.includes("web ui on") && !sEnvOut.includes("web ui failed"), "env override never starts the webui");
sEnv.kill("SIGTERM");
// full exit before the next spawn: the lock must be released, or the second daemon exits early
await Promise.race([new Promise((r) => sEnv.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

const sFlag = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootS, "--rescan-seconds", "1", "--no-webui"], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: homeS },
});
daemons.push({ daemon: sFlag, root: rootS });
let sFlagOut = "";
sFlag.stdout.on("data", (d) => (sFlagOut += d));
sFlag.stderr.on("data", (d) => (sFlagOut += d));
await waitFor(() => sFlagOut.includes("web ui disabled"), 10000, "--no-webui disables the webui", () => sFlagOut);
// the configured port was free the whole run, so a bound webui would have logged "web ui on":
// its absence proves the daemon never touched the port
assert.ok(!sFlagOut.includes("web ui on") && !sFlagOut.includes("web ui failed"), "--no-webui never starts the webui");
sFlag.kill("SIGTERM");
await Promise.race([new Promise((r) => sFlag.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);

cleanupAll(rootS, homeS);
console.log("orchestrator.test.ts: ... + no-webui override smoke passed");

// --- part X: provider/model/thinking config flags, with per-role overrides ---
const rootX = fixture();
cleaned.push(rootX);
// exact-flag asserts: an empty temp HOME keeps the ambient user-level config (provider, model,
// roles) out of loadConfig, which merges user-level first
const homeX = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeX);
mkdirSync(kanbanDir(rootX), { recursive: true });
writeFileSync(
	join(kanbanDir(rootX), "se-llm-team.json"),
	JSON.stringify({
		agent: argvStub(rootX),
		pollMinutes: 0.01,
		backlogIdleMinutes: 0,
		model: "global-model",
		thinking: "high",
		roles: {
			developer: { model: "dev-model", thinking: "low", complex: { model: "dev-complex-model" } },
			reviewer: { provider: "prov", model: "rev-model" },
			merger: { provider: "mprov", model: "merge-model" },
		},
	}),
);
const taskX = createTask(rootX, { name: "feat: llm flags", summary: "LLM config smoke", specs: "n/a" });
setState(rootX, taskX, "to-do");
// a complex task: the developer resolves through roles.developer.complex
const taskX3 = createTask(rootX, { name: "feat: llm flags complex", summary: "LLM config smoke", specs: "n/a", complexity: "complex" });
setState(rootX, taskX3, "to-do");

const x = await runDaemon(rootX, join(HERE, "../src/orchestrator.ts"), homeX);
await waitFor(
	() =>
		[taskX, taskX3].every((t) => parseTask(rootX, t.file).state === "done" && parseTask(rootX, t.file).worktree === ""),
	60000,
	"pipelines with llm config",
	x.output,
);
const xSpawns = () => readFileSync(join(rootX, "argv.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { role: string; argv: string[]; task: string });
// the prompt carries no absolute paths, so spawns are attributed per task by the task name
// the stub read from its cwd SPECS.md
const xFlags = (role: string, name: string) => {
	const spawns = xSpawns().filter((s) => s.role === role && s.task === name);
	return llmArgs(spawns[spawns.length - 1].argv);
};
assert.deepEqual(xFlags("developer", taskX.name), ["--model", "dev-model", "--thinking", "low"], "role entry overrides both global fields for a moderate task");
assert.deepEqual(xFlags("developer", taskX3.name), ["--model", "dev-complex-model", "--thinking", "low"], "complexity entry overrides the nested field; unset nested fields keep the role default");
assert.deepEqual(xFlags("reviewer", taskX.name), ["--provider", "prov", "--model", "rev-model", "--thinking", "high"], "role provider+model keeps the global thinking");
assert.deepEqual(xFlags("live-tester", taskX.name), ["--model", "global-model", "--thinking", "high"], "no role entry: the global fields apply");

// a conflicting branch under the same running daemon makes the merger path run and record
execSync("git checkout -qb fix/llm-conflict", { cwd: rootX, shell: "/bin/bash" });
writeFileSync(join(rootX, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootX, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootX, shell: "/bin/bash" });
writeFileSync(join(rootX, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootX, shell: "/bin/bash" });
const taskX2 = createTask(rootX, { name: "fix: llm merger", summary: "LLM merger smoke", specs: "n/a" });
setState(rootX, taskX2, "to-merge");
setWorktree(rootX, taskX2, "fix/llm-conflict");
await waitFor(() => xSpawns().some((s) => s.role === "merger" && s.task === taskX2.name), 30000, "merger spawned under the llm config", x.output);
assert.deepEqual(xFlags("merger", taskX2.name), ["--provider", "mprov", "--model", "merge-model", "--thinking", "high"], "merger role override applies");
x.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + llm config flags smoke passed");

// --- part AS: per-role project notes in .kanban, read from the cwd AGENTS.md symlink ---
// no root AGENTS.md in this fixture: nothing to inject, so no spawn carries
// --append-system-prompt; the daemon creates the file when missing, the notes files are not
// tasks (promoteBacklog cannot turn one into a phantom developer run) and ride the board
// mirror's snapshot commits
const rootAS = fixture();
cleaned.push(rootAS);
// an empty temp HOME keeps the ambient user-level config out of loadConfig, as in part X
const homeAS = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAS);
mkdirSync(kanbanDir(rootAS), { recursive: true });
writeFileSync(join(kanbanDir(rootAS), "se-llm-team.json"), JSON.stringify({ agent: argvStub(rootAS), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
// a bare AGENTS.md in .kanban (the pi context-file name a user might try here) is board noise
// too: no frontmatter, so without the filter it parses as a phantom backlog task and promotes
writeFileSync(join(kanbanDir(rootAS), "AGENTS.md"), "# notes\n");
// a second task on a branch that really conflicts with main (both edit README.md): the
// merger spawns on the conflict and gets its own notes file, its exit 0 requeues the task
// and the default idle cooldown parks it for the rest of the run
execSync("git checkout -qb fix/as-conflict", { cwd: rootAS, shell: "/bin/bash" });
writeFileSync(join(rootAS, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootAS, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootAS, shell: "/bin/bash" });
writeFileSync(join(rootAS, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootAS, shell: "/bin/bash" });
const taskASConflict = createTask(rootAS, { name: "fix: role notes merger", summary: "Role notes smoke", specs: "n/a" });
setWorktree(rootAS, taskASConflict, "fix/as-conflict");
setState(rootAS, taskASConflict, "to-merge");
const taskAS = createTask(rootAS, { name: "feat: role notes", summary: "Role notes smoke", specs: "n/a" });
setState(rootAS, taskAS, "to-do");
const as = await runDaemon(rootAS, join(HERE, "../src/orchestrator.ts"), homeAS);
await waitFor(
	() => parseTask(rootAS, taskAS.file).state === "done" && parseTask(rootAS, taskAS.file).worktree === "",
	60000,
	"pipeline with role notes",
	as.output,
);
const notesPathAS = (role: string) => join(kanbanDir(rootAS), `AGENTS.${role}.md`);
const asSpawns = () =>
	readFileSync(join(rootAS, "argv.log"), "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as { role: string; argv: string[] });
for (const role of ["developer", "reviewer", "merger", "live-tester"]) {
	const path = notesPathAS(role);
	assert.ok(existsSync(path), `the ${role} notes file was created when missing`);
	assert.ok(readFileSync(path, "utf8").includes(`# ${role}:`), "the starter header names the role");
	const spawns = asSpawns().filter((s) => s.role === role);
	assert.ok(spawns.length > 0, `the ${role} ran`);
	for (const s of spawns) {
		assert.ok(s.argv.indexOf("--append-system-prompt") === -1, `every ${role} spawn drops --append-system-prompt: no project AGENTS.md at the root`);
	}
}
assert.ok(!listAll(rootAS).some((t) => ROLE_NOTES_RE.test(t.file)), "role notes files are not tasks");
assert.ok(!readFileSync(join(kanbanDir(rootAS), "AGENTS.md"), "utf8").match(/^state: /m), "a bare AGENTS.md never parses as a task");
// the done fold-in commit lands one sweep after the file shows done, so wait for the mirror
await waitFor(
	() => ["developer", "reviewer", "merger", "live-tester"].every((role) => showTip(rootAS, `AGENTS.${role}.md`) !== null),
	15000,
	"role notes on the board mirror",
	as.output,
);
for (const role of ["developer", "reviewer", "merger", "live-tester"]) {
	assert.ok(showTip(rootAS, `AGENTS.${role}.md`) !== null, `the board mirror carries the ${role} notes file`);
}
as.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + per-role project notes smoke passed");

// --- part AX: 000213 a target project's own tracked AGENTS.md survives spawn setup and
// reaches the agent: the worktree's real AGENTS.md is marked skip-worktree before the
// role-notes symlink replaces it (git status stays clean), and the project root's AGENTS.md
// content rides as one --append-system-prompt argv element; over the cap the injection
// skips with one logged warning line and the spawn continues ---
const rootAX = fixture();
cleaned.push(rootAX);
const homeAX = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAX);
mkdirSync(kanbanDir(rootAX), { recursive: true });
const savedHomeAX = process.env.HOME;
process.env.HOME = homeAX;
let cfgAX: ReturnType<typeof loadConfig>;
try {
	cfgAX = loadConfig(rootAX);
} finally {
	process.env.HOME = savedHomeAX;
}
const projectPromptAX = "# project instructions: answer in ASD-STE100\n";
writeFileSync(join(rootAX, "AGENTS.md"), projectPromptAX);
// tracked AGENTS.md: force-added over the fixture's ignore rule, so a worktree checkout
// carries a real file where the role-notes symlink must go
execSync("git add -f AGENTS.md && git commit -qm agents", { cwd: rootAX, shell: "/bin/bash" });
// passive stub: records argv and exits 0 without touching git, so the git-status asserts
// run against the spawn setup alone
const stubAX = join(rootAX, "ax-agent.cjs");
writeFileSync(
	stubAX,
	`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(join(rootAX, "argv.log"))}, JSON.stringify({ argv: process.argv }) + "\\n");
`,
);
chmodSync(stubAX, 0o755);
cfgAX.agent = stubAX;
const taskAX = createTask(rootAX, { name: "feat: agents injection", summary: "Injection smoke", specs: "n/a", complexity: "simple" });
setState(rootAX, taskAX, "to-do");
rescan(rootAX, cfgAX);
const wtAX = join(rootAX, ".worktrees", parseTask(rootAX, taskAX.file).worktree);
assert.ok(lstatSync(join(wtAX, "AGENTS.md")).isSymbolicLink(), "the AGENTS.md role-notes symlink was created");
assert.equal(readlinkSync(join(wtAX, "AGENTS.md")), join(".kanban", "AGENTS.developer.md"), "the symlink points at the role notes");
assert.equal(execSync("git ls-files -v AGENTS.md", { cwd: wtAX, encoding: "utf8" }).trim(), "S AGENTS.md", "the tracked AGENTS.md is marked skip-worktree");
assert.equal(execSync("git status --porcelain", { cwd: wtAX, encoding: "utf8" }), "", "git status stays clean after the symlink replaced the tracked file");
await waitFor(() => existsSync(join(rootAX, "argv.log")), 10000, "the stub recorded its argv", () => "");
const axArgv = () => readFileSync(join(rootAX, "argv.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[] });
const axSpawn = axArgv().at(-1)!;
const promptIdx = axSpawn.argv.indexOf("--append-system-prompt");
assert.ok(promptIdx !== -1, "the developer spawn carries --append-system-prompt");
assert.equal(axSpawn.argv[promptIdx + 1], projectPromptAX, "the project AGENTS.md content rides as one argv element right after the flag");
// at the cap the injection still rides as one argv element and the spawn works (the real kernel argv limit)
writeFileSync(join(rootAX, "AGENTS.md"), "x".repeat(131_000));
const beforeAX0 = axArgv().length;
const taskAX0 = createTask(rootAX, { name: "feat: agents cap edge", summary: "Injection edge smoke", specs: "n/a", complexity: "simple" });
setState(rootAX, taskAX0, "to-do");
rescan(rootAX, cfgAX);
await waitFor(() => axArgv().length > beforeAX0, 10000, "the at-cap stub recorded its argv", () => "");
const axSpawn0 = axArgv().at(-1)!;
const promptIdx0 = axSpawn0.argv.indexOf("--append-system-prompt");
assert.ok(promptIdx0 !== -1, "the at-cap spawn carries --append-system-prompt");
assert.equal(axSpawn0.argv[promptIdx0 + 1].length, 131_000, "a 131,000-byte prompt is injected and the spawn succeeds");
// over the cap the injection skips with one warning line and the spawn continues
writeFileSync(join(rootAX, "AGENTS.md"), "x".repeat(131_001));
const beforeAX = axArgv().length;
const taskAX2 = createTask(rootAX, { name: "feat: agents cap", summary: "Injection cap smoke", specs: "n/a", complexity: "simple" });
setState(rootAX, taskAX2, "to-do");
rescan(rootAX, cfgAX);
await waitFor(() => axArgv().length > beforeAX, 10000, "the capped stub recorded its argv", () => "");
const axSpawn2 = axArgv().at(-1)!;
assert.equal(axSpawn2.argv.indexOf("--append-system-prompt"), -1, "the injection skipped above the cap");
const orchLogAX = readFileSync(join(kanbanDir(rootAX), ".logs", "orchestrator.log"), "utf8");
assert.ok(orchLogAX.includes("AGENTS.md") && orchLogAX.includes("131001"), "one warning line names the file and its size");
cleanupAll(rootAX);
console.log("orchestrator.test.ts: ... + agents.md injection smoke passed");

// --- part AY: the claude backend. The spawn argv swaps pi's --approve/--mode json for
// claude's bypassPermissions/stream-json flags with the system prompt as one
// --append-system-prompt-file ref (project AGENTS.md + role notes concatenated: the claude
// flag does not repeat). Backend resolution: the config agent key wins when it names a
// backend, then the host-passed default (--default-agent), then pi; any other value stays
// an executable override. loadConfig runs directly with a temp HOME, rescan drives the
// spawns deterministically ---
const rootAY = fixture();
cleaned.push(rootAY);
const homeAY = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAY);
mkdirSync(kanbanDir(rootAY), { recursive: true });
const savedHomeAY = process.env.HOME;
process.env.HOME = homeAY;
try {
	// backend resolution: a config agent key that names a backend wins, then the host default, then pi
	const cfgFile = join(kanbanDir(rootAY), "se-llm-team.json");
	writeFileSync(cfgFile, JSON.stringify({ agent: "claude" }));
	assert.equal(loadConfig(rootAY).backend, "claude", "a config agent key naming a backend selects that backend");
	assert.equal(loadConfig(rootAY).agent, "claude", "the backend name is also the spawned executable");
	writeFileSync(cfgFile, JSON.stringify({ agent: "pi" }));
	assert.equal(loadConfig(rootAY, "claude").backend, "pi", "a config agent key naming pi wins over the host default");
	writeFileSync(cfgFile, "{}");
	const claudeCfg = loadConfig(rootAY, "claude");
	assert.equal(claudeCfg.backend, "claude", "the host default applies when the config sets no agent key");
	assert.equal(claudeCfg.agent, "claude", "an unset executable falls back to the backend CLI name");
	assert.equal(loadConfig(rootAY).backend, "pi", "pi stays the fallback without a config key or host default");
	// the claude spawn: config agent = an argv-recording stub, host default claude
	const stubAY = join(rootAY, "ay-agent.cjs");
	writeFileSync(
		stubAY,
		`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(join(rootAY, "argv.log"))}, JSON.stringify({ argv: process.argv }) + "\\n");
`,
	);
	chmodSync(stubAY, 0o755);
	writeFileSync(cfgFile, JSON.stringify({ agent: stubAY, model: "cc-model", thinking: "xhigh" }));
	const cfgAY = loadConfig(rootAY, "claude");
	assert.equal(cfgAY.backend, "claude", "a non-backend agent value stays an executable override");
	assert.equal(cfgAY.agent, stubAY, "the executable override survives backend selection");
	const projectPromptAY = "# project instructions: claude backend\n";
	writeFileSync(join(rootAY, "AGENTS.md"), projectPromptAY);
	const spawnAY = () => {
		const task = createTask(rootAY, { name: "feat: claude spawn", summary: "Claude backend smoke", specs: "n/a", complexity: "simple" });
		setState(rootAY, task, "to-do");
		const before = argvAY().length;
		rescan(rootAY, cfgAY);
		return waitFor(() => argvAY().length > before, 10000, "the stub recorded its argv", () => "").then(() => argvAY().at(-1)!);
	};
	const argvAY = () =>
		existsSync(join(rootAY, "argv.log"))
			? readFileSync(join(rootAY, "argv.log"), "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((l) => JSON.parse(l) as { argv: string[] })
			: [];
	const aySpawn = await spawnAY();
	// the stub runs as `node stub.cjs <agent args>`: argv[1] is the stub path, the agent argv starts at index 2
	assert.equal(aySpawn.argv[1], stubAY, "the config executable is spawned");
	const a = aySpawn.argv.slice(2);
	assert.equal(a[0], "-p", "the prompt travels as the -p positional");
	assert.ok(a[1].includes("Developer agent"), "the -p prompt is the role prompt");
	for (const flag of ["--approve", "--mode", "--thinking", "--provider", "--append-system-prompt"]) assert.equal(a.indexOf(flag), -1, `${flag} stays out of the claude spawn argv`);
	assert.deepEqual(a.slice(a.indexOf("--permission-mode"), a.indexOf("--permission-mode") + 2), ["--permission-mode", "bypassPermissions"]);
	assert.deepEqual(a.slice(a.indexOf("--output-format"), a.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
	assert.ok(a.includes("--verbose"), "stream-json output pairs with --verbose");
	assert.deepEqual(a.slice(a.indexOf("--model"), a.indexOf("--model") + 2), ["--model", "cc-model"]);
	assert.deepEqual(a.slice(a.indexOf("--effort"), a.indexOf("--effort") + 2), ["--effort", "xhigh"]);
	const fileIdx = a.indexOf("--append-system-prompt-file");
	assert.ok(fileIdx !== -1, "the claude spawn carries --append-system-prompt-file");
	const spContent = readFileSync(a[fileIdx + 1], "utf8");
	assert.ok(spContent.includes("project instructions"), "the project AGENTS.md rides in the concatenated system-prompt file");
	assert.ok(spContent.includes("# developer:"), "the role notes ride in the concatenated system-prompt file");
	// effort mapping: off and minimal have no claude effort, both map to low; max passes through; unset adds no flag
	for (const [thinking, effort] of [["off", "low"], ["minimal", "low"], ["max", "max"], [undefined, null]] as const) {
		writeFileSync(cfgFile, JSON.stringify({ agent: stubAY, thinking }));
		const cfgCase = loadConfig(rootAY, "claude");
		const spawnCase = await (async () => {
			const task = createTask(rootAY, { name: `feat: claude effort ${thinking}`, summary: "Effort mapping smoke", specs: "n/a", complexity: "simple" });
			setState(rootAY, task, "to-do");
			const before = argvAY().length;
			rescan(rootAY, cfgCase);
			await waitFor(() => argvAY().length > before, 10000, "the effort stub recorded its argv", () => "");
			return argvAY().at(-1)!;
		})();
		if (effort) assert.deepEqual(spawnCase.argv.slice(spawnCase.argv.indexOf("--effort"), spawnCase.argv.indexOf("--effort") + 2), ["--effort", effort], `thinking ${thinking} maps to --effort ${effort}`);
		else assert.equal(spawnCase.argv.indexOf("--effort"), -1, "an unset thinking adds no --effort");
	}
	// over the 131,000-byte cap the project part skips with a warning; the role notes still ride
	writeFileSync(join(rootAY, "AGENTS.md"), "x".repeat(131_001));
	const capSpawn = await (async () => {
		const task = createTask(rootAY, { name: "feat: claude cap", summary: "Cap smoke", specs: "n/a", complexity: "simple" });
		setState(rootAY, task, "to-do");
		const before = argvAY().length;
		rescan(rootAY, cfgAY);
		await waitFor(() => argvAY().length > before, 10000, "the capped stub recorded its argv", () => "");
		return argvAY().at(-1)!;
	})();
	const capIdx = capSpawn.argv.indexOf("--append-system-prompt-file");
	assert.ok(capIdx !== -1, "the capped spawn still carries the file ref");
	const capContent = readFileSync(capSpawn.argv[capIdx + 1], "utf8");
	assert.ok(!capContent.includes("project instructions"), "the project part skipped above the cap");
	assert.ok(capContent.includes("# developer:"), "the role notes still ride above the cap");
	assert.ok(readFileSync(join(kanbanDir(rootAY), ".logs", "orchestrator.log"), "utf8").includes("131001"), "one warning line names the file and its size");
	// an invalid host default warns and falls back to pi
	writeFileSync(cfgFile, "{}");
	loadConfig(rootAY, "banana");
	assert.ok(readFileSync(join(kanbanDir(rootAY), ".logs", "orchestrator.log"), "utf8").includes("unknown default agent"), "an invalid default agent warns");
} finally {
	process.env.HOME = savedHomeAY;
}
cleanupAll(rootAY);
console.log("orchestrator.test.ts: ... + claude backend spawn smoke passed");
