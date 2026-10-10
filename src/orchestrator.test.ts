import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, kanbanDir, parseTask, setState } from "./kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "orch-smoke-"));
	execSync("git init -q", { cwd: root });
	execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
		cwd: root,
		shell: "/bin/bash",
	});
	writeFileSync(join(root, "README.md"), "x\n");
	execSync("git add -A && git commit -qm init", { cwd: root, shell: "/bin/bash" });
	return root;
}

// stub agent: parses its role out of the prompt and applies the pipeline transition;
// the developer also commits a code change, so the merge is a real one and the blanket
// git add -A in the worktree proves board changes cannot be staged
const roleStub = (root: string) => {
	const stub = join(root, "stub-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[4] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
if (prompt.includes("Developer agent")) {
	writeFileSync("code.txt", "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
const next = prompt.includes("Developer agent") ? "to-review"
	: prompt.includes("Reviewer agent") ? "to-live-test"
	: prompt.includes("Live-tester") ? "done" : null;
if (next) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: " + next));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// stub agent that only moves the developer forward, so the worktree persists
const devStub = (root: string) => {
	const stub = join(root, "dev-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const prompt = process.argv[4] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!prompt.includes("Developer agent") || !file || !readFileSync(file, "utf8").match(/^state: /m)) process.exit(0);
writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-review"));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// stub agent that always dies without updating the task
const deadStub = (root: string) => {
	const stub = join(root, "dead-agent.cjs");
	writeFileSync(stub, `#!/usr/bin/env node\nprocess.exit(0);\n`);
	chmodSync(stub, 0o755);
	return stub;
};

async function runDaemon(root: string) {
	const daemon = spawn(
		process.execPath,
		[join(HERE, "orchestrator.ts"), "--root", root, "--rescan-seconds", "1", "--poll-minutes", "0.05"],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let out = "";
	daemon.stdout.on("data", (d) => (out += d));
	daemon.stderr.on("data", (d) => (out += d));
	daemon.on("exit", (code, sig) => (out += `\n[daemon exit ${code} ${sig}]`));
	daemon.on("error", (e) => (out += `\n[daemon error ${e.message}]`));
	return { daemon, output: () => out };
}

const waitFor = async (cond: () => boolean, ms: number, what: string, out: () => string, root: string) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (cond()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	console.error(`timeout waiting for ${what}; daemon output (live):
${out()}`);
	cleanupAll(root);
	process.exit(1);
};
const cleaned: string[] = [];
const cleanupAll = (...roots: string[]) => roots.forEach((r) => rmSync(r, { recursive: true, force: true }));
process.on("exit", () => cleanupAll(...cleaned));

// --- part A: happy pipeline with a working stub ---
const rootA = fixture();
cleaned.push(rootA);
mkdirSync(kanbanDir(rootA), { recursive: true });
writeFileSync(join(kanbanDir(rootA), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootA), pollMinutes: 0.05 }));
const taskA = createTask(rootA, { name: "feat: smoke test", summary: "Pipeline smoke", specs: "Run the full pipeline" });
setState(rootA, taskA, "to-do");

const a = await runDaemon(rootA);
const readA = () => parseTask(rootA, taskA.file);

// to-do -> doing -> to-review -> reviewing -> to-live-test -> live-testing -> done -> merge.
// The stub transitions in milliseconds, so intermediate states are asserted through the daemon log.
await waitFor(() => readA().state === "done" && readA().worktree === "", 60000, "full pipeline + merge", a.output, rootA);
for (const marker of ["spawned developer", "spawned reviewer", "spawned live-tester", "merged feat/smoke-test"]) {
	assert.ok(a.output().includes(marker), `expected daemon log to contain: ${marker}`);
}
assert.ok(!existsSync(join(rootA, ".worktrees", "feat/smoke-test")), "worktree removed");
// the daemon is the sole committer: done folds in the whole task life, exactly one
// create and one done board commit, nothing else; the merged work never touched .kanban
await waitFor(
	() => execSync(`git status --porcelain -- .kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8" }).trim() === "",
	60000,
	"done commit",
	a.output,
	rootA,
);
const boardLog = execSync("git log --format=%s -- .kanban", { cwd: rootA, encoding: "utf8" }).trim().split("\n");
assert.deepEqual(boardLog, [`kanban: done ${taskA.file}`, `kanban: create ${taskA.file}`]); // newest first
const committed = execSync(`git show HEAD:.kanban/${taskA.file}`, { cwd: rootA, encoding: "utf8", shell: "/bin/bash" });
assert.match(committed, /^state: "done"$/m);
assert.match(committed, /^worktree: ""$/m);
a.daemon.kill("SIGTERM");

// --- part B: dead agents get moved forward by the liveness poll, capped at 5 respawns ---
const rootB = fixture();
cleaned.push(rootB);
mkdirSync(kanbanDir(rootB), { recursive: true });
writeFileSync(join(kanbanDir(rootB), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootB), pollMinutes: 0.05 }));
const taskB = createTask(rootB, { name: "fix: dead agent", summary: "Liveness smoke", specs: "n/a" });
setState(rootB, taskB, "to-do");

const b = await runDaemon(rootB);
const readB = () => parseTask(rootB, taskB.file);
await waitFor(() => b.output().includes("giving up"), 60000, "respawn cap", b.output, rootB);
assert.equal(readB().state, "reviewing");
assert.ok(b.output().includes("doing -> to-review"), "poll moved the dead developer forward");
b.daemon.kill("SIGTERM");

// --- part C: the worktree board is a symlink to the shared board, invisible to the worktree's git ---
const rootC = fixture();
cleaned.push(rootC);
mkdirSync(kanbanDir(rootC), { recursive: true });
writeFileSync(join(kanbanDir(rootC), "se-llm-team.json"), JSON.stringify({ agent: devStub(rootC) }));
const taskC = createTask(rootC, { name: "feat: shared board", summary: "Symlink smoke", specs: "n/a" });
setState(rootC, taskC, "to-do");

const c = await runDaemon(rootC);
const wtC = join(rootC, ".worktrees", "feat/shared-board");
const wtBoardC = join(wtC, ".kanban");
await waitFor(
	() => {
		try {
			return lstatSync(wtBoardC).isSymbolicLink();
		} catch {
			return false;
		}
	},
	60000,
	"worktree board symlink",
	c.output,
	rootC,
);
assert.equal(readlinkSync(wtBoardC), kanbanDir(rootC)); // absolute path to the shared board
const tags = execSync("git ls-files -v .kanban", { cwd: wtC, encoding: "utf8" }).trim().split("\n");
assert.ok(tags.length > 0, "stale board entries are tracked in the worktree");
assert.ok(tags.every((l) => l.startsWith("S ")), `expected skip-worktree on all board entries: ${tags.join(", ")}`);
assert.equal(
	execSync("git status --porcelain", { cwd: wtC, encoding: "utf8" }).split("\n").filter((l) => l.includes(".kanban")).length,
	0,
	"worktree git status shows no .kanban entries",
);
// a blanket git add -A cannot stage board changes, and the shared board sees writes through the symlink
const wtTask = join(wtBoardC, taskC.file);
writeFileSync(wtTask, readFileSync(wtTask, "utf8").replace(/^state: .*/m, 'state: "doing"'));
assert.match(readFileSync(join(kanbanDir(rootC), taskC.file), "utf8"), /^state: "doing"$/m);
execSync("git add -A", { cwd: wtC });
assert.equal(
	execSync("git diff --cached --name-only", { cwd: wtC, encoding: "utf8" }).split("\n").filter((l) => l.includes(".kanban")).length,
	0,
	"blanket git add -A staged board changes",
);
c.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness smoke passed");
