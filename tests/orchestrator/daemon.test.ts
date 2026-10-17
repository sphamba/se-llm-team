import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, kanbanDir, parseTask, setState } from "../../src/kanban.ts";
import { pidAlive } from "../../src/pid.ts";
import { HERE, fixture, runDaemon, waitFor, waitForAsync, freePort, daemons, cleaned } from "../helpers.ts";

// --- part AQ: killing or restarting the daemon must not kill the spawned agents. The agent's
// stdout/stderr are the log file fd (a pipe read end would live in the daemon and its death
// would EPIPE the agent's next write), so the agent survives a SIGTERM stop, keeps logging,
// and the next daemon picks it up as alive from the pid file instead of spawning a twin ---
const rootAQ = fixture();
cleaned.push(rootAQ);
mkdirSync(kanbanDir(rootAQ), { recursive: true });
// a fake long-running agent: one JSONL delta line every 100ms, never exits, never touches the task
const fakeAQ = join(rootAQ, "fake-agent.cjs");
writeFileSync(
	fakeAQ,
	`#!/usr/bin/env node
setInterval(() => {
	process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: String(process.hrtime.bigint()) } }) + "\\n");
}, 100);
`,
);
chmodSync(fakeAQ, 0o755);
writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ agent: fakeAQ, pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskAQ = createTask(rootAQ, { name: "fix: survive restart", summary: "Restart survival smoke", specs: "n/a", complexity: "simple" });
setState(rootAQ, taskAQ, "to-do");
const slugAQ = taskAQ.file.replace(/\.md$/, "");
const logAQ = join(kanbanDir(rootAQ), ".logs", `${slugAQ}.developer.0.log`);
const pidFileAQ = join(kanbanDir(rootAQ), ".pids", `${slugAQ}.pid`);

const aq = await runDaemon(rootAQ);
await waitFor(() => existsSync(logAQ) && statSync(logAQ).size > 0, 30000, "fake agent spawned and logging", aq.output);
const agentPidAQ = parseInt(readFileSync(pidFileAQ, "utf8").trim(), 10);
assert.ok(pidAlive(agentPidAQ), "the fake agent runs");

// stop the daemon the way production does: kill <pid>
aq.daemon.kill("SIGTERM");
await Promise.race([new Promise((r) => aq.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
assert.ok(pidAlive(agentPidAQ), "the agent survived the daemon's death");
const sizeAQ = statSync(logAQ).size;
await new Promise((r) => setTimeout(r, 1500));
assert.ok(statSync(logAQ).size > sizeAQ, "the log still grows after the daemon's death");
assert.ok(pidAlive(agentPidAQ), "the agent still runs while logging");

// the restart picks the agent up as alive (pid file + liveness): no twin, the log keeps growing
const aq2 = await runDaemon(rootAQ);
await new Promise((r) => setTimeout(r, 2500));
assert.equal(aq2.output().split("spawned developer").length - 1, 0, "the new daemon spawned no twin");
assert.ok(pidAlive(agentPidAQ), "the agent survived the restart");
const size2AQ = statSync(logAQ).size;
await new Promise((r) => setTimeout(r, 1500));
assert.ok(statSync(logAQ).size > size2AQ, "the log still grows after the restart");
assert.equal(parseTask(rootAQ, taskAQ.file).state, "doing", "the in-flight state survived the restart");
aq2.daemon.kill("SIGTERM");
try {
	process.kill(agentPidAQ, "SIGKILL");
} catch {
	/* already gone */
}
console.log("orchestrator.test.ts: ... + daemon-restart survival smoke passed");

// --- part AV: 000253 the daemon runs as a plain node process, no node --watch supervisor.
// The launch mirrors index.ts orchestrator_start; an mtime-only touch of a src file restarts
// nothing (the lock pid survives), and the webui keeps answering ---
const rootAV = fixture();
cleaned.push(rootAV);
const homeAV = mkdtempSync(join(tmpdir(), "orch-watch-home-"));
cleaned.push(homeAV);
mkdirSync(join(homeAV, ".pi", "agent"), { recursive: true });
const portAV = await freePort();
writeFileSync(join(homeAV, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portAV }, backlogIdleMinutes: 0 }));
const envAV = { ...process.env, HOME: homeAV, SE_LLM_TEAM_HUB_HEALTH_MS: "500" };
delete envAV.SE_LLM_TEAM_NO_WEBUI; // the webui check needs it enabled; the temp HOME config picks a free port
const dAV = spawn(
	process.execPath,
	[join(HERE, "../src/orchestrator.ts"), "--root", rootAV, "--rescan-seconds", "1", "--poll-minutes", "0.05"],
	{ stdio: ["ignore", "pipe", "pipe"], env: envAV },
);
daemons.push({ daemon: dAV, root: rootAV });
let outAV = "";
dAV.stdout.on("data", (d) => (outAV += d));
dAV.stderr.on("data", (d) => (outAV += d));
const lockPidAV = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootAV), ".orchestrator.lock"), "utf8").trim(), 10);
	} catch {
		return 0;
	}
};
await waitFor(() => lockPidAV() > 0 && pidAlive(lockPidAV()), 15000, "the daemon acquired the lock", () => outAV);
const pidAV1 = lockPidAV();
const baseAV = `http://127.0.0.1:${portAV}`;
await waitForAsync(async () => {
	try {
		return (await (await fetch(`${baseAV}/api/projects`)).json()).length === 1;
	} catch {
		return false;
	}
}, 15000, "the daemon serves the webui");
// mtime-only touch of a src file: without node --watch nothing restarts the daemon, so the
// lock pid survives and the log never sees node --watch's "Restarting" line (000253)
utimesSync(join(HERE, "../src/orchestrator.ts"), new Date(), new Date());
await new Promise((r) => setTimeout(r, 4000));
assert.equal(lockPidAV(), pidAV1, "the daemon survived the src touch without a restart");
assert.ok(!outAV.includes("Restarting"), "no node --watch supervisor restarted the daemon");
// a plain process: one SIGTERM takes it down and the lock vanishes, no supervisor survives
dAV.kill("SIGTERM");
await waitFor(() => lockPidAV() === 0, 10000, "the daemon exited and released the lock", () => outAV);
console.log("orchestrator.test.ts: ... + plain daemon, no node --watch smoke passed");

