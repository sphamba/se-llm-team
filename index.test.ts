import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "./src/kanban.ts";
import { liveOwner, ownerPath, reportSid, reportsDir, writeOwner, writeReport } from "./src/orchestrator/report.ts";
import { pidAlive } from "./src/pid.ts";

// pi loads index.ts with jiti; the extension imports the pi packages as types only (erased),
// so plain node can load it. Stub spawn so that orchestrator_start records its call instead
// of launching a daemon.
const stubs: Record<string, string> = {
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

const { default: extension, debounce } = await import("./index.ts");
const { resolveRoot } = await import("./src/tools.ts");

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };
const calls = () => (globalThis as any).__spawnCalls as Call[];
(globalThis as any).__spawnCalls = [];

const tools = new Map<string, any>();
const handlers = new Map<string, any>();
const sent: string[] = [];
extension({
	registerTool: (tool: any) => tools.set(tool.name, tool),
	on: (name: string, fn: any) => handlers.set(name, fn),
	sendMessage: (message: any) => sent.push(message.content),
} as any);
const ctx = (cwd: string, sid = "sess-a") =>
	({ cwd, hasUI: true, isIdle: () => true, sessionManager: { getSessionId: () => sid }, ui: { notify: () => {} } }) as any;

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
assert.ok(calls()[0].args[0].endsWith(join("src", "orchestrator.ts")), "the daemon runs as a plain node process");
assert.ok(!calls()[0].args.includes("--watch"), "no node --watch supervisor");
assert.deepEqual(calls()[0].args.slice(1, 3), ["--root", repo]);
assert.deepEqual(calls()[0].args.slice(-2), ["--default-agent", "pi"], "the pi extension passes pi as the default agent");
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

// a detached group leader with a child in it (000253: not a node --watch supervisor any
// more, but a hand-set lock pid can still name a group leader). The stop signals the group,
// so both die; a bare pid kill would orphan the child
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

// a lock pid that is not an orchestrator daemon (here: this test process) reads the same
// plain running message (000253: no supervisor check is left)
writeFileSync(join(repo, ".kanban", ".orchestrator.lock"), `${process.pid}\n`);
const foreign = await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub));
assert.equal(calls().length, 1);
assert.match(foreign.content[0].text, new RegExp(`^Orchestrator already running \\(pid ${process.pid}\\)$`));

// 428: the claim runs before the already-running early return, so a session that attaches to a
// running daemon becomes the owner too
await tools.get("orchestrator_start").execute("id", {}, undefined, undefined, ctx(sub, "sess-b"));
assert.deepEqual(liveOwner(repo), { sid: "sess-b" });

// 428: the board report is addressed to the owner, so another root session never takes it.
// A live owner puts its sid in the name, no live owner leaves today's unaddressed name
const rrepo = realpathSync(mkdtempSync(join(tmpdir(), "index-reports-")));
execFileSync("git", ["init", "-q"], { cwd: rrepo });
const rdir = reportsDir(rrepo);
const seed = (name: string, body: string) => {
	mkdirSync(rdir, { recursive: true });
	writeFileSync(join(rdir, name), body);
};
const pending = () => {
	try {
		return readdirSync(rdir).filter((f) => f.endsWith(".md")).sort();
	} catch {
		return [];
	}
};
const onlyReport = () => {
	const files = pending();
	assert.equal(files.length, 1, `one report expected, got ${files.join(", ")}`);
	return files[0];
};
const A = "sess-a";
const B = "sess-b";

writeOwner(rrepo, A);
assert.deepEqual(liveOwner(rrepo), { sid: A });
assert.match(readFileSync(ownerPath(rrepo), "utf8"), new RegExp(`^${A} ${process.pid}( |$)`));
writeReport(rrepo, "live-owner");
const addressedName = onlyReport();
assert.equal(reportSid(addressedName), A, `a live owner gets the sid segment: ${addressedName}`);
rmSync(join(rdir, addressedName));

