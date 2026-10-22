import assert from "node:assert/strict";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kanbanDir } from "../src/kanban.ts";
import { killTree, pidAlive } from "../src/pid.ts";
import { spawnRunAnalysis } from "../src/orchestrator/spawn.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));


export function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "orch-smoke-"));
	execSync("git init -q", { cwd: root });
	execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
		cwd: root,
		shell: "/bin/bash",
	});
	writeFileSync(join(root, "README.md"), "x\n");
	// mirrors the repo .gitignore: the worktrees share it, so the cwd context symlinks are
	// never staged or committed by an agent's blanket git add -A
	writeFileSync(join(root, ".gitignore"), "AGENTS.md\nSPECS.md\n");
	execSync("git add -A && git commit -qm init", { cwd: root, shell: "/bin/bash" });
	return root;
}

// subjects of the board mirror branch; "" before the first mirror commit (or without git);
// stderr piped so the not-yet-existing-ref fatal stays out of the test output
export const mirrorSubjects = (root: string) => {
	try {
		return execSync("git log --format=%s refs/heads/meta/kanban", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "";
	}
};

// a file's content at the mirror tip; null when the tip lacks it (or git fails)
export const showTip = (root: string, file: string): string | null => {
	try {
		return execSync(`git show refs/heads/meta/kanban:.kanban/${file}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: "/bin/bash" });
	} catch {
		return null;
	}
};

// stub agent: parses its role out of the prompt and the task from the cwd SPECS.md symlink,
// then acts per the new contract: the developer commits a code change and finishes (the
// orchestrator moves the state on the exit 0), the reviewer writes to-merge itself, the
// live-tester just finishes, and the merger only resolves the conflict the orchestrator's
// stopped rebase left in its worktree; the blanket git add -A in the worktree proves board
// changes cannot be staged
export const roleStub = (root: string) => {
	const stub = join(root, "stub-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, readlinkSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
// the task comes from the cwd SPECS.md symlink, which the orchestrator re-points at spawn
const file = "SPECS.md";
let front = "";
try { front = readFileSync(file, "utf8"); } catch {}
if (!front.match(/^state: /m)) process.exit(0);
if (prompt.includes("Splitter agent")) {
	// splitter behavior is selected by a marker in the task content: no marker is a silent
	// no-split, so the shared parts that spawn the splitter stay unaffected
	const num = parseInt(readlinkSync("SPECS.md").split("/").pop() ?? "", 10) || 0;
	const priority = (front.match(/^priority: .*/m) ?? [])[0] ?? 'priority: "medium"';
	if (front.includes("splitter-crash")) process.exit(1);
	if (front.includes("splitter-linger")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
	if (front.includes("splitter-split")) {
		const sub = (n) => '---\\nname: "feat: piece ' + n + '"\\n' + priority + '\\nstate: "to-do"\\nworktree: ""\\nissuer: "#' + num + '"\\ncomplexity: "simple"\\n---\\n\\n# Summary\\nPiece ' + n + ' of the split.\\n\\n# Specs\\nn/a\\n\\n# Notes\\n';
		writeFileSync(".kanban/999001_piece_one.md", sub("one"));
		writeFileSync(".kanban/999002_piece_two.md", sub("two"));
		const parent = front.replace(/^state: .*/m, 'state: "backlog"').replace(/^complexity: .*/m, 'complexity: "simple"').replace(/\\n---\\n/, '\\nblockedBy: "#999001, #999002"\\n---\\n');
		writeFileSync("SPECS.md", parent);
	}
	process.exit(0);
}
if (prompt.includes("Developer agent")) {
	// emit JSONL only when spawned with --mode json, print-mode final text otherwise, so the
	// developer-log assertion below actually verifies the orchestrator's spawn args
	const m = process.argv.indexOf("--mode");
	if (m !== -1 && process.argv[m + 1] === "json") {
		process.stdout.write(JSON.stringify({ type: "session", version: 3, id: "s", timestamp: 0, cwd: process.cwd() }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "system", content: "", sections: { preamble: "the system prompt" } } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_update", usage: { input: 0, output: 1 }, assistantMessageEvent: { type: "text_delta", delta: "working" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "git status" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_start", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result echo" }] } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "toolResult", toolCallId: "t1", toolName: "bash", content: [{ type: "text", text: "result echo" }] } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: "work" } }) + "\\n");
		process.stdout.write(JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: "full replay" }], willRetry: false }) + "\\n");
		process.stderr.write("stub stderr diagnostic: not json\\n");
	} else {
		process.stdout.write("final text only\\n");
	}
	// one file per task: two branches that add the same path hit add/add conflicts or a commit
	// dropped as already-applied in the merge lane
	const workFile = readlinkSync("SPECS.md").split("/").pop().replace(/\\.md$/, "") + ".txt";
	writeFileSync(workFile, "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
if (prompt.includes("Merger agent")) {
	// the orchestrator left the rebase stopped in the merger's cwd (the task worktree): the
	// merger resolves with the base branch's side (--ours in a rebase) and continues the
	// replay, the orchestrator owns the state moves
	execSync("git checkout --ours README.md && git add -A && GIT_EDITOR=true git rebase --continue", { stdio: "ignore" });
	process.exit(0);
}
// only the reviewer sets a state itself (to-merge on approval); the developer and the
// live-tester just finish and the orchestrator moves the task on their exit 0
if (prompt.includes("Reviewer agent")) writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-merge"));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// stub agent that records every spawn (role, argv, task) and acts per the new contract: the
// developer commits so the merge is real, the merger resolves the conflict left in its
// worktree cwd, only the reviewer writes state, the live-tester just finishes
export const argvStub = (root: string) => {
	const stub = join(root, "argv-agent.cjs");
	writeFileSync(
		stub,
		`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const role = prompt.includes("Merger agent") ? "merger"
	: prompt.includes("Developer agent") ? "developer"
	: prompt.includes("Reviewer agent") ? "reviewer"
	: prompt.includes("Live-tester") ? "live-tester"
	: prompt.includes("Integration-tester") ? "integration-tester" : "";
// the task comes from the cwd SPECS.md symlink: the prompt carries no absolute paths, so
// spawns are attributed by the task name read from the task file
const file = "SPECS.md";
let front = "";
try { front = readFileSync(file, "utf8"); } catch {}
const task = (front.match(/^name: "(.*)"$/m) ?? [])[1] ?? "";
appendFileSync(${JSON.stringify(join(root, "argv.log"))}, JSON.stringify({ role, argv: process.argv, task }) + "\\n");
if (!front.match(/^state: /m)) process.exit(0);
if (role === "developer") {
	writeFileSync("code.txt", "work\\n");
	execSync("git add -A && git commit -qm work", { stdio: "ignore" });
}
if (role === "merger") {
	// the orchestrator left the rebase stopped in the merger's cwd (the task worktree): the
	// merger resolves with the base branch's side (--ours in a rebase) and continues the replay
	execSync("git checkout --ours README.md && git add -A && GIT_EDITOR=true git rebase --continue", { stdio: "ignore" });
}
// only the reviewer sets a state itself (to-merge on approval); the developer and the
// live-tester just finish and the orchestrator moves the task on their exit 0
if (role === "reviewer") writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, "state: to-merge"));
`,
	);
	chmodSync(stub, 0o755);
	return stub;
};

// the llm flags sit between "--mode json" and "-p", in resolution order provider, model, thinking
export const llmArgs = (argv: string[]) => argv.slice(argv.indexOf("--mode") + 2, argv.indexOf("-p"));

// stub agent that always dies with a non-zero exit: an exit 0 would read as a successful
// finish under the exit-file scheme, so a dying stub must exit non-zero
export const deadStub = (root: string) => {
	const stub = join(root, "dead-agent.cjs");
	writeFileSync(stub, `#!/usr/bin/env node\nprocess.exit(1);\n`);
	chmodSync(stub, 0o755);
	return stub;
};

export async function runDaemon(root: string, script = join(HERE, "../src/orchestrator.ts"), home?: string) {
	const daemon = spawn(
		process.execPath,
		[script, "--root", root, "--rescan-seconds", "1", "--poll-minutes", "0.01"],
		{ stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SE_LLM_TEAM_NO_WEBUI: "1", ...(home ? { HOME: home } : {}) } },
	);
	daemons.push({ daemon, root });
	let out = "";
	daemon.stdout.on("data", (d) => (out += d));
	daemon.stderr.on("data", (d) => (out += d));
	daemon.on("exit", (code, sig) => (out += `\n[daemon exit ${code} ${sig}]`));
	daemon.on("error", (e) => (out += `\n[daemon error ${e.message}]`));
	return { daemon, output: () => out };
}

