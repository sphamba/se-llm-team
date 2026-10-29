import { closeSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isLinkedWorktree, kanbanDir, listAll } from "./src/kanban.ts";
import { canTake, REPORT_MAX_AGE_MS, reportsDir } from "./src/orchestrator/report.ts";
import { TOOLS, type ToolCtx, type ToolResult } from "./src/tools.ts";

const SCAN_DEBOUNCE_MS = 100;

// one write fires several fs events, so a burst costs one scan. unref'd, so a pending timer
// never keeps the process alive
export function debounce(fn: () => void, ms = SCAN_DEBOUNCE_MS): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			fn();
		}, ms);
		(timer as { unref?: () => void }).unref?.();
	};
}

const LABELS: Record<string, string> = {
	kanban_list: "Kanban list",
	kanban_get: "Kanban get",
	kanban_create: "Kanban create",
	kanban_update: "Kanban update",
	kanban_set_state: "Kanban set state",
	kanban_set_worktree: "Kanban set worktree",
	kanban_delete: "Kanban delete",
	orchestrator_start: "Orchestrator start",
	orchestrator_status: "Orchestrator status",
	orchestrator_poke: "Orchestrator poke",
	orchestrator_stop: "Orchestrator stop",
	efficiency_analysis: "Efficiency analysis",
};

export default function (pi: ExtensionAPI) {
	const board = (ctx: ExtensionContext) => kanbanDir(ctx.cwd);
	const notified = new Set<string>();

	// the shared handlers run with the session cwd, the ui notifier for a failed daemon
	// spawn, and pi as the default agent the daemon runs on a bare config
	const toolCtx = (ctx: ExtensionContext): ToolCtx => ({
		cwd: ctx.cwd,
		sid: ctx.sessionManager?.getSessionId(),
		notify: (message, level) => ctx.ui.notify(message, level),
		defaultAgent: "pi",
	});
	const toPiResult = (result: ToolResult) => ({ content: [{ type: "text" as const, text: result.text }], details: result.details });

	for (const [name, tool] of Object.entries(TOOLS)) {
		pi.registerTool({
			name,
			exposure: "deferred",
			label: LABELS[name],
			description: tool.description,
			// plain JSON Schema (see src/tools.ts): structurally a typebox schema (typebox 1.x
			// adds no symbols), the cast only satisfies the TSchema signature
			parameters: tool.parameters as any,
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (name.startsWith("kanban_")) ensureBoardWatcher(ctx);
				return toPiResult(await tool.run(params, toolCtx(ctx)));
			},
		});
	}

	// progress notifications for the PM session: tell the user when a task reaches done.
	// Attached lazily (the board may only be created later in the session) and seeded with
	// tasks already done, so only done-transitions after the attach notify.
	let boardWatcher: FSWatcher | undefined;
	// a board watcher must never kill the session that holds it
	const scanBoard = (ctx: ExtensionContext) => {
		try {
			for (const t of listAll(ctx.cwd)) {
				if (t.state !== "done" || notified.has(t.file)) continue;
				notified.add(t.file);
				if (ctx.hasUI) ctx.ui.notify(`Kanban: ${t.name} is done`, "info");
			}
		} catch {
			/* a failed scan is not a failed session */
		}
	};
	const ensureBoardWatcher = (ctx: ExtensionContext) => {
		if (boardWatcher || !existsSync(board(ctx))) return;
		try {
			for (const t of listAll(ctx.cwd)) if (t.state === "done") notified.add(t.file);
			boardWatcher = watch(board(ctx), debounce(() => scanBoard(ctx)));
		} catch {
			/* no board watching in this session */
		}
	};
	// PM report delivery: the orchestrator queues one report per done sweep in .kanban/.reports/,
	// addressed to the owner session when one is registered (orchestrator_start claims it). Every
	// session watches the queue (same lifecycle as the board watcher); only the session at the repo
	// root consumes it: a worktree session shares the board through the .kanban symlink, so the gate
	// is the git-topology check of the hub candidacy rule. Consumption claims one report by rename,
	// sends it to the PM chat and deletes it: a second root session loses the rename and never
	// double-sends, and a report addressed to another live session is never claimed at all
	const canDeliver = (ctx: ExtensionContext) => ctx.hasUI && !isLinkedWorktree(ctx.cwd);
	const ownSid = (ctx: ExtensionContext) => ctx.sessionManager?.getSessionId() ?? null;
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
		const sid = ownSid(ctx);
		for (;;) {
			let next: string | undefined;
			try {
				next = readdirSync(dir)
					.filter((f) => f.endsWith(".md") && canTake(ctx.cwd, f, sid))
					.sort()[0];
			} catch {
				return; // no reports dir in this session
			}
			if (!next || !deliverReport(ctx, dir, next)) return;
		}
	};
	// session start at the repo root drains the queue: reports younger than the cutoff are
	// delivered (oldest first), stale ones are deleted
	const drainReports = (ctx: ExtensionContext) => {
		if (!canDeliver(ctx)) return;
		const dir = reportsDir(ctx.cwd);
		const sid = ownSid(ctx);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
		} catch {
			return; // no reports dir yet
		}
		const now = Date.now();
		for (const f of files) {
			try {
				// the age prune drops every aged file, addressed or not; delivery skips what the
				// owner rule leaves to another live session
				if (now - statSync(join(dir, f)).mtimeMs > REPORT_MAX_AGE_MS) rmSync(join(dir, f));
				else if (canTake(ctx.cwd, f, sid)) deliverReport(ctx, dir, f);
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
			reportsWatcher = watch(
				reportsDir(ctx.cwd),
				debounce(() => {
					try {
						consumeReports(ctx);
					} catch {
						/* a failed scan is not a failed session */
					}
				}),
			);
		} catch {
			/* no report watching in this session */
		}
	};
	// the tools are deferred, so every session needs the built-in tool_search to declare them
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
