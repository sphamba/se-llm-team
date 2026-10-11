import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTask, getTask, kanbanDir, listAll, listTasks, setState, setWorktree, taskNum, updateTask, STATES, type TaskState } from "./src/kanban.ts";
import { removeTask, waitForBoardCommits } from "./src/orchestrator.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: undefined };
}

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const board = (ctx: ExtensionContext) => kanbanDir(ctx.cwd);
	const daemonLog = (root: string) => join(kanbanDir(root), ".logs", "orchestrator.log");
	const notified = new Set<string>();

	pi.registerTool({
		name: "kanban_list",
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
		label: "Kanban get",
		description: "Read one kanban task in full detail (state, worktree, issuer, complexity, blockedBy, summary, specs, notes, openQuestions). openQuestions is the task body's # Open questions section, empty when none.",
		parameters: Type.Object({ file: Type.String({ description: "Task file name, e.g. 000001_nice_thing.md" }) }),
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
			"Create a kanban task in state backlog. Name tasks with a type prefix like 'feat: ', 'fix: ', 'perf: '. Write the specs with the user. Set issuer to '#<num>' when the task was created after live-testing of task #<num>; the default 'user' means the user requested it. The issuer is set at creation only and never changed afterwards. Set complexity to simple, moderate (default) or complex; it drives which per-complexity LLM config entry and reviewer-pass cap apply. Complexity stays updatable later via kanban_update.",
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false create
		parameters: Type.Object({
			name: Type.String({ description: "Task name with type prefix, e.g. 'feat: nice thing'" }),
			shortName: Type.Optional(Type.String({ description: "Max 5 lowercase words joined by hyphens, e.g. 'this-is-a-short-name'; names the task file and the branch/worktree. Set at creation only, never updatable" })),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			complexity: Type.Optional(StringEnum(["simple", "moderate", "complex"] as const)),
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
		label: "Kanban update",
		description:
			"Update an existing task. Use this instead of creating a duplicate when a not-done task already covers the same need. Omitted fields stay unchanged.",
		// additionalProperties: false so pi rejects an unrecognized field (e.g. notes)
		// with a validation error instead of dropping it and reporting a false update
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			name: Type.Optional(Type.String()),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			complexity: Type.Optional(StringEnum(["simple", "moderate", "complex"] as const)),
			summary: Type.Optional(Type.String({ description: "Replaces the whole Summary section" })),
			specs: Type.Optional(Type.String({ description: "Replaces the whole Specs section" })),
			openQuestions: Type.Optional(Type.String({ description: "User/client clarification questions, written to the task body's # Open questions section" })),
			blockedBy: Type.Optional(Type.String({ description: "Comma-joined blocker task refs, e.g. '#42, #43'; replaces the whole list, empty string clears it" })),
		}, { additionalProperties: false }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			ensureBoardWatcher(ctx);
			const task = getTask(ctx.cwd, params.file);
			if (!task) return text(`No task ${params.file}`);
			const hasField = Object.entries(params).some(([k, v]) => k !== "file" && v !== undefined);
			if (!hasField) return text(`Nothing to update in ${task.file}`);
			updateTask(ctx.cwd, task, params);
			return text(`Updated ${task.file} (#${taskNum(task.file)})`);
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
			return text(`${task.file} (#${taskNum(task.file)}): state -> ${params.state}`);
		},
	});

	pi.registerTool({
		name: "kanban_set_worktree",
		label: "Kanban set worktree",
		description: "Set or clear (empty string) the worktree attribute of a task.",
		parameters: Type.Object({
			file: Type.String({ description: "Task file name" }),
			worktree: Type.String({ description: "Worktree name under .worktrees/, e.g. feat/1-nice-thing" }),
		}),
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
		label: "Orchestrator start",
		description:
			"Start the se-llm-team orchestrator daemon for this project. It watches .kanban/, spawns Developer/Reviewer/Live-tester agents for to-do/to-review/to-live-test tasks, polls agent liveness, and merges done branches. When webUi.enabled is set in ~/.pi/agent/se-llm-team.json it also starts an in-process web dashboard for the board. Exits early if it already runs for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const { root } = resolveRoot(ctx.cwd);
			if (!root) return text("Not a git repository: agents cannot run without git (worktrees, branches, board commits). No orchestrator started.");
			const pid = readPid(root);
			if (pid && pidAlive(pid)) return text(`Orchestrator already running (pid ${pid})`);
			let log: number;
			try {
				for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
				log = openSync(daemonLog(root), "a");
			} catch (err) {
				return text(`Cannot start the orchestrator: ${(err as Error).message}`);
			}
			const child = spawn(process.execPath, [join(extDir, "src", "orchestrator.ts"), "--root", root], {
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
		label: "Orchestrator status",
		description: "Report whether the orchestrator daemon runs for this project and give kanban state counts.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const root = resolveRoot(ctx.cwd).root ?? ctx.cwd;
			const counts: Record<string, number> = {};
			for (const t of listAll(root)) counts[t.state] = (counts[t.state] ?? 0) + 1;
			const pid = readPid(root);
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
			const root = resolveRoot(ctx.cwd).root ?? ctx.cwd;
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
		label: "Orchestrator stop",
		description: "Stop the orchestrator daemon for this project.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const pid = readPid(resolveRoot(ctx.cwd).root ?? ctx.cwd);
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

export function resolveRoot(cwd: string): { root: string } | { root: null } {
	try {
		const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		return { root: root || null };
	} catch {
		return { root: null };
	}
}

function readPid(root: string): number | null {
	try {
		return parseInt(readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim(), 10) || null;
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