export const waitFor = async (cond: () => boolean, ms: number, what: string, out: () => string) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (cond()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	console.error(`timeout waiting for ${what}; daemon output (live):
${out()}`);
	killAll();
	process.exit(1);
};

// async variant of waitFor for fetch-based conditions
export const waitForAsync = async (cond: () => Promise<boolean>, ms: number, what: string) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await cond()) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	console.error(`timeout waiting for ${what}`);
	killAll();
	process.exit(1);
};

export const freePort = async (): Promise<number> => {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((r) => server.close(r));
	return port;
};

// the sweep may have gzipped a finished run; count the run indexes, either file form
export const runIdx = (root: string, base: string) =>
	readdirSync(join(kanbanDir(root), ".logs"))
		.filter((f) => f.startsWith(`${base}.`))
		.map((f) => f.slice(base.length + 1).match(/^(\d+)\.log(?:\.gz)?$/)?.[1])
		.filter(Boolean)
		.sort();

export const cleaned: string[] = [];

// a finished-run analysis the orchestrator spawned (spawnRunAnalysis) keeps running detached
// for ~30 s (3 retries x 5 s when the agent produces no answer) and its final log(root, ...)
// would recreate a removed fixture dir and break later tests: before every fixture rm, kill
// every analysis process group a .analysis.pid file names (detached spawns lead their own
// process group, so -pid takes the sh wrapper and the node runner together), then drop the
// pid files. The pid file's discriminator guards against a recycled pid
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
		let body: string;
		try {
			body = readFileSync(join(pids, f), "utf8");
		} catch {
			continue; // the analysis exited and dropped its pid file between readdir and read
		}
		const [pidStr, ...rest] = body.trim().split(/\s+/);
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

