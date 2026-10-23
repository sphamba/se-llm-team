import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { kanbanDir } from "../../src/kanban.ts";
import { HERE, fixture, runDaemon, waitFor, cleaned } from "../helpers.ts";

// --- part C: lock lifecycle: singleton, self-heal while running, release on stop ---
const rootC = fixture();
cleaned.push(rootC);
const c = await runDaemon(rootC);
const lockC = () => {
	try {
		return readFileSync(join(kanbanDir(rootC), ".orchestrator.lock"), "utf8").trim();
	} catch {
		return "";
	}
};
await waitFor(() => lockC() !== "", 10000, "lock acquired", c.output);
assert.equal(lockC(), String(c.daemon.pid), "lock holds the daemon pid");

// a second start attempt exits instead of becoming a daemon; the first keeps the lock
const second = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootC], { stdio: "ignore", env: { ...process.env, SE_LLM_TEAM_NO_WEBUI: "1" } });
const secondExit = await Promise.race([
	new Promise<string>((r) => second.on("exit", (code) => r(String(code)))),
	new Promise<string>((r) => setTimeout(() => r("timeout"), 10000)),
]);
second.kill("SIGTERM");
assert.equal(secondExit, "0", "second start attempt exits instead of becoming a daemon");
assert.equal(lockC(), String(c.daemon.pid), "lock still held by the first daemon");

// self-heal: the daemon re-acquires the lock when it goes missing mid-life
rmSync(join(kanbanDir(rootC), ".orchestrator.lock"));
await waitFor(() => lockC() === String(c.daemon.pid), 10000, "lock re-acquired after deletion", c.output);

// stop: SIGTERM ends the daemon and releases the lock
const stopped = new Promise<string>((r) => c.daemon.on("exit", (code) => r(String(code))));
c.daemon.kill("SIGTERM");
assert.equal(await Promise.race([stopped, new Promise<string>((r) => setTimeout(() => r("timeout"), 10000))]), "0", "daemon exits on SIGTERM");
await waitFor(() => lockC() === "", 10000, "lock released on stop", c.output);

// --- part C2: a read-only .git is refused before the lock or any board write ---
const rootC2 = fixture();
cleaned.push(rootC2);
try {
	chmodSync(join(rootC2, ".git"), 0o555);
	const refused = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootC2], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, SE_LLM_TEAM_NO_WEBUI: "1" },
	});
	let outC2 = "";
	refused.stdout.on("data", (chunk: Buffer) => (outC2 += chunk));
	refused.stderr.on("data", (chunk: Buffer) => (outC2 += chunk));
	const refusedExit = await Promise.race([
		new Promise<string>((r) => refused.on("exit", (code) => r(String(code)))),
		new Promise<string>((r) => setTimeout(() => r("timeout"), 10000)),
	]);
	refused.kill("SIGTERM");
	assert.equal(refusedExit, "1", `a read-only .git exits 1: ${outC2}`);
	assert.ok(outC2.includes("Cannot start the orchestrator: .git is not writable at "), `the refusal message is pinned: ${outC2}`);
	assert.ok(outC2.includes(join(rootC2, ".git")), `the refusal names the git dir: ${outC2}`);
	assert.equal(existsSync(kanbanDir(rootC2)), false, "no .kanban dir, lock, log or board write");
} finally {
	chmodSync(join(rootC2, ".git"), 0o755);
}
console.log("singleton.test.ts: all assertions passed");
