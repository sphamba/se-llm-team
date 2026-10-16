import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTask, taskFiles, taskNum } from "../../src/kanban.ts";

// number allocation: repeated creates never share a number
const raceRoot = mkdtempSync(join(tmpdir(), "kanban-race-"));
const created: string[] = [];
for (let i = 0; i < 5; i++) {
	created.push(createTask(raceRoot, { name: `feat: race ${i}`, summary: "s" }).file);
}
assert.equal(new Set(created).size, created.length);
// the duplicate-number net (drop-and-retry after the write) only fires when a rival file
// lands inside the scan/write window, after the max scan: a preload hooks the racer's own
// 000006 write and injects the rival there. The test process's fs bindings are already
// resolved, so the interception runs in a child (same pattern as the concurrency block).
const rivalFile = join(raceRoot, ".kanban", "000006_other_creator.md");
const preload = join(raceRoot, "preload.cjs");
writeFileSync(
	preload,
	`const fs = require("node:fs");
const orig = fs.writeFileSync;
const target = ${JSON.stringify(join(raceRoot, ".kanban", "000006_racer.md"))};
fs.writeFileSync = function (p, ...args) {
	if (String(p) === target && !globalThis.__rivalInjected) {
		globalThis.__rivalInjected = true;
		orig.call(fs, ${JSON.stringify(rivalFile)}, ${JSON.stringify('---\nname: "other"\n---\n')});
	}
	return orig.call(fs, p, ...args);
};`,
);
const racerMod = JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "..", "src", "kanban.ts")).href);
const racerOut = await new Promise((resolve, reject) => {
	let stdout = "";
	let err = "";
	const child = spawn(
		process.execPath,
		[
			"--require",
			preload,
			"-e",
			`import(${racerMod}).then(({ createTask }) => { const t = createTask(${JSON.stringify(raceRoot)}, { name: "feat: racer", summary: "s" }); process.stdout.write(JSON.stringify({ file: t.file, injected: globalThis.__rivalInjected === true })); })`,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	child.stdout.on("data", (d) => (stdout += d));
	child.stderr.on("data", (d) => (err += d));
	child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`racer exited ${code}: ${err}`))));
});
const racer = JSON.parse(racerOut);
assert.ok(racer.injected); // the rival was written after the max scan, inside the window
assert.equal(racer.file, "000007_racer.md"); // first attempt unlinked, retried past the rival
assert.ok(!existsSync(join(raceRoot, ".kanban", "000006_racer.md"))); // the dropped attempt left nothing
assert.match(readFileSync(rivalFile, "utf8"), /other/); // the rival survived untouched
created.push(racer.file);
assert.equal(new Set(created).size, created.length);
const raceNums = taskFiles(raceRoot).map(taskNum);
assert.equal(new Set(raceNums).size, raceNums.length); // never two files with one number, hand-written ones included
rmSync(raceRoot, { recursive: true, force: true });

// simultaneous creators racing through repeated creates: the wx flag only guards the
// exact path, so createTask holds a lock file across scan+write; the lock serializes
// the allocation and every slug differs, so no duplicate number can arise here: this
// block proves unique numbers under contention, while the net itself is exercised only
// by the race block above
const concRoot = mkdtempSync(join(tmpdir(), "kanban-conc-"));
const mod = JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "..", "src", "kanban.ts")).href);
const creator = `import(${mod}).then(({ createTask }) => { for (let i = 0; i < 20; i++) createTask(${JSON.stringify(concRoot)}, { name: "feat: concurrent " + process.pid + " " + i, summary: "s" }); })`;
await Promise.all(
	Array.from({ length: 4 }, () =>
		new Promise<void>((resolve, reject) => {
			let err = "";
			const child = spawn(process.execPath, ["-e", creator], { stdio: ["ignore", "ignore", "pipe"] });
			child.stderr.on("data", (d) => (err += d));
			child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`creator exited ${code}: ${err}`))));
		}),
	),
);
const concNums = taskFiles(concRoot).map(taskNum);
assert.equal(concNums.length, 80); // every creator landed its 20 tasks
assert.equal(new Set(concNums).size, concNums.length); // never two files with one number
rmSync(concRoot, { recursive: true, force: true });

// a lock left behind by a crashed creator is stolen, not fatal
const staleRoot = mkdtempSync(join(tmpdir(), "kanban-stale-"));
const staleLock = join(staleRoot, ".kanban", ".create.lock");
mkdirSync(join(staleRoot, ".kanban"), { recursive: true });
writeFileSync(staleLock, "999999");
utimesSync(staleLock, Date.now() / 1000 - 20000, Date.now() / 1000 - 20000);
assert.equal(createTask(staleRoot, { name: "fix: after crash", summary: "s" }).file, "000001_after_crash.md");
assert.equal(existsSync(staleLock), false); // lock stolen, no leftovers
rmSync(staleRoot, { recursive: true, force: true });

// a lock under the threshold at call time but aging past it: the give-up window must
// outlive the steal threshold, or createTask fails after about 1 s instead of waiting
// for the steal (live #174 evidence: a lock held 8 s beat the old 1 s window)
const heldRoot = mkdtempSync(join(tmpdir(), "kanban-held-"));
const heldLock = join(heldRoot, ".kanban", ".create.lock");
mkdirSync(join(heldRoot, ".kanban"), { recursive: true });
writeFileSync(heldLock, "999999");
utimesSync(heldLock, Date.now() / 1000 - 8, Date.now() / 1000 - 8); // seconds, not ms
assert.equal(createTask(heldRoot, { name: "fix: held lock", summary: "s" }).file, "000001_held_lock.md");
assert.equal(existsSync(heldLock), false); // stolen once it aged past the threshold
rmSync(heldRoot, { recursive: true, force: true });
console.log("kanban: locking tests passed");
