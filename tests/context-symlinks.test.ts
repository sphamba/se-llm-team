// fix #234: the cwd context symlinks (AGENTS.md, SPECS.md) must never reach a task branch or
// block the merge lane. Part CS1: the spawn hides both paths in the shared info/exclude
// (fresh project, idempotent). Part CS2: an unwritable exclude never fails the spawn.
// Part CS3: symlinks committed and then deleted (the pre-fix bug) no longer stick the merge
// lane: the rebase self-heals and one strip commit removes the symlink entries from the
// merged branch. Part CS4: a project's own tracked real AGENTS.md survives the merge
// untouched. Part CS5: the developer prompt forbids committing the two paths
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAlive, pidAlive } from "../src/pid.ts";
import { createTask, kanbanDir, parseTask, setState, taskSlug } from "../src/kanban.ts";
import { loadConfig, poll } from "../src/orchestrator.ts";
import { rescan } from "../src/orchestrator/pipeline.ts";
import { ensureWorktree } from "../src/orchestrator/board.ts";
import { clearContextSymlinks, exitFilePath, renderPrompt } from "../src/orchestrator/spawn.ts";

// 000215: drop the neutral config dir so every temp-HOME part stays off the real user config
delete process.env.XDG_CONFIG_HOME;

const cleaned: string[] = [];

// a fresh project: no tracked AGENTS.md or SPECS.md, no ignore entries for them (the bug case)
function freshFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "ctx-sym-"));
	execSync("git init -q", { cwd: root });
	execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
		cwd: root,
		shell: "/bin/bash",
	});
	writeFileSync(join(root, "README.md"), "x\n");
	execSync("git add -A && git commit -qm init", { cwd: root, shell: "/bin/bash" });
	cleaned.push(root);
	return root;
}

