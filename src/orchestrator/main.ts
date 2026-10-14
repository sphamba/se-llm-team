import { mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { kanbanDir, listAll, splitWorktreeRoot } from "../kanban.ts";
import { joinHub } from "../hub.ts";
import { pidAlive } from "../pid.ts";
import { loadWebUiConfig } from "../webui.ts";
import { loadConfig, parseArgs } from "./config.ts";
import { bootstrapBoard, killPushes } from "./board.ts";
import { compactFinishedLogs, log } from "./log.ts";
import { rescan } from "./pipeline.ts";
import { poll } from "./liveness.ts";

function acquireLock(root: string): boolean {
	const lock = join(kanbanDir(root), ".orchestrator.lock");
	mkdirSync(kanbanDir(root), { recursive: true });
	try {
		writeFileSync(lock, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		let other = 0;
		try {
			other = parseInt(readFileSync(lock, "utf8").trim(), 10);
		} catch {
			return false; // lock vanished since the wx attempt: a rival holds or released it, stay out
		}
		if (pidAlive(other)) return false;
		rmSync(lock);
		return acquireLock(root);
	}
}

function releaseLock(root: string): void {
	const lock = join(kanbanDir(root), ".orchestrator.lock");
	try {
		if (parseInt(readFileSync(lock, "utf8").trim(), 10) === process.pid) rmSync(lock);
	} catch {
		/* not ours */
	}
}

function holdsLock(root: string): boolean {
	try {
		return readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim() === String(process.pid);
	} catch {
		return false;
	}
}

// 000165: a task worktree daemon reaps itself when its owner task is done or gone, so no stale
// daemon lingers to hold the lock or contest the hub port. The check reads the main root's
// board: the worktree's own .kanban can be gone with the worktree.
function worktreeTaskEnded([mainRoot, wtName]: [string, string]): boolean {
	if (!wtName) return false;
	const owner = listAll(mainRoot).find((t) => t.worktree === wtName);
	return !owner || owner.state === "done";
}
export function main(argv: string[]): void {
	const args = parseArgs(argv);
	if (!args.root) {
		process.stderr.write("usage: node orchestrator.ts --root <project-dir> [--rescan-seconds <s>] [--poll-minutes <m>] [--no-webui] [--compact-logs]\n");
		process.exitCode = 1;
		return;
	}
	const root = args.root;
	if (args.compactLogs) {
		const r = compactFinishedLogs(root);
		const summary = `retro-compacted ${r.files} agent log(s): ${r.before} -> ${r.after} bytes`;
		log(root, summary);
		process.stdout.write(summary + "\n");
		return;
	}
	const worktreeSplit = splitWorktreeRoot(root);
	// 000165 self-reap: checked at startup and on every sweep, before acquireLock and the lock
	// self-heal, which would recreate a removed worktree's board dirs. stdout only: the worktree
	// may already be removed, and a log(root, ...) write would recreate its dirs.
	const reapIfTaskEnded = () => {
		if (!worktreeSplit || !worktreeTaskEnded(worktreeSplit)) return;
		process.stdout.write(`[${new Date().toISOString()}] task worktree daemon reaped: task done or gone (${root})\n`);
		process.exit(0);
	};
	reapIfTaskEnded();
	const cfg = loadConfig(root);
	const pollMinutes = args.pollMinutes ?? cfg.pollMinutes;
	const rescanSeconds = args.rescanSeconds ?? 10;
	if (!acquireLock(root)) {
		log(root, "another orchestrator already runs for this project, exiting");
		return;
	}
	for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
	log(root, `orchestrator started (root=${root}, agent=${cfg.agent}, poll=${pollMinutes}min, rescan=${rescanSeconds}s)`);
	bootstrapBoard(root);

	const sweep = () => {
		reapIfTaskEnded();
		// lock self-heal: an external cleanup or an acquire race can drop the lock mid-life;
		// without this the daemon runs lockless forever and status/stop report "not running"
		if (!holdsLock(root)) {
			if (acquireLock(root)) log(root, "orchestrator lock was missing, re-acquired");
			else {
				log(root, "another orchestrator already runs for this project, exiting");
				process.exit(0);
			}
		}
		rescan(root, cfg);
	};
	let scheduled: NodeJS.Timeout | undefined;
	const scheduleSweep = () => {
		clearTimeout(scheduled);
		scheduled = setTimeout(sweep, 500);
	};
	const stop = () => {
		clearInterval(scheduled);
		clearInterval(timer);
		clearInterval(poller);
		releaseLock(root);
		log(root, "orchestrator stopped");
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	process.on("exit", () => {
		releaseLock(root);
		killPushes();
	});

	sweep();
	poll(root, cfg.logStallMinutes, Date.now(), cfg.backlogIdleMinutes);
	const timer = setInterval(sweep, rescanSeconds * 1000);
	const poller = setInterval(() => poll(root, cfg.logStallMinutes, Date.now(), cfg.backlogIdleMinutes), pollMinutes * 60 * 1000);
	try {
		const w = watch(kanbanDir(root), scheduleSweep);
		w.on("error", (err) => log(root, `fs.watch error, polling only: ${err instanceof Error ? err.message : err}`));
		process.on("exit", () => w.close());
	} catch (err) {
		log(root, `fs.watch unavailable, polling only: ${err instanceof Error ? err.message : err}`);
	}
	// smoke runs read the same global config as production, so without this they bind the
	// production webui port and steal the real UI
	const noWebUi = args.noWebui || ["1", "true"].includes((process.env.SE_LLM_TEAM_NO_WEBUI ?? "").toLowerCase());
	const webUi = loadWebUiConfig(root);
	if (webUi.enabled && noWebUi) {
		log(root, "web ui disabled (no-webui)");
	} else if (webUi.enabled) {
		// the elected hub daemon serves every registered board on the webUi port; non-hub
		// daemons register with it and serve nothing (one port, one ui)
		joinHub({ name: basename(root), root, host: webUi.host, port: webUi.port, log: (message) => log(root, message) });
	}
}