// a mismatched discriminator on a live pid is a dead owner (pid reuse): the record is dropped
// and the report is unaddressed
writeFileSync(ownerPath(rrepo), `${A} ${process.pid} not-the-start-tick`);
assert.equal(liveOwner(rrepo), null);
assert.ok(!existsSync(ownerPath(rrepo)), "a stale owner record is removed");
writeReport(rrepo, "no-owner");
const plainName = onlyReport();
assert.equal(reportSid(plainName), null, `no live owner leaves the name unaddressed: ${plainName}`);
rmSync(join(rdir, plainName));

// the sid becomes part of a file name and any process can write the record, so a sid carrying
// a path separator is no owner at all and never reaches the name
writeFileSync(ownerPath(rrepo), `../evil ${process.pid} x`);
assert.equal(liveOwner(rrepo), null);
writeReport(rrepo, "unacceptable-sid");
const rejectedName = onlyReport();
assert.equal(reportSid(rejectedName), null);
assert.ok(!rejectedName.includes(".."), `an unacceptable sid never reaches the name: ${rejectedName}`);
rmSync(join(rdir, rejectedName));
rmSync(ownerPath(rrepo), { force: true });

const sessionStart = handlers.get("session_start");
const sessionShutdown = handlers.get("session_shutdown");
// the watchers the handlers attach would race the next seed, so close them before returning
const drain = async (sid: string) => {
	sent.length = 0;
	sessionStart({ type: "session_start" }, ctx(rrepo, sid));
	const got = [...sent];
	await sessionShutdown();
	return got;
};

// no owner record: a session with any sid takes everything, today's behaviour
seed("t1.md", "r1");
seed("t4.sess-gone.md", "r4");
assert.deepEqual(await drain(A), ["r1", "r4"], "no registered owner leaves the queue work-stealing");
assert.deepEqual(pending(), []);

// a live owner: an addressed report belongs to its session only, and the rest stays on disk
writeOwner(rrepo, A);
seed("t1.md", "r1");
seed(`t2.${A}.md`, "r2");
seed(`t3.${B}.md`, "r3");
seed("t4.sess-gone.md", "r4");
assert.deepEqual(await drain(A), ["r1", "r2"], "the owner takes the unaddressed and its own report only");
assert.deepEqual(pending(), [`t3.${B}.md`, "t4.sess-gone.md"], "another session's report stays on disk");
assert.deepEqual(await drain(B), ["r3"], "the addressed session takes its own report");
assert.deepEqual(pending(), ["t4.sess-gone.md"], "a report addressed to a dead sid is not stolen");

// the orphan is claimable again once no owner is live: the no-live-owner fallback
rmSync(ownerPath(rrepo), { force: true });
assert.deepEqual(await drain(A), ["r4"], "a live session takes an orphan when no owner is registered");
assert.deepEqual(pending(), []);
rmSync(rrepo, { recursive: true, force: true });

// a burst of watch events costs one scan, not one per event (000445)
let fires = 0;
const burst = debounce(() => fires++, 30);
burst();
burst();
burst();
assert.equal(fires, 0, "a burst waits for the debounce timer");
await new Promise((r) => setTimeout(r, 150));
assert.equal(fires, 1, "a burst of watcher events costs one scan");

// a board watcher must never kill the session holding it: the scan here throws EISDIR and the
// process must still reach the next assertion (000445)
const wrepo = realpathSync(mkdtempSync(join(tmpdir(), "index-watch-")));
const wdir = join(wrepo, ".kanban");
mkdirSync(wdir);
sessionStart({ type: "session_start" }, ctx(wrepo));
mkdirSync(join(wdir, "000998_dir.md"));
await new Promise((r) => setTimeout(r, 300));
assert.ok(true, "the session survives a throwing scan");
await sessionShutdown();
rmSync(wrepo, { recursive: true, force: true });

rmSync(repo, { recursive: true, force: true });
rmSync(plain, { recursive: true, force: true });
console.log("index.test.ts: all assertions passed");
