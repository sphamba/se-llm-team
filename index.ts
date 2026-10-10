import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTask, getTask, kanbanDir, listAll, listTasks, setState, updateTask, STATES, type TaskState } from "./src/kanban.ts";
import { waitForBoardCommits } from "./src/orchestrator.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: undefined };
}

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const board = (ctx: ExtensionContext) => kanbanDir(ctx.cwd);
	const daemonLog = (ctx: ExtensionContext) => join(board(ctx), ".logs", "orchestrator.log");
	const notified = new Set<string>();

	pi.registerTool({
		name: "kanban_list",
		label: "Kanban list",
		description:
			"List kanban tasks of this project. scope=backlog: tasks to prioritize. scope=in-progress: tasks being worked on. scope=done: completed tasks. Returns file, name and summary per task.",
		parameters: Type.Object({
			scope: StringEnum(["backlog", "in-progress", "done"] as const),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const refs = listTasks(ctx.cwd, params.scope);
			return {
				content: [{ type: "text", text: JSON.stringify(refs, null, 2) }],
				details: refs,
			};
		},
	});

	pi.registerTool({
		name: "kanban_get",
		label: "Kanban get",
		description: "Read one kanban task in full detail (state, worktree, summary, specs, notes).",
		parameters: Type.Object({ file: Type.String({ description: "Task file name, e.g. 000001_feat_nice_thing.md" }) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			return {
				content: [{ type: "text", text: task ? JSON.stringify(task, null, 2) : `No task ${params.file}` }],
				details: task ?? undefined,
			};
		},
	});

	pi.registerTool({
		name: "kanban_create",
		label: "Kanban create",
		description:
			"Create a kanban task in state backlog. Name tasks with a type prefix like 'feat: ', 'fix: ', 'perf: '. Write the specs with the user.",
		parameters: Type.Object({
			name: Type.String({ description: "Task name with type prefix, e.g. 'feat: nice thing'" }),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			summary: Type.String({ description: "Concise goal, one to three sentences" }),
			specs: Type.Optional(Type.String({ description: "Detailed description of needs" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = createTask(ctx.cwd, params);
			return {
				content: [{ type: "text", text: `Created ${task.file}` }],
				details: task,
			};
		},
	});

	pi.registerTool({
		name: "kanban_update",
		label: "Kanban update",
		description:
			"Update an existing task. Use this instead of creating a duplicate when a not-done task already covers the same need. Omitted fields stay unchanged.",
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			name: Type.Optional(Type.String()),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			summary: Type.Optional(Type.String({ description: "Replaces the whole Summary section" })),
			specs: Type.Optional(Type.String({ description: "Replaces the whole Specs section" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			if (!task) return text(`No task ${params.file}`);
			updateTask(ctx.cwd, task, params);
			return text(`Updated ${task.file}`);
		},
	});

	pi.registerTool({
		name: "kanban_set_state",
		label: "Kanban set state",
		description: `Move a task to a new state. States: ${STATES.join(", ")}.`,
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			state: StringEnum([...STATES] as unknown as [string, ...string[]]),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			if (!task) return text(`No task ${params.file}`);
			setState(ctx.cwd, task, params.state as TaskState);
			return text(`${task.file}: state -> ${params.state}`);
		},
	});

	pi.registerTool({
		name: "kanban_set_worktree",
		label: "Kanban set worktree",
		description: "Set or clear (empty string) the worktree attribute of a task.",
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			worktree: Type.String({ description: "Worktree name under .worktrees/, e.g. feat/nice-thing" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			if (!task) return text(`No task ${params.file}`);
			setWorktree(ctx.cwd, task, params.worktree);
			return text(`${task.file}: worktree -> ${params.worktree}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_start",
		label: "Orchestrator start",
		description:
			"Start the se-llm-team orchestrator daemon for this project. It watches .kanban/, spawns Developer/Reviewer/Live-tester agents for to-do/to-review/to-live-test tasks, polls agent liveness, and merges done branches. When webUi.enabled is set in ~/.pi/agent/se-llm-team.json it also starts an in-process web dashboard for the board. Exits early if it already runs for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (!existsSync(board(ctx))) return text(`No ${board(ctx)} board in this project`);
			const pid = readPid(ctx);
			if (pid && pidAlive(pid)) return text(`Orchestrator already running (pid ${pid})`);
			for (const dir of [".logs", ".pids"]) mkdirSync(join(board(ctx), dir), { recursive: true });
			const log = openSync(daemonLog(ctx), "a");
			const child = spawn(process.execPath, [join(extDir, "src", "orchestrator.ts"), "--root", ctx.cwd], {
				detached: true,
				stdio: ["ignore", log, log],
			});
			child.on("error", (err) => ctx.ui.notify(`orchestrator failed to start: ${err.message}`, "error"));
			closeSync(log);
			child.unref();
			return text(`Orchestrator starting (pid ${child.pid}), log: ${daemonLog(ctx)}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_status",
		label: "Orchestrator status",
		description: "Report whether the orchestrator daemon runs for this project and give kanban state counts.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const counts: Record<string, number> = {};
			for (const t of listAll(ctx.cwd)) counts[t.state] = (counts[t.state] ?? 0) + 1;
			const pid = readPid(ctx);
			const running = pid !== null && pidAlive(pid);
			return text(`${running ? `running (pid ${pid})` : "not running"}; board: ${JSON.stringify(counts)}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_poke",
		label: "Orchestrator poke",
		description: "Poke the se-llm-team orchestrator daemon to trigger an immediate scan and agent scheduling.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			try {
				// rm+create so every poke fires a fs.watch event; a bare open("a") on an
				// existing file writes nothing and Linux inotify reports no event for it.
				const poke = join(board(ctx), ".poke");
				try { unlinkSync(poke); } catch { /* first poke */ }
				closeSync(openSync(poke, "a"));
			} catch {
				/* no board yet */
			}
			const pid = readPid(ctx);
			if (pid === null || !pidAlive(pid)) return text("No orchestrator daemon running for this project.");
			return text(`Poked the orchestrator (pid ${pid}). Scan starts within a second.`);
		},
	});

	pi.registerTool({
		name: "orchestrator_stop",
		label: "Orchestrator stop",
		description: "Stop the orchestrator daemon for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const pid = readPid(ctx);
			if (!pid || !pidAlive(pid)) return text("Orchestrator not running");
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				return text("Orchestrator not running");
			}
			return text(`Sent SIGTERM to orchestrator pid ${pid}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_wait",
		label: "Orchestrator wait",
		description:
			"Wait for the orchestrator to record new board commits (kanban: create / kanban: done) on the meta/kanban branch. Blocks up to the timeout, then reports what changed. No update before the timeout is normal.",
		parameters: Type.Object({
			timeoutSeconds: Type.Optional(Type.Number({ description: "Seconds to block, 1-900 (default 300)" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const started = Date.now();
			const subjects = await waitForBoardCommits(ctx.cwd, params.timeoutSeconds, signal);
			if (subjects.length) return text(subjects.join("\n"));
			return text(`No board commits in ${Math.round((Date.now() - started) / 1000)}s.`);
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
	pi.on("session_start", (_event, ctx) => ensureBoardWatcher(ctx));
	pi.on("session_shutdown", async () => {
		boardWatcher?.close();
		boardWatcher = undefined;
	});
}

function readPid(ctx: ExtensionContext): number | null {
	try {
		return parseInt(readFileSync(join(kanbanDir(ctx.cwd), ".orchestrator.lock"), "utf8").trim(), 10) || null;
	} catch {
		return null;
	}
}

function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM"; // exists but not signalable: still alive
	}
}
