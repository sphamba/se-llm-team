// Shared kanban/orchestrator tool handlers and parameter schemas for both hosts: the pi
// extension (index.ts) and the stdio MCP server (src/mcp.ts). The schemas are plain JSON
// Schema objects, structurally identical to typebox output (typebox 1.x adds no symbols),
// so typebox Compile validates them and the MCP server runs from a bare clone with no
// install step: importing typebox there would fail (peer dependency, no node_modules).
import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseLog } from "./efficiency-analysis.ts";
import { createTask, getTask, kanbanDir, listAll, listTasks, resolveTaskFromCwd, setState, setWorktree, taskNum, updateTask, STATES, type TaskState } from "./kanban.ts";
import { orchestratorWatched, pidAlive, procPgrp } from "./pid.ts";
import { removeTask } from "./orchestrator.ts";
import { loadConfig, resolveLlm } from "./orchestrator/config.ts";

export interface ToolResult {
	text: string;
	details?: unknown;
}

export interface ToolCtx {
	cwd: string;
	// error sink for a failed daemon spawn (pi: the ui notifier; MCP: stderr)
	notify?: (message: string, level: "info" | "error") => void;
	// the default agent the daemon runs when the config sets none (pi: "pi", MCP: "claude")
	defaultAgent: string;
}

export interface ToolDef {
	description: string;
	parameters: Record<string, unknown>;
	run: (params: any, ctx: ToolCtx) => Promise<ToolResult>;
}

