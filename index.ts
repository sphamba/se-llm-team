import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyseLog } from "./src/efficiency-analysis.ts";
import { createTask, getTask, isLinkedWorktree, kanbanDir, listAll, listTasks, resolveTaskFromCwd, setState, setWorktree, taskNum, updateTask, STATES, type TaskState } from "./src/kanban.ts";
import { orchestratorWatched, pidAlive, procPgrp } from "./src/pid.ts";
import { removeTask } from "./src/orchestrator.ts";
import { loadConfig, llmFlags } from "./src/orchestrator/config.ts";
import { REPORT_MAX_AGE_MS, reportsDir } from "./src/orchestrator/report.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: undefined };
}

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const board = (ctx: ExtensionContext) => kanbanDir(ctx.cwd);
	const daemonLog = (root: string) => join(kanbanDir(root), ".logs", "orchestrator.log");
	const notified = new Set<string>();
	// the task from the file parameter, or from the cwd SPECS.md symlink (a role agent session
	// in its worktree) when omitted
	const resolveTask = (ctx: ExtensionContext, file?: string) => (file ? getTask(ctx.cwd, file) : resolveTaskFromCwd(ctx.cwd));
	const NO_TASK = "no task; pass the file name or run from a worktree with SPECS.md";

	pi.registerTool({
		name: "kanban_list",
		exposure: "deferred",
		label: "Kanban list",
		description:
			"List kanban tasks of this project. scope=backlog: tasks to prioritize. scope=in-progress: tasks being worked on. scope=done: completed tasks. Optional priority filter (low/medium/high/critical). Returns file, num (#NN), name, priority, state, issuer, summary, openQuestions (the task body's # Open questions section, empty when none), complexity and blockedBy (comma-joined blocker task refs like \"#42, #43\", empty when none) per task.",
		parameters: Type.Object({
			scope: StringEnum(["backlog", "in-progress", "done"] as const),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const refs = listTasks(ctx.cwd, params.scope, params.priority);
			return {
				content: [{ type: "text", text: JSON.stringify(refs, null, 2) }],
				details: refs,
			};
		},
	});

	pi.registerTool({
		name: "kanban_get",
		exposure: "deferred",
		label: "Kanban get",
		description: "Read one kanban task in full detail (state, worktree, issuer, complexity, blockedBy, summary, specs, notes, openQuestions). openQuestions is the task body's # Open questions section, empty when none. file is optional; resolved from the cwd SPECS.md symlink when omitted.",
		parameters: Type.Object({ file: Type.Optional(Type.String({ description: "Task file name, e.g. 000001_nice_thing.md. Optional: resolved from the cwd SPECS.md symlink when omitted" })) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = resolveTask(ctx, params.file);
			return {
				content: [{ type: "text", text: task ? JSON.stringify(task, null, 2) : params.file ? `No task ${params.file}` : NO_TASK }],
				details: task ?? undefined,
			};
		},
	});

	pi.registerTool({
		name: "kanban_create",
		exposure: "deferred",
		label: "Kanban create",
		description:
			"Create a kanban task in state backlog. Name tasks with a type prefix like 'feat: ', 'fix: ', 'perf: '. Write the specs with the user. Set issuer to '#<num>' when the task was created after live-testing of task #<num>; the default 'user' means the user requested it. The issuer is set at creation only and never changed afterwards. Set complexity to trivial, simple, moderate (default) or complex; it drives which per-complexity LLM config entry and reviewer-pass cap apply (trivial gets no reviewer pass). Complexity stays updatable later via kanban_update.",
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false create
		parameters: Type.Object({
			name: Type.String({ description: "Task name with type prefix, e.g. 'feat: nice thing'" }),
			shortName: Type.Optional(Type.String({ description: "Max 5 lowercase words joined by hyphens, e.g. 'this-is-a-short-name'; names the task file and the branch/worktree. Set at creation only, never updatable" })),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			complexity: Type.Optional(StringEnum(["trivial", "simple", "moderate", "complex"] as const)),
			issuer: Type.Optional(Type.String({ description: "'user' (default) or '#<num>' when created after live-testing of task #<num>, e.g. '#42'" })),
			summary: Type.String({ description: "Concise goal, one to three sentences" }),
			specs: Type.Optional(Type.String({ description: "Detailed description of needs" })),
			openQuestions: Type.Optional(Type.String({ description: "User/client clarification questions, written to the task body's # Open questions section" })),
			blockedBy: Type.Optional(Type.String({ description: "Comma-joined blocker task refs, e.g. '#42, #43'; the task waits for them" })),
		}, { additionalProperties: false }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = createTask(ctx.cwd, params);
			return {
				content: [{ type: "text", text: `Created ${task.file} (#${taskNum(task.file)})` }],
				details: task,
			};
		},
	});

	pi.registerTool({
		name: "kanban_update",
		exposure: "deferred",
		label: "Kanban update",
		description:
			"Update an existing task. Use this instead of creating a duplicate when a not-done task already covers the same need. Omitted fields stay unchanged. file is optional; resolved from the cwd SPECS.md symlink when omitted.",
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false update
		parameters: Type.Object({
			file: Type.Optional(Type.String({ description: "Task file name. Optional: resolved from the cwd SPECS.md symlink when omitted" })),
			name: Type.Optional(Type.String()),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			complexity: Type.Optional(StringEnum(["trivial", "simple", "moderate", "complex"] as const)),
			summary: Type.Optional(Type.String({ description: "Replaces the whole Summary section" })),
			specs: Type.Optional(Type.String({ description: "Replaces the whole Specs section" })),
			openQuestions: Type.Optional(Type.String({ description: "User/client clarification questions, written to the task body's # Open questions section" })),
			blockedBy: Type.Optional(Type.String({ description: "Comma-joined blocker task refs, e.g. '#42, #43'; replaces the whole list, empty string clears it" })),
		}, { additionalProperties: false }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = params.file ? getTask(ctx.cwd, params.file) : resolveTaskFromCwd(ctx.cwd);
			if (!task) return text(params.file ? `No task ${params.file}` : NO_TASK);
			const hasField = Object.entries(params).some(([k, v]) => k !== "file" && v !== undefined);
			if (!hasField) return text(`Nothing to update in ${task.file}`);
			updateTask(ctx.cwd, task, params);
			return text(`Updated ${task.file} (#${taskNum(task.file)})`);
		},
	});

	pi.registerTool({
		name: "kanban_set_state",
		exposure: "deferred",
		label: "Kanban set state",
		description: `Move a task to a new state. States: ${STATES.join(", ")}. file is optional; resolved from the cwd SPECS.md symlink when omitted.`,
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false success
		parameters: Type.Object({
			file: Type.Optional(Type.String({ description: "Task file name. Optional: resolved from the cwd SPECS.md symlink when omitted" })),
			state: StringEnum([...STATES] as unknown as [string, ...string[]]),
		}, { additionalProperties: false }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = resolveTask(ctx, params.file);
			if (!task) return text(params.file ? `No task ${params.file}` : NO_TASK);
			setState(ctx.cwd, task, params.state as TaskState);
			return text(`${task.file} (#${taskNum(task.file)}): state -> ${params.state}`);
		},
	});

	pi.registerTool({
		name: "kanban_set_worktree",
		exposure: "deferred",
		label: "Kanban set worktree",
		description: "Set or clear (empty string) the worktree attribute of a task.",
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false success
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			worktree: Type.String({ description: "Worktree name under .worktrees/, e.g. feat/1-nice-thing" }),
		}, { additionalProperties: false }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			if (!task) return text(`No task ${params.file}`);
			setWorktree(ctx.cwd, task, params.worktree);
			return text(`${task.file} (#${taskNum(task.file)}): worktree -> ${params.worktree}`);
		},
	});

	pi.registerTool({
		name: "kanban_delete",
		exposure: "deferred",
		label: "Kanban delete",
		description:
			"Remove a task from the board. Deletes the task file and commits a whole-board mirror snapshot in one operation, so the daemon cannot restore the task. Use for a mistaken or duplicate task. The worktree and branch of a started task are not removed.",
		parameters: Type.Object({ file: Type.String({ description: "Task file name, e.g. 000001_nice_thing.md" }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const error = await removeTask(ctx.cwd, params.file);
			if (error) return text(error);
			return text(`Deleted ${params.file}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_start",
		exposure: "deferred",
		label: "Orchestrator start",
		description:
			"Start the se-llm-team orchestrator daemon for this project. It watches .kanban/, spawns Developer agents for to-do tasks, Reviewer agents for to-review tasks, one Merger agent for to-merge tasks, and Live-tester agents for to-live-test tasks on the merged commit, and polls agent liveness. Pipeline order: review -> merge -> live-test. When webUi.enabled is set in ~/.pi/agent/se-llm-team.json it also starts an in-process web dashboard for the board. Exits early if it already runs for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const root = resolveRoot(ctx.cwd);
			if (!root) return text("Not a git repository: agents cannot run without git (worktrees, branches, board commits). No orchestrator started.");
			const pid = readPid(root);
			if (pid && pidAlive(pid)) {
				// 000195: a daemon spawned by a stale session (pre-000192 extension code) has no
				// --watch supervisor, so a src change never restarts it. null (non-Linux /proc,
				// or a lock pid that is no daemon) stays silent
				return orchestratorWatched(pid) === false
					? text(`Orchestrator already running (pid ${pid}) without a node --watch supervisor: a merge that changes src/ will not restart it. Stop the orchestrator, then start it again to restore the self-restart.`)
					: text(`Orchestrator already running (pid ${pid})`);
			}
			let log: number;
			try {
				for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
				log = openSync(daemonLog(root), "a");
			} catch (err) {
				return text(`Cannot start the orchestrator: ${(err as Error).message}`);
			}
			// node --watch restarts the daemon whenever its module graph changes, so a merge
			// that changes the orchestrator takes effect without a manual stop and start (000192)
			const child = spawn(process.execPath, ["--watch", join(extDir, "src", "orchestrator.ts"), "--root", root], {
				detached: true,
				stdio: ["ignore", log, log],
			});
			child.on("error", (err) => ctx.ui.notify(`orchestrator failed to start: ${err.message}`, "error"));
			closeSync(log);
			child.unref();
			return text(`Orchestrator starting (pid ${child.pid}), log: ${daemonLog(root)}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_status",
		exposure: "deferred",
		label: "Orchestrator status",
		description: "Report whether the orchestrator daemon runs for this project and give kanban state counts.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const root = resolveRoot(ctx.cwd) ?? ctx.cwd;
			const counts: Record<string, number> = {};
			for (const t of listAll(root)) counts[t.state] = (counts[t.state] ?? 0) + 1;
			const pid = readPid(root);
			const running = pid !== null && pidAlive(pid);
			return text(`${running ? `running (pid ${pid})` : "not running"}; board: ${JSON.stringify(counts)}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_poke",
		exposure: "deferred",
		label: "Orchestrator poke",
		description: "Poke the se-llm-team orchestrator daemon to trigger an immediate scan and agent scheduling.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const root = resolveRoot(ctx.cwd) ?? ctx.cwd;
			try {
				// rm+create so every poke fires a fs.watch event; a bare open("a") on an
				// existing file writes nothing and Linux inotify reports no event for it.
				const poke = join(kanbanDir(root), ".poke");
				try { unlinkSync(poke); } catch { /* first poke */ }
				closeSync(openSync(poke, "a"));
			} catch {
				/* no board yet */
			}
			const pid = readPid(root);
			if (pid === null || !pidAlive(pid)) return text("No orchestrator daemon running for this project.");
			return text(`Poked the orchestrator (pid ${pid}). Scan starts within a second.`);
		},
	});

	pi.registerTool({
		name: "orchestrator_stop",
		exposure: "deferred",
		label: "Orchestrator stop",
		description: "Stop the orchestrator daemon for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const pid = readPid(resolveRoot(ctx.cwd) ?? ctx.cwd);
			if (!pid || !pidAlive(pid)) return text("Orchestrator not running");
			try {
				// under node --watch the supervisor shares the daemon's process group: a bare pid
				// kill would leave it to resurrect the daemon on the next watched change, so
				// signal the group when it is not our own group (a test victim shares it)
				const pgrp = procPgrp(pid);
				if (pgrp && pgrp !== procPgrp(process.pid)) process.kill(-Number(pgrp), "SIGTERM");
				else process.kill(pid, "SIGTERM");
			} catch {
				return text("Orchestrator not running");
			}
			return text(`Sent SIGTERM to orchestrator pid ${pid}`);
		},
	});

	pi.registerTool({
		name: "efficiency_analysis",
		exposure: "deferred",
		label: "Efficiency analysis",
		description:
			"Analyse one agent log of this project and report pain points. The tool parses the JSONL log, summarizes each assistant block with a headless analyser, and writes a markdown report next to the log as <name minus the .log or .log.gz suffix>.analysis.md. Returns the final analysis inline with the report path and the block count.",
		parameters: Type.Object({
			path: Type.String({ description: "Log file path, absolute or relative to the cwd, .log or .log.gz" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const root = ctx.cwd;
			const absolutePath = resolve(root, params.path);
			const cfg = loadConfig(root);
			// the role default applies, no complexity override. The in-flight cap comes from the
			// role config, the module default of 8 applies when unset
			const flags = llmFlags(root, cfg, "analyser", "");
			try {
				const result = await analyseLog(absolutePath, { agent: cfg.agent, llmFlags: flags, concurrency: cfg.roles.analyser?.concurrency });
				return {
					content: [{ type: "text", text: `${result.analysis}\n\nReport: ${result.reportPath}\nBlocks analysed: ${result.blockCount}` }],
					details: result,
				};
			} catch (err) {
				return text(`Cannot analyse ${absolutePath}: ${(err as Error).message}`);
			}
		},
	});

	// progress notifications for the PM session: tell the user when a task reaches done.
	// Attached lazily (the board may only be created later in the session) and seeded with
	// tasks already done, so only done-transitions after the attach notify.
	let boardWatcher: FSWatcher | undefined;
	const ensureBoardWatcher = (ctx: ExtensionContext) => {
		if (boardWatcher || !existsSync(board(ctx))) return;
		try {
			for (const t of listAll(ctx.cwd)) if (t.state === "done") notified.add(t.file);
			boardWatcher = watch(board(ctx), () => {
				for (const t of listAll(ctx.cwd)) {
					if (t.state !== "done" || notified.has(t.file)) continue;
					notified.add(t.file);
					if (ctx.hasUI) ctx.ui.notify(`Kanban: ${t.name} is done`, "info");
				}
			});
		} catch {
			/* no board watching in this session */
		}
	};
	// PM report delivery: the orchestrator queues one report per done sweep in .kanban/.reports/.
	// Every session watches the queue (same lifecycle as the board watcher); only the session at
	// the repo root consumes it: a worktree session shares the board through the .kanban symlink,
	// so the gate is the git-topology check of the hub candidacy rule. Consumption claims the
	// oldest report by rename, sends it to the PM chat and deletes it: a second root session
	// loses the rename and never double-sends
	const canDeliver = (ctx: ExtensionContext) => ctx.hasUI && !isLinkedWorktree(ctx.cwd);
	const deliverReport = (ctx: ExtensionContext, dir: string, file: string): boolean => {
		const claim = join(dir, `${file}.claiming`);
		try {
			renameSync(join(dir, file), claim);
		} catch {
			return false; // another root session claimed it first
		}
		try {
			pi.sendMessage({ customType: "board-report", content: readFileSync(claim, "utf8"), display: true }, ctx.isIdle() ? { triggerTurn: true } : { deliverAs: "followUp" });
		} catch {
			/* a vanished claim (prune race) must not crash the session */
		} finally {
			rmSync(claim, { force: true });
		}
		return true;
	};
	const consumeReports = (ctx: ExtensionContext) => {
		if (!canDeliver(ctx)) return;
		const dir = reportsDir(ctx.cwd);
		for (;;) {
			let oldest: string | undefined;
			try {
				oldest = readdirSync(dir).filter((f) => f.endsWith(".md")).sort()[0];
			} catch {
				return; // no reports dir in this session
			}
			if (!oldest || !deliverReport(ctx, dir, oldest)) return;
		}
	};
	// session start at the repo root drains the queue: reports younger than the cutoff are
	// delivered (oldest first), stale ones are deleted
	const drainReports = (ctx: ExtensionContext) => {
		if (!canDeliver(ctx)) return;
		const dir = reportsDir(ctx.cwd);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
		} catch {
			return; // no reports dir yet
		}
		const now = Date.now();
		for (const f of files) {
			try {
				if (now - statSync(join(dir, f)).mtimeMs > REPORT_MAX_AGE_MS) rmSync(join(dir, f));
				else deliverReport(ctx, dir, f);
			} catch {
				/* vanished mid-drain */
			}
		}
	};
	let reportsWatcher: FSWatcher | undefined;
	const ensureReportsWatcher = (ctx: ExtensionContext) => {
		if (reportsWatcher || !existsSync(kanbanDir(ctx.cwd))) return;
		try {
			// the dir is created lazily by the first report: create it here, so a session that
			// starts before the first report still watches the queue
			mkdirSync(reportsDir(ctx.cwd), { recursive: true });
			reportsWatcher = watch(reportsDir(ctx.cwd), () => consumeReports(ctx));
		} catch {
			/* no report watching in this session */
		}
	};
	// the 12 tools are deferred, so every session needs the built-in tool_search to declare them
	// on demand. setActiveTools throws during factory loading ("Extension runtime not initialized"),
	// so activation happens in this handler, which fires after the runtime binds. Additive and
	// idempotent: setActiveTools replaces the active set, so spread and check before adding.
	pi.on("before_agent_start", () => {
		const active = pi.getActiveTools();
		if (!active.includes("tool_search")) pi.setActiveTools([...active, "tool_search"]);
	});
	pi.on("session_start", (_event, ctx) => {
		ensureBoardWatcher(ctx);
		ensureReportsWatcher(ctx);
		drainReports(ctx);
	});
	pi.on("session_shutdown", async () => {
		boardWatcher?.close();
		boardWatcher = undefined;
		reportsWatcher?.close();
		reportsWatcher = undefined;
	});
}

export function resolveRoot(cwd: string): string | null {
	try {
		return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null;
	} catch {
		return null;
	}
}

function readPid(root: string): number | null {
	try {
		return parseInt(readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim(), 10) || null;
	} catch {
		return null;
	}
}