// --- part AZ (#233): the detached daemon's stdout is the log file itself (orchestrator_start
// spawns with stdio ["ignore", log, log]), so log()'s unconditional stdout echo appended
// every line a second time. The echo is skipped only when stdout is that same file; a pipe
// (a test harness, a foreground tee) still receives it ---
const rootAZ = mkdtempSync(join(tmpdir(), "orch-log-"));
const logsAZ = join(kanbanDir(rootAZ), ".logs");
mkdirSync(logsAZ, { recursive: true });
const logAZ = join(logsAZ, "orchestrator.log");
const logModuleAZ = join(HERE, "../src/orchestrator/log.ts");
const logCodeAZ = `import { log } from ${JSON.stringify(logModuleAZ)}; log(${JSON.stringify(rootAZ)}, "az first line"); log(${JSON.stringify(rootAZ)}, "az second line");`;
const logChildAZ = (stdio: (string | number)[]) =>
	new Promise<string>((resolve) => {
		const child = spawn(process.execPath, ["--input-type=module", "-e", logCodeAZ], { stdio });
		let out = "";
		child.stdout?.on("data", (d) => (out += d));
		child.on("exit", () => resolve(out));
	});
// the detached daemon shape: stdout IS the log file (orchestrator_start's stdio ["ignore", log, log])
const logFdAZ = openSync(logAZ, "a");
await logChildAZ(["ignore", logFdAZ, "ignore"]);
closeSync(logFdAZ);
const logLinesAZ = readFileSync(logAZ, "utf8").trim().split("\n");
assert.equal(logLinesAZ.length, 2, "stdout pointing at the log file writes each line once");
for (const message of ["az first line", "az second line"]) {
	assert.equal(logLinesAZ.filter((l) => l.includes(message)).length, 1, `exactly one line for "${message}"`);
}
// a piped stdout is not the log file: the echo is kept (foreground and test visibility)
writeFileSync(logAZ, "");
const pipedAZ = await logChildAZ(["ignore", "pipe", "ignore"]);
assert.equal(pipedAZ.trim().split("\n").length, 2, "a piped stdout keeps the echo");
assert.equal(readFileSync(logAZ, "utf8").trim().split("\n").length, 2, "and the file still gets one line per call");
rmSync(rootAZ, { recursive: true, force: true });
console.log("orchestrator.test.ts: ... + single orchestrator log write passed");