// enum guard for hosts without a wire validator (the MCP server has no typebox): pi
// validates the schemas with typebox before execute, so an MCP client must not silently
// write an out-of-enum value (e.g. a kanban_set_state state) to the board
export function checkEnums(tool: ToolDef, params: Record<string, unknown>): void {
	for (const [name, prop] of Object.entries((tool.parameters as { properties?: Record<string, unknown> }).properties ?? {})) {
		const allowed = (prop as { enum?: string[] }).enum;
		const value = params[name];
		if (allowed && value !== undefined && !allowed.includes(value as string)) throw new Error(`invalid ${name} ${JSON.stringify(value)}; expected one of ${allowed.join(", ")}`);
	}
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

const ok = (text: string, details?: unknown): ToolResult => ({ text, details });
const NO_TASK = "no task; pass the file name or run from a worktree with SPECS.md";

export const TOOLS: Record<string, ToolDef> = {
	kanban_list: {
		description:
			"List kanban tasks of this project. scope=backlog: tasks to prioritize. scope=in-progress: tasks being worked on. scope=done: completed tasks. Optional priority filter (low/medium/high/critical). Returns file, num (#NN), name, priority, state, issuer, summary, openQuestions (the task body's # Open questions section, empty when none), complexity and blockedBy (comma-joined blocker task refs like \"#42, #43\", empty when none) per task.",
		parameters: {
			type: "object",
			properties: {
				scope: { type: "string", enum: ["backlog", "in-progress", "done"] },
				priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
			},
			required: ["scope"],
		},
		async run(params: { scope: "backlog" | "in-progress" | "done"; priority?: "low" | "medium" | "high" | "critical" }, ctx) {
			const refs = listTasks(ctx.cwd, params.scope, params.priority);
			return ok(JSON.stringify(refs, null, 2), refs);
		},
	},

	kanban_get: {
		description:
			"Read one kanban task in full detail (state, worktree, issuer, complexity, blockedBy, summary, specs, notes, openQuestions). openQuestions is the task body's # Open questions section, empty when none. file is optional; resolved from the cwd SPECS.md symlink when omitted.",
		parameters: {
			type: "object",
			properties: {
				file: { type: "string", description: "Task file name, e.g. 000001_nice_thing.md. Optional: resolved from the cwd SPECS.md symlink when omitted" },
			},
		},
		async run(params: { file?: string }, ctx) {
			const task = params.file ? getTask(ctx.cwd, params.file) : resolveTaskFromCwd(ctx.cwd);
			return task ? ok(JSON.stringify(task, null, 2), task) : ok(params.file ? `No task ${params.file}` : NO_TASK);
		},
	},

	kanban_create: {
		description:
			"Create a kanban task in state backlog. Name tasks with a type prefix like 'feat: ', 'fix: ', 'perf: '. Write the specs with the user. Set issuer to '#<num>' when the task was created after live-testing of task #<num>; the default 'user' means the user requested it. The issuer is set at creation only and never changed afterwards. Set complexity to trivial, simple, moderate (default) or complex; it drives which per-complexity LLM config entry and reviewer-pass cap apply (trivial gets no reviewer pass). Complexity stays updatable later via kanban_update.",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "Task name with type prefix, e.g. 'feat: nice thing'" },
				shortName: { type: "string", description: "Max 5 lowercase words joined by hyphens, e.g. 'this-is-a-short-name'; names the task file and the branch/worktree. Set at creation only, never updatable" },
				priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
				complexity: { type: "string", enum: ["trivial", "simple", "moderate", "complex"] },
				issuer: { type: "string", description: "'user' (default) or '#<num>' when created after live-testing of task #<num>, e.g. '#42'" },
				summary: { type: "string", description: "Concise goal, one to three sentences" },
				specs: { type: "string", description: "Detailed description of needs" },
				openQuestions: { type: "string", description: "User/client clarification questions, written to the task body's # Open questions section" },
				blockedBy: { type: "string", description: "Comma-joined blocker task refs, e.g. '#42, #43'; the task waits for them" },
			},
			required: ["name", "summary"],
			additionalProperties: false,
		},
		async run(params, ctx) {
			const task = createTask(ctx.cwd, params);
			return ok(`Created ${task.file} (#${taskNum(task.file)})`, task);
		},
	},

	kanban_update: {
		description:
			"Update an existing task. Use this instead of creating a duplicate when a not-done task already covers the same need. Omitted fields stay unchanged. file is optional; resolved from the cwd SPECS.md symlink when omitted.",
		parameters: {
			type: "object",
			properties: {
				file: { type: "string", description: "Task file name. Optional: resolved from the cwd SPECS.md symlink when omitted" },
				name: { type: "string" },
				priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
				complexity: { type: "string", enum: ["trivial", "simple", "moderate", "complex"] },
				summary: { type: "string", description: "Replaces the whole Summary section" },
				specs: { type: "string", description: "Replaces the whole Specs section" },
				openQuestions: { type: "string", description: "User/client clarification questions, written to the task body's # Open questions section" },
				blockedBy: { type: "string", description: "Comma-joined blocker task refs, e.g. '#42, #43'; replaces the whole list, empty string clears it" },
			},
			additionalProperties: false,
		},
		async run(params: { file?: string } & Record<string, unknown>, ctx) {
			const task = params.file ? getTask(ctx.cwd, params.file) : resolveTaskFromCwd(ctx.cwd);
			if (!task) return ok(params.file ? `No task ${params.file}` : NO_TASK);
			const hasField = Object.entries(params).some(([k, v]) => k !== "file" && v !== undefined);
			if (!hasField) return ok(`Nothing to update in ${task.file}`);
			updateTask(ctx.cwd, task, params);
			return ok(`Updated ${task.file} (#${taskNum(task.file)})`);
		},
	},

	kanban_set_state: {
		description: `Move a task to a new state. States: ${STATES.join(", ")}. file is optional; resolved from the cwd SPECS.md symlink when omitted.`,
		parameters: {
			type: "object",
			properties: {
				file: { type: "string", description: "Task file name. Optional: resolved from the cwd SPECS.md symlink when omitted" },
				state: { type: "string", enum: [...STATES] },
			},
			required: ["state"],
			additionalProperties: false,
		},
		async run(params: { file?: string; state: string }, ctx) {
			const task = params.file ? getTask(ctx.cwd, params.file) : resolveTaskFromCwd(ctx.cwd);
			if (!task) return ok(params.file ? `No task ${params.file}` : NO_TASK);
			setState(ctx.cwd, task, params.state as TaskState);
			return ok(`${task.file} (#${taskNum(task.file)}): state -> ${params.state}`);
		},
	},

	kanban_set_worktree: {
		description: "Set or clear (empty string) the worktree attribute of a task.",
		parameters: {
			type: "object",
			properties: {
				file: { type: "string", description: "Task file name" },
				worktree: { type: "string", description: "Worktree name under .worktrees/, e.g. feat/1-nice-thing" },
			},
			required: ["file", "worktree"],
			additionalProperties: false,
		},
		async run(params: { file: string; worktree: string }, ctx) {
			const task = getTask(ctx.cwd, params.file);
			if (!task) return ok(`No task ${params.file}`);
			setWorktree(ctx.cwd, task, params.worktree);
			return ok(`${task.file} (#${taskNum(task.file)}): worktree -> ${params.worktree}`);
		},
	},

	kanban_delete: {
		description:
			"Remove a task from the board. Deletes the task file and commits a whole-board mirror snapshot in one operation, so the daemon cannot restore the task. Use for a mistaken or duplicate task. The worktree and branch of a started task are not removed.",
		parameters: {
			type: "object",
			properties: {
				file: { type: "string", description: "Task file name, e.g. 000001_nice_thing.md" },
			},
			required: ["file"],
		},
		async run(params: { file: string }, ctx) {
			const error = await removeTask(ctx.cwd, params.file);
			if (error) return ok(error);
			return ok(`Deleted ${params.file}`);
		},
	},

	orchestrator_start: {
		description:
			"Start the se-llm-team orchestrator daemon for this project. It watches .kanban/, spawns a Splitter agent for moderate or complex to-do tasks (the task stays in to-do while the Splitter decomposes it or declines; the Developer starts after the Splitter exits), Developer agents for the remaining to-do tasks, Reviewer agents for to-review tasks, one Merger agent for to-merge tasks, and Live-tester agents for to-live-test tasks on the merged commit, and polls agent liveness. Pipeline order: review -> merge -> live-test. When webUi.enabled is set in the global config ($XDG_CONFIG_HOME/se-llm-team/se-llm-team.json, or ~/.config/se-llm-team/se-llm-team.json when XDG_CONFIG_HOME is unset; the legacy ~/.pi/agent/se-llm-team.json is a read-only fallback when the neutral file is absent) it also starts an in-process web dashboard for the board. Exits early if it already runs for this project.",
		parameters: { type: "object", properties: {} },
		async run(_params: Record<string, never>, ctx) {
			const root = resolveRoot(ctx.cwd);
			if (!root) return ok("Not a git repository: agents cannot run without git (worktrees, branches, board commits). No orchestrator started.");
			const pid = readPid(root);
			if (pid && pidAlive(pid)) {
				// 000195: a daemon spawned by a stale session (pre-000192 extension code) has no
				// --watch supervisor, so a src change never restarts it. null (non-Linux /proc,
				// or a lock pid that is no daemon) stays silent
				return orchestratorWatched(pid) === false
					? ok(`Orchestrator already running (pid ${pid}) without a node --watch supervisor: a merge that changes src/ will not restart it. Stop the orchestrator, then start it again to restore the self-restart.`)
					: ok(`Orchestrator already running (pid ${pid})`);
			}
			let log: number;
			try {
				for (const dir of [".logs", ".pids"]) mkdirSync(join(kanbanDir(root), dir), { recursive: true });
				log = openSync(join(kanbanDir(root), ".logs", "orchestrator.log"), "a");
			} catch (err) {
				return ok(`Cannot start the orchestrator: ${(err as Error).message}`);
			}
			// node --watch restarts the daemon whenever its module graph changes, so a merge
			// that changes the orchestrator takes effect without a manual stop and start (000192)
			const child = spawn(process.execPath, ["--watch", join(dirname(fileURLToPath(import.meta.url)), "orchestrator.ts"), "--root", root, "--default-agent", ctx.defaultAgent], {
				detached: true,
				stdio: ["ignore", log, log],
			});
			child.on("error", (err) => ctx.notify?.(`orchestrator failed to start: ${err.message}`, "error"));
			closeSync(log);
			child.unref();
			return ok(`Orchestrator starting (pid ${child.pid}), log: ${join(kanbanDir(root), ".logs", "orchestrator.log")}`);
		},
	},

	orchestrator_status: {
		description: "Report whether the orchestrator daemon runs for this project and give kanban state counts.",
		parameters: { type: "object", properties: {} },
		async run(_params: Record<string, never>, ctx) {
			const root = resolveRoot(ctx.cwd) ?? ctx.cwd;
			const counts: Record<string, number> = {};
			for (const t of listAll(root)) counts[t.state] = (counts[t.state] ?? 0) + 1;
			const pid = readPid(root);
			const running = pid !== null && pidAlive(pid);
			return ok(`${running ? `running (pid ${pid})` : "not running"}; board: ${JSON.stringify(counts)}`);
		},
	},

	orchestrator_poke: {
		description: "Poke the se-llm-team orchestrator daemon to trigger an immediate scan and agent scheduling.",
		parameters: { type: "object", properties: {} },
		async run(_params: Record<string, never>, ctx) {
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
			if (pid === null || !pidAlive(pid)) return ok("No orchestrator daemon running for this project.");
			return ok(`Poked the orchestrator (pid ${pid}). Scan starts within a second.`);
		},
	},

	orchestrator_stop: {
		description: "Stop the orchestrator daemon for this project.",
		parameters: { type: "object", properties: {} },
		async run(_params: Record<string, never>, ctx) {
			const pid = readPid(resolveRoot(ctx.cwd) ?? ctx.cwd);
			if (!pid || !pidAlive(pid)) return ok("Orchestrator not running");
			try {
				// under node --watch the supervisor shares the daemon's process group: a bare pid
				// kill would leave it to resurrect the daemon on the next watched change, so
				// signal the group when it is not our own group (a test victim shares it)
				const pgrp = procPgrp(pid);
				if (pgrp && pgrp !== procPgrp(process.pid)) process.kill(-Number(pgrp), "SIGTERM");
				else process.kill(pid, "SIGTERM");
			} catch {
				return ok("Orchestrator not running");
			}
			return ok(`Sent SIGTERM to orchestrator pid ${pid}`);
		},
	},

	efficiency_analysis: {
		description:
			"Analyse one agent log of this project and report pain points. The tool parses the JSONL log, summarizes each assistant block with a headless analyst, and has a doctor pass turn the summaries into a markdown report next to the log as <name minus the .log or .log.gz suffix>.analysis.md. Returns the final analysis inline with the report path and the block count.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Log file path, absolute or relative to the cwd, .log or .log.gz" },
			},
			required: ["path"],
		},
		async run(params: { path: string }, ctx) {
			const root = ctx.cwd;
			const absolutePath = resolve(root, params.path);
			const cfg = loadConfig(root, ctx.defaultAgent);
			// the role default applies, no complexity override. The in-flight cap and the merge
			// threshold come from the role config, the module defaults apply when unset. The
			// analyst and doctor run through the same backend as the spawned agents
			try {
				const result = await analyseLog(absolutePath, { root, agent: cfg.agent, backend: cfg.backend, llm: resolveLlm(root, cfg, "analyst", ""), doctorLlm: resolveLlm(root, cfg, "doctor", ""), concurrency: cfg.roles.analyst?.concurrency, mergeThreshold: cfg.roles.analyst?.mergeThreshold });
				return ok(`${result.analysis}\n\nReport: ${result.reportPath}\nBlocks analysed: ${result.blockCount}`, result);
			} catch (err) {
				return ok(`Cannot analyse ${absolutePath}: ${(err as Error).message}`);
			}
		},
	},
};
