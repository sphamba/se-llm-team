import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "./src/kanban.ts";
import { pidAlive } from "./src/pid.ts";

// pi loads index.ts with jiti, which resolves @earendil-works/* and typebox from pi's own
// install; plain node cannot. Stub those runtime imports, and stub spawn so that
// orchestrator_start records its call instead of launching a daemon.
const stubs: Record<string, string> = {
	"@earendil-works/pi-ai": `export const StringEnum = (values) => ({ type: "string", enum: values });`,
	typebox: `export const Type = { Object: (properties) => ({ type: "object", properties }), Optional: (schema) => schema, String: (options) => ({ type: "string", ...options }), Number: (options) => ({ type: "number", ...options }) };`,
	"node:child_process": `export * from "node:child_process";
export function spawn(cmd, args, opts) {
	(globalThis.__spawnCalls ??= []).push({ cmd, args, opts });
	return { pid: 4242, on() { return this; }, unref() {} };
}`,
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		const code = stubs[specifier];
		if (code && !context.parentURL?.startsWith("data:")) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});

const { default: extension, resolveRoot } = await import("./index.ts");

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };
const calls = () => (globalThis as any).__spawnCalls as Call[];
(globalThis as any).__spawnCalls = [];

const tools = new Map<string, any>();
extension({ registerTool: (tool: any) => tools.set(tool.name, tool), on: () => {} } as any);
const ctx = (cwd: string) => ({ cwd, ui: { notify: () => {} } }) as any;

const repo = realpathSync(mkdtempSync(join(tmpdir(), "index-test-")));
execFileSync("git", ["init", "-q"], { cwd: repo });
const sub = join(repo, "sub", "dir");
mkdirSync(sub, { recursive: true });
const plain = mkdtempSync(join(tmpdir(), "index-plain-"));

// resolveRoot: the repo root from the root and from a subdirectory, a marker elsewhere
assert.deepEqual(resolveRoot(repo), repo);
assert.deepEqual(resolveRoot(sub), repo);
assert.deepEqual(resolveRoot(plain), null);

// orchestrator_start on a fresh git repo resolves the root and spawns the daemon there
const started = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub));
assert.equal(calls().length, 1);
assert.ok(calls()[0].args[0] === "--watch", "the daemon runs under node --watch");
assert.ok(calls()[0].args[1].endsWith(join("src", "orchestrator.ts")));
assert.deepEqual(calls()[0].args.slice(-2), ["--root", repo]);
assert.match(started.content[0].text, /^Orchestrator starting \(pid 4242\)/);

// a non-git directory refuses and spawns nothing
const refused = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(plain));
assert.equal(calls().length, 1);
assert.match(refused.content[0].text, /^Not a git repository: .*No orchestrator started\.$/);

// an unusable .kanban (dangling symlink) is reported, not thrown, and spawns nothing
const broken = join(plain, "repo");
mkdirSync(broken);
execFileSync("git", ["init", "-q"], { cwd: broken });
symlinkSync(join(broken, "gone"), join(broken, ".kanban"));
const failed = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(broken));
assert.equal(calls().length, 1);
assert.match(failed.content[0].text, /^Cannot start the orchestrator: /);

// status, poke and stop from a subdirectory read the root board and lock
createTask(repo, { name: "feat: root board task", summary: "s" });
writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${process.pid}\n`);
const status = await tools.get("orchestrator_status").execute("id", {}, undefined, undefined, ctx(sub));
assert.match(status.content[0].text, new RegExp(`^running \\(pid ${process.pid}\\); board: \\{"backlog":1\\}$`));
await tools.get("orchestrator_poke").execute("id", {}, undefined, undefined, ctx(sub));
assert.ok(existsSync(join(repo, ".kanban", ".poke")));

const victim = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
try {
	writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${victim.pid}\n`);
	const stopped = await tools.get("orchestrator_stop").execute("id", {}, undefined, undefined, ctx(sub));
	assert.match(stopped.content[0].text, new RegExp(`^Sent SIGTERM to orchestrator pid ${victim.pid}$`));
	await new Promise<void>((resolve) => victim.on("exit", () => resolve()));
} finally {
	victim.kill();
}