export const cleanupAll = (...roots: string[]) =>
	roots.forEach((r) => {
		killAnalyses(r);
		rmSync(r, { recursive: true, force: true });
	});

export const daemons: { daemon: ChildProcess; root: string }[] = [];

// agents the daemons spawned run detached, so the test learns their pids from the daemon's pidfiles;
// the cmdline guard keeps a recycled pid from getting an unrelated process killed
const agentPids = (root: string): number[] => {
	try {
		return readdirSync(join(kanbanDir(root), ".pids")).flatMap((f) => {
			const pid = parseInt(readFileSync(join(kanbanDir(root), ".pids", f), "utf8").trim(), 10);
			try {
				return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root) ? [pid] : [];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
};

// safety net for failure and interruption paths: SIGKILL the daemons (the happy path already sent
// SIGTERM), then kill every agent they spawned from the pidfiles
export const killAll = () => {
	for (const { daemon, root } of daemons) {
		daemon.kill("SIGKILL");
		for (const pid of agentPids(root)) {
			try {
				// the pid names the sh wrapper, a process-group leader: a single-pid kill would
				// orphan the real agent, which would keep running and logging
				killTree(pid, "SIGKILL");
			} catch {
				/* agent already gone */
			}
		}
		try {
			// the lock pid names the daemon itself, but a hand-written or stale lock can still
			// name a process the daemon kill above does not cover
			const lock = parseInt(readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim(), 10);
			if (lock > 0) killTree(lock, "SIGKILL");
		} catch {
			/* no lock */
		}
	}
};

process.on("exit", () => {
	killAll();
	cleanupAll(...cleaned);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		killAll();
		cleanupAll(...cleaned);
		process.exit(sig === "SIGINT" ? 130 : 143);
	});
}