const projectConfig = (root: string, agent: string) => {
	mkdirSync(kanbanDir(root), { recursive: true });
	writeFileSync(join(kanbanDir(root), "se-llm-team.json"), JSON.stringify({ agent, pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
};

// stub developer that just finishes (exit 0, no commits): the exclude assertions run against
// the post-spawn worktree state
const plainStub = (root: string) => {
	const stub = join(root, "plain-dev.cjs");
	writeFileSync(stub, "#!/usr/bin/env node\n");
	chmodSync(stub, 0o755);
	return stub;
};

// stub developer doing the pre-fix blanket git add -A, so the cwd context symlinks land in
// the task branch (a fresh project tracks neither and ignores nothing)
const committingStub = (root: string) => {
	const stub = join(root, "committing-dev.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
writeFileSync("code.txt", "work\\n");
try { execSync("git add -A && git commit -qm work", { stdio: "ignore" }); } catch {}
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// the sh wrapper writes <slug>.exit when the stub exits, but stays a live pid until the event
// loop reaps it (a busy spin blocks node's SIGCHLD reaper, leaving a zombie that pidAlive reads
// as alive). Sleep between checks, so the pass that follows processes the run
const waitForExit = async (root: string, slug: string, ms = 15000) => {
	const exit = exitFilePath(root, slug);
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (existsSync(exit) && !agentAlive(root, slug)) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`stub never finished for ${slug}`);
};

const ignored = (cwd: string, name: string): boolean => {
	try {
		execSync(`git check-ignore ${name}`, { cwd, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const contextNoise = (cwd: string): string =>
	execSync("git status --porcelain", { cwd, encoding: "utf8" })
		.split("\n")
		.filter((l) => l.includes("AGENTS.md") || l.includes("SPECS.md"))
		.join("\n");

// a finished-run analysis the poll spawned (spawnRunAnalysis) keeps running detached for up
// to 3x5 s and a final log write would recreate a removed fixture dir: kill every analysis
// process group a .analysis.pid file names before the fixture rm (mirrors orchestrator.test.ts)
const killAnalyses = (root: string) => {
	const pids = join(kanbanDir(root), ".pids");
	let names: string[];
	try {
		names = readdirSync(pids);
	} catch {
		return; // no .pids dir: nothing spawned here
	}
	for (const f of names) {
		if (!f.endsWith(".analysis.pid")) continue;
		const [pidStr, ...rest] = readFileSync(join(pids, f), "utf8").trim().split(/\s+/);
		const pid = parseInt(pidStr, 10);
		const disc = rest.length ? rest.join(" ") : null;
		if (pid > 0 && pid !== process.pid && pidAlive(pid, disc)) {
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				/* group already gone */
			}
		}
		try {
			rmSync(join(pids, f));
		} catch {
			/* already gone */
		}
	}
};

const cleanupAll = (...roots: string[]) =>
	roots.forEach((r) => {
		killAnalyses(r);
		rmSync(r, { recursive: true, force: true });
	});

// --- part CS1: the spawn hides the context paths in the shared info/exclude ---
const root1 = freshFixture();
projectConfig(root1, plainStub(root1));
const task1 = createTask(root1, { name: "feat: hide context paths", summary: "Exclude smoke", specs: "n/a" });
setState(root1, task1, "to-do");
rescan(root1, loadConfig(root1));
const slug1 = taskSlug(task1.file);
await waitForExit(root1, slug1);
const wt1 = join(root1, ".worktrees", parseTask(root1, task1.file).worktree);
assert.ok(existsSync(wt1), "precondition: the worktree exists");
const exclude1 = readFileSync(join(root1, ".git", "info", "exclude"), "utf8").split("\n");
assert.ok(exclude1.includes("AGENTS.md"), "AGENTS.md is in info/exclude after the spawn");
assert.ok(exclude1.includes("SPECS.md"), "SPECS.md is in info/exclude after the spawn");
assert.ok(ignored(wt1, "AGENTS.md") && ignored(wt1, "SPECS.md"), "check-ignore reports both context paths in the worktree");
assert.equal(contextNoise(wt1), "", "no untracked context symlinks in the worktree status");
// idempotent: a second spawn appends no duplicate lines
const task1b = createTask(root1, { name: "feat: hide context paths again", summary: "Exclude smoke two", specs: "n/a" });
setState(root1, task1b, "to-do");
rescan(root1, loadConfig(root1));
const exclude1b = readFileSync(join(root1, ".git", "info", "exclude"), "utf8").split("\n");
assert.equal(exclude1b.filter((l) => l === "AGENTS.md").length, 1, "AGENTS.md appears once in info/exclude");
assert.equal(exclude1b.filter((l) => l === "SPECS.md").length, 1, "SPECS.md appears once in info/exclude");
console.log("context-symlinks.test.ts: part CS1 passed (info/exclude at spawn)");

// --- part CS2: an unwritable info dir never fails the spawn ---
const root2 = freshFixture();
projectConfig(root2, plainStub(root2));
const task2 = createTask(root2, { name: "fix: unwritable exclude", summary: "Exclude failure smoke", specs: "n/a" });
setState(root2, task2, "to-do");
const info2 = join(root2, ".git", "info");
try {
	rmSync(join(info2, "exclude"), { force: true }); // gone before the dir lock: the spawn must create it
	chmodSync(info2, 0o555);
	rescan(root2, loadConfig(root2));
	await waitForExit(root2, taskSlug(task2.file));
	assert.equal(parseTask(root2, task2.file).state, "doing", "the spawn happened despite the unwritable exclude");
} finally {
	chmodSync(info2, 0o755);
}
assert.ok(readFileSync(join(kanbanDir(root2), ".logs", "orchestrator.log"), "utf8").includes("info/exclude"), "the exclusion failure is logged");
console.log("context-symlinks.test.ts: part CS2 passed (unwritable exclude)");

// --- part CS3: symlinks committed and then deleted: the merge lane self-heals ---
const root3 = freshFixture();
projectConfig(root3, plainStub(root3));
const task3 = createTask(root3, { name: "fix: stuck merge", summary: "Merge self-heal smoke", specs: "n/a" });
const ensured3 = ensureWorktree(root3, task3);
assert.ok(ensured3, "precondition: the worktree exists");
const wt3 = ensured3.wtDir;
// the legacy damage: a pre-fix developer committed the context symlinks into the task branch,
// then the orchestrator's clearContextSymlinks deleted them, leaving unstaged deletions
symlinkSync(join(".kanban", "AGENTS.developer.md"), join(wt3, "AGENTS.md"));
symlinkSync(join(".kanban", task3.file), join(wt3, "SPECS.md"));
execSync("git add -f AGENTS.md SPECS.md && git commit -qm 'add context symlinks'", { cwd: wt3, shell: "/bin/bash" });
clearContextSymlinks(root3, { ...task3, worktree: ensured3.wt });
assert.ok(contextNoise(wt3).includes("AGENTS.md"), "precondition: the committed symlink deletion sits unstaged");
setState(root3, task3, "to-merge");
rescan(root3, loadConfig(root3));
assert.equal(parseTask(root3, task3.file).state, "to-live-test", "the merge lane completes past the deleted committed symlinks");
assert.equal(execSync("git ls-tree HEAD -- AGENTS.md SPECS.md", { cwd: root3, encoding: "utf8" }).trim(), "", "the merged branch carries no context symlinks");
assert.deepEqual(
	execSync("git log --format=%s HEAD", { cwd: root3, encoding: "utf8" }).trim().split("\n"),
	["chore: remove task context symlinks committed by mistake", "add context symlinks", "init"],
	"one strip commit removes the symlinks from the merged branch",
);
assert.ok(!existsSync(join(root3, "AGENTS.md")) && !existsSync(join(root3, "SPECS.md")), "the strip commit removed the symlinks from the root checkout too");
console.log("context-symlinks.test.ts: part CS3 passed (merge self-heal)");

// --- part CS4: a project's own tracked real AGENTS.md survives the merge untouched ---
const root4 = freshFixture();
writeFileSync(join(root4, "AGENTS.md"), "# project rules\n");
execSync("git add -A && git commit -qm rules", { cwd: root4, shell: "/bin/bash" });
projectConfig(root4, committingStub(root4));
const task4 = createTask(root4, { name: "fix: keep real agents md", summary: "Real file survives", specs: "n/a" });
const ensured4 = ensureWorktree(root4, task4);
assert.ok(ensured4, "precondition: the worktree exists");
const wt4 = ensured4.wtDir;
setState(root4, task4, "to-do");
rescan(root4, loadConfig(root4));
const slug4 = taskSlug(task4.file);
await waitForExit(root4, slug4);
assert.equal(readlinkSync(join(wt4, "AGENTS.md")), join(".kanban", "AGENTS.developer.md"), "the spawn replaced the tracked AGENTS.md with the role-notes symlink");
poll(root4, 0.01);
assert.equal(parseTask(root4, task4.file).state, "to-review", "the developer run moved to to-review");
setState(root4, task4, "to-merge");
rescan(root4, loadConfig(root4));
assert.equal(parseTask(root4, task4.file).state, "to-live-test", "the merge completes with the tracked real AGENTS.md");
assert.deepEqual(execSync("git diff --name-only HEAD~1 HEAD", { cwd: root4, encoding: "utf8" }).trim().split("\n"), ["code.txt"], "the blanket add committed no context paths next to the tracked real file");
assert.equal(readFileSync(join(root4, "AGENTS.md"), "utf8"), "# project rules\n", "the real AGENTS.md content survives at the root");
assert.ok(lstatSync(join(root4, "AGENTS.md")).isFile(), "the root AGENTS.md is a real file, not a symlink");
assert.match(execSync("git ls-tree HEAD -- AGENTS.md", { cwd: root4, encoding: "utf8" }), /^100644 /, "HEAD still tracks AGENTS.md as a real file");
assert.ok(lstatSync(join(wt4, "AGENTS.md")).isFile(), "the worktree AGENTS.md is restored to a real file after the merge");
assert.deepEqual(execSync("git log --format=%s HEAD", { cwd: root4, encoding: "utf8" }).trim().split("\n"), ["work", "rules", "init"], "main history stays linear with no strip commit");
assert.ok(!readFileSync(join(kanbanDir(root4), ".logs", "orchestrator.log"), "utf8").includes("chore: remove task context symlinks"), "no strip commit for a real tracked file");
console.log("context-symlinks.test.ts: part CS4 passed (real AGENTS.md survives)");

// --- part CS5: the developer prompt forbids committing the context symlinks ---
const devPrompt = renderPrompt(root1, "developer");
assert.ok(devPrompt.includes("Never commit AGENTS.md or SPECS.md"), "the developer prompt forbids committing the context symlinks");
assert.ok(devPrompt.includes("Work only here, in the worktree you run in"), "the prompt-scope rule stays");
console.log("context-symlinks.test.ts: part CS5 passed (developer prompt)");

cleanupAll(...cleaned);
console.log("context-symlinks.test.ts: all parts passed (spawn exclude + unwritable exclude + merge self-heal + real AGENTS.md survives + developer prompt)");