// a node --watch-style victim: a detached supervisor leading its own group, a child in it.
// The stop signals the group, so both die; a bare pid kill would orphan the child to
// resurrect the daemon on the next watched change
const childPidPath = join(repo, ".kanban", "watch-child.pid");
const victimGroup = spawn(
	process.execPath,
	[
		"-e",
		`const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(childPidPath)}, String(c.pid));
setInterval(() => {}, 60000);`,
	],
	{ detached: true, stdio: "ignore" },
);
victimGroup.unref();
try {
	await new Promise((r) => setTimeout(r, 300));
	writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${victimGroup.pid}\n`);
	const stoppedGroup = await tools.get("orchestrator_stop").execute("id", {}, undefined, undefined, ctx(sub));
	assert.match(stoppedGroup.content[0].text, new RegExp(`^Sent SIGTERM to orchestrator pid ${victimGroup.pid}$`));
	await new Promise((r) => setTimeout(r, 500));
	assert.ok(!pidAlive(victimGroup.pid), "the supervisor died");
	assert.ok(!pidAlive(parseInt(readFileSync(childPidPath, "utf8").trim(), 10)), "the child died with the group");

	rmSync(childPidPath, { force: true });
} finally {
	try {
		process.kill(-victimGroup.pid, "SIGKILL");
	} catch {
		/* already gone */
	}
}

// 000195: orchestrator_start warns when the running daemon lacks a node --watch supervisor
// (a daemon spawned by a stale session, pre-000192 extension code, survives no src change).
// The warn victim is a real child whose cmdline carries orchestrator.ts, so the daemon
// identification passes and the missing supervisor is decidable
const orchDir = mkdtempSync(join(tmpdir(), "index-orch-"));
const warnScript = join(orchDir, "orchestrator.ts");
writeFileSync(warnScript, "setInterval(() => {}, 60000);\n");
const unwatched = spawn(process.execPath, [warnScript], { stdio: "ignore" });
try {
	writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${unwatched.pid}\n`);
	const warned = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub));
	assert.equal(calls().length, 1, "no new spawn while a daemon runs");
	assert.match(warned.content[0].text, /^Orchestrator already running \(pid \d+\) without a node --watch supervisor: /);
	assert.ok(warned.content[0].text.includes("Stop the orchestrator, then start it again"), "the warning names the remedy");
} finally {
	unwatched.kill();
}

// the watched counterpart: a node --watch supervisor with a daemon child (the 000192 spawn
// shape, the lock pid is the child) keeps the start silent
const watchDir = mkdtempSync(join(tmpdir(), "index-watch-"));
const watchedScript = join(watchDir, "orchestrator.ts");
const watchedPidFile = join(watchDir, "child.pid");
// type module: node loads a .ts fixture as CJS without it and the child dies before writing
writeFileSync(join(watchDir, "package.json"), '{"type": "module"}');
writeFileSync(watchedScript, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(watchedPidFile)}, String(process.pid));\nsetInterval(() => {}, 60000);\n`);
const supervisor = spawn(process.execPath, ["--watch", watchedScript], { detached: true, stdio: "ignore" });
supervisor.unref();
try {
	let daemonPid = 0;
	for (let i = 0; i < 100 && !daemonPid; i++) {
		await new Promise((r) => setTimeout(r, 100));
		try { daemonPid = parseInt(readFileSync(watchedPidFile, "utf8").trim(), 10); } catch { /* the child has not started yet */ }
	}
	assert.ok(daemonPid > 0 && pidAlive(daemonPid), "the watched daemon child is alive");
	writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${daemonPid}\n`);
	const quiet = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub));
	assert.equal(calls().length, 1, "no new spawn while a daemon runs");
	assert.match(quiet.content[0].text, new RegExp(`^Orchestrator already running \\(pid ${daemonPid}\\)$`));
} finally {
	try {
		process.kill(-supervisor.pid!, "SIGKILL");
	} catch {
		/* already gone */
	}
}

// a lock pid that is not an orchestrator daemon (here: this test process) stays silent too:
// the warning fires only when the missing supervisor is decidable (non-Linux /proc: the same)
writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${process.pid}\n`);
const foreign = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub));
assert.equal(calls().length, 1);
assert.match(foreign.content[0].text, new RegExp(`^Orchestrator already running \\(pid ${process.pid}\\)$`));

rmSync(repo, { recursive: true, force: true });
rmSync(plain, { recursive: true, force: true });
rmSync(orchDir, { recursive: true, force: true });
rmSync(watchDir, { recursive: true, force: true });
console.log("index.test.ts: all assertions passed");
