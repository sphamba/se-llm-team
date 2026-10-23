import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTask, isLinkedWorktree, kanbanDir, taskFiles, taskNum, taskSlug, updateAttrs } from "./kanban.ts";
import type { StageFlags } from "./orchestrator/config.ts";
import { readMergerSlug } from "./orchestrator/spawn.ts";
import { agentPidName, clearPid, killTree, pidAlive, pidEntry } from "./pid.ts";
import * as webui from "./webui.ts";

// Hub backend: daemons register on spawn, the hub is elected by a lock race, the registry is
// one hub-written file, failover re-elects on hub death, and only the hub serves the ui.
// All timestamps are epoch milliseconds.
export interface HubEntry {
	name: string; // repo basename
	root: string; // project root, the entry identity: two checkouts of one repo share the name
	branch: string; // the root checkout's current branch, resolved live; "" on a detached HEAD
	start: number; // registration time
	lastHeartbeat: number;
	stages?: StageFlags; // the daemon's stage toggles, absent on old entries (all on)
}

export interface HubOptions {
	name: string; // repo basename of this daemon's project
	root: string; // this daemon's project root
	host: string; // webUi host from the webUi config block
	port: number | string; // webUi port
	stages?: StageFlags; // the running daemon's stage toggles, shown by the webui
	log?: (message: string) => void;
	healthMs?: number; // heartbeat + failover poll + hub reap cadence
	staleMs?: number; // registry age-out for silent entries
}

// the checkout whose code this process serves: hub.ts is <code root>/src/hub.ts and realpath
// resolves the install symlink, so a worktree-launched daemon names its own worktree (000165)
const CODE_ROOT = (() => {
	const src = dirname(fileURLToPath(import.meta.url));
	try {
		return realpathSync(join(src, ".."));
	} catch {
		return join(src, "..");
	}
})();

const REGISTRY_FILE = "hub.json";
const LOCK_FILE = "hub.lock";
const DEFAULT_HEALTH_MS = 5000;
const DEFAULT_STALE_MS = 15000;
const HEALTH_FAILS = 2;
const REQUEST_TIMEOUT = 1000;

// the root checkout's current branch, resolved live at register and every heartbeat; a detached
// HEAD or a non-git root sends "" and the webui label falls back to the plain name
export function currentBranch(root: string): string {
	try {
		return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "";
	}
}

// the checkout's HEAD commit, resolved live; "" on a non-git root (000165: the /api/hub identity)
export function currentCommit(root: string): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "";
	}
}

// the registry and lock live beside the global config in ~/.se-llm-team
const hubDir = () => join(process.env.HOME || homedir(), ".se-llm-team");
const hubRegistryPath = () => join(hubDir(), REGISTRY_FILE);
const hubLockPath = () => join(hubDir(), LOCK_FILE);

// env knobs let smoke runs shrink the cadences without touching the config schema
const envMs = (key: string, fallback: number): number => {
	const n = Number(process.env[key]);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

// the registry, readable by any daemon for the alive-daemon list; missing or corrupt = []
export function readHubRegistry(): HubEntry[] {
	try {
		const parsed = JSON.parse(readFileSync(hubRegistryPath(), "utf8"));
		return Array.isArray(parsed)
			? parsed
					.filter(
						(e) =>
							e &&
							typeof e === "object" &&
							typeof e.name === "string" &&
							typeof e.root === "string" &&
							typeof e.start === "number" &&
							typeof e.lastHeartbeat === "number",
					)
				.map((e) => ({ ...e, branch: typeof e.branch === "string" ? e.branch : "" })) // a pre-branch registry entry survives the seed
			: [];
	} catch {
		return [];
	}
}

// a stage flag is on unless the payload says false, so a missing or malformed field cannot fade a column
function parseStageFlags(value: any): StageFlags | undefined {
	return value && typeof value === "object"
		? { reviews: value.reviews !== false, liveTesting: value.liveTesting !== false, integrationTesting: value.integrationTesting !== false }
		: undefined;
}

// registry publish, hub only: sibling temp file + rename, so readers never see a partial file
function writeRegistry(entries: HubEntry[]): void {
	const path = hubRegistryPath();
	mkdirSync(hubDir(), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(entries, null, "\t") + "\n");
	renameSync(tmp, path);
}

// election lock shared by every daemon in the global config dir: create-exclusive, stale-pid steal
// (same pattern as the per-project orchestrator lock). true = ours, "" = a rival holds it, any other
// string = the lock cannot be written, naming the code and path so the log reports the real cause
function acquireHubLock(): true | string {
	const lock = hubLockPath();
	try {
		mkdirSync(hubDir(), { recursive: true });
		writeFileSync(lock, String(process.pid), { flag: "wx" });
		return true;
	} catch (err: any) {
		// 000220: EEXIST on the lock file itself is the rival race; any other failure (EROFS, EACCES,
		// ENOSPC, ENOENT, the global dir blocked by a file) names the real code and path
		if (err?.code !== "EEXIST" || err?.path !== lock) return `hub lock write failed at ${err?.path ?? lock} (${err?.code ?? err})`;
		let other = 0;
		try {
			other = parseInt(readFileSync(lock, "utf8").trim(), 10);
		} catch {
			return ""; // lock vanished since the wx attempt: a rival holds or released it, stand down
		}
		if (pidAlive(other)) return "";
		rmSync(lock, { force: true }); // a rival stealing the same stale lock must not crash the election
		return acquireHubLock();
	}
}

function releaseHubLock(): void {
	const lock = hubLockPath();
	try {
		if (readFileSync(lock, "utf8").trim() === String(process.pid)) rmSync(lock);
	} catch {
		/* not ours */
	}
}

// 0.0.0.0 and :: are bind addresses, not dial addresses: self-requests go to the loopback
const dialHost = (host: string) => (host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host);

const json = (res: ServerResponse, body: unknown, status = 200): void => {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", connection: "close" });
	res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});

// The user hold the task dialog toggles. A block backs a working state up to its own queue
// state and stops that state's agent; every other allowed state keeps its state. The integration
// lane is project-wide, so only the task its slug file names owns that pid.
const USER_HOLD = "user";
const BLOCK_STATE: Record<string, string> = {
	doing: "to-do",
	reviewing: "to-review",
	"live-testing": "to-live-test",
	"integration-testing": "to-integration-test",
};
const BLOCK_ROLE: Record<string, string> = {
	"to-do": "splitter",
	doing: "developer",
	reviewing: "reviewer",
	"live-testing": "live-tester",
};
const BLOCK_BODY_CAP = 1024;

const withoutUserHold = (blockedBy: string): string[] =>
	String(blockedBy || "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part && part.toLowerCase() !== USER_HOLD);

// stop the process an agent name owns: a live pid takes its whole process group down, a stale
// one is not signalled, and either way the pid file goes
function stopAgent(root: string, name: string, log?: (message: string) => void): void {
	const { pid, disc } = pidEntry(root, name);
	if (!pid) return;
	if (pidAlive(pid, disc) && !killTree(pid)) log?.(`task-block: kill of ${name} (pid ${pid}) failed`);
	clearPid(root, name);
}

// the daemon re-evaluates at once, the same rm+create as orchestrator_poke, so fs.watch fires
function pokeDaemon(root: string): void {
	try {
		const poke = join(kanbanDir(root), ".poke");
		try {
			unlinkSync(poke);
		} catch {
			/* first poke */
		}
		closeSync(openSync(poke, "a"));
	} catch {
		/* no board yet */
	}
}

// the body read stops at the cap too, so a chunked upload cannot slip past a missing length:
// the chunk that would pass the cap resolves null and every later chunk is drained, not stored
export const readCapped = (req: IncomingMessage): Promise<string | null> =>
	new Promise((resolve) => {
		let data = "";
		let settled = false;
		const settle = (value: string | null) => {
			if (settled) return;
			settled = true;
			data = "";
			resolve(value);
		};
		req.on("data", (chunk: Buffer) => {
			if (settled) return;
			if (data.length + chunk.length > BLOCK_BODY_CAP) return settle(null);
			data += chunk;
		});
		req.on("end", () => settle(data));
		req.on("error", () => settle(null));
	});

async function taskBlock(
	opts: HubOptions,
	entries: Map<string, HubEntry>,
	url: URL,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const fail = (status: number, error: string): void => json(res, { error }, status);
	// same-origin only: a present Origin must name this host, and the UI's own fetch sends none
	const origin = req.headers.origin;
	if (origin) {
		let host = "";
		try {
			host = new URL(origin).host;
		} catch {
			/* malformed origin: refused below */
		}
		if (host !== req.headers.host) return fail(403, "cross-origin request refused");
	}
	if (String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json")
		return fail(415, "content-type must be application/json");
	if (Number(req.headers["content-length"] ?? 0) > BLOCK_BODY_CAP) return fail(413, "body too large");
	const raw = await readCapped(req);
	if (raw === null || raw.length > BLOCK_BODY_CAP) return fail(413, "body too large");
	let body: any;
	try {
		body = JSON.parse(raw);
	} catch {
		return fail(400, "invalid JSON");
	}
	const action = body?.action;
	if (action !== "block" && action !== "unblock") return fail(400, "action must be block or unblock");
	const entry = resolveEntry(entries, url.searchParams.get("project") ?? opts.root);
	const num = Number(url.searchParams.get("num"));
	const file = entry && Number.isInteger(num) ? taskFiles(entry.root).find((f) => taskNum(f) === num) : undefined;
	const task = entry && file ? getTask(entry.root, file) : undefined;
	if (!entry || !task) return fail(404, "unknown task");
	const refs = withoutUserHold(task.blockedBy);
	if (action === "unblock") {
		updateAttrs(entry.root, task, { blockedBy: refs.join(", ") });
		pokeDaemon(entry.root);
		return json(res, { ok: true });
	}
	if (task.state === "done" || task.state === "merging") return fail(409, `cannot block a ${task.state} task`);
	// one task write: the hold and the queue state land together, before any kill, so the
	// integration lane's liveness rule cannot advance the task to done in between
	const blockedBy = [...refs, USER_HOLD].join(", ");
	const next = BLOCK_STATE[task.state];
	updateAttrs(entry.root, task, next ? { blockedBy, state: next } : { blockedBy });
	const role = BLOCK_ROLE[task.state];
	const slug = taskSlug(task.file);
	if (role) stopAgent(entry.root, agentPidName(role, slug), opts.log);
	if (task.state === "integration-testing" && readMergerSlug(entry.root, "integration-tester") === slug)
		stopAgent(entry.root, "integration-tester", opts.log);
	json(res, { ok: true });
}

// project selects by root (the tab identity); a bare name still finds its entry when unique, so
// name-only clients keep working. With duplicate names a bare name is ambiguous and answers none
function resolveEntry(entries: Map<string, HubEntry>, project: string): HubEntry | undefined {
	const direct = entries.get(project);
	if (direct) return direct;
	let found: HubEntry | undefined;
	for (const e of entries.values()) {
		if (e.name !== project) continue;
		if (found) return undefined;
		found = e;
	}
	return found;
}

async function route(
	opts: HubOptions,
	entries: Map<string, HubEntry>,
	flush: () => void,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://hub");
	const path = url.pathname;
	// no project param = the hub's own project: the pre-tab ui polls /api/tasks bare
	const project = url.searchParams.get("project") ?? opts.root;
	if (req.method === "GET" && path === "/health") {
		res.writeHead(200, { "content-type": "text/plain; charset=utf-8", connection: "close" });
		res.end("ok");
	} else if (req.method === "GET" && path === "/") {
		// no-cache: a browser reload re-fetches the page instead of serving a stale one
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", connection: "close" });
		res.end(webui.PAGE);
	} else if (req.method === "GET" && path === "/api/hub") {
		// 000165: the serving hub's identity, so a stale-code hub or a failover is visible at a glance
		json(res, { pid: process.pid, root: CODE_ROOT, commit: currentCommit(CODE_ROOT) });
	} else if (req.method === "GET" && path === "/api/projects") {
		json(res, [...entries.values()]);
	} else if (req.method === "GET" && path === "/api/tasks") {
		const entry = resolveEntry(entries, project);
		if (!entry) {
			res.writeHead(404).end(); // unknown projects are rejected
		} else {
			json(res, await webui.taskPayload(entry.root));
		}
	} else if (req.method === "GET" && path === "/api/task-detail") {
		// 000242, 000248: the light per-task detail (body, sections, attributes, no log parsing),
		// loaded on open; the heavy agent history loads in the /api/task-history follow-up
		const entry = resolveEntry(entries, project);
		const num = Number(url.searchParams.get("num"));
		const detail = entry && Number.isInteger(num) ? webui.taskDetail(entry.root, num) : null;
		if (!detail) {
			res.writeHead(404, { "content-type": "application/json; charset=utf-8", connection: "close" });
			res.end(JSON.stringify({ error: "unknown task" }));
		} else {
			json(res, detail);
		}
	} else if (req.method === "GET" && path === "/api/task-history") {
		// 000248: the heavy half of the detail (agent history, doctor history, log stats), loaded in
		// a follow-up fetch after the text shows; the async payload yields between logs, so this
		// parse never delays a concurrent client's response
		const entry = resolveEntry(entries, project);
		const num = Number(url.searchParams.get("num"));
		const history = entry && Number.isInteger(num) ? await webui.taskHistory(entry.root, num) : null;
		if (!history) {
			res.writeHead(404, { "content-type": "application/json; charset=utf-8", connection: "close" });
			res.end(JSON.stringify({ error: "unknown task" }));
		} else {
			json(res, history);
		}
	} else if (req.method === "GET" && path === "/api/card-stats") {
		// 000263: the batched lazy-stats endpoint for the cards behind "show more" (the eager
		// /api/tasks response carries only the first five per column); async like task-history,
		// so a slow parse never delays a concurrent client's response
		const entry = resolveEntry(entries, project);
		if (!entry) {
			res.writeHead(404).end(); // unknown projects are rejected like /api/tasks
		} else {
			const files = (url.searchParams.get("files") ?? "").split(",").filter(Boolean);
			json(res, await webui.cardStatsPayload(entry.root, files));
		}
	} else if (req.method === "POST" && path === "/api/task-block") {
		// the detail dialog's hold toggle: one task write, then the agent stop
		await taskBlock(opts, entries, url, req, res);
	} else if (req.method === "GET" && path === "/api/agent-log") {
		const entry = resolveEntry(entries, project);
		const payload = entry ? await webui.agentLogPayload(entry.root, url.searchParams) : null;
		if (!payload) {
			res.writeHead(404).end();
		} else {
			res.writeHead(200, { "content-type": "application/json; charset=utf-8", connection: "close" });
			res.end(payload);
		}
	} else if (req.method === "POST" && path === "/register") {
		let body: any;
		try {
			body = JSON.parse((await readBody(req)) || "{}");
		} catch {
			body = null;
		}
		const name = typeof body?.name === "string" ? body.name.trim() : "";
		// resolve only after the absolute check: resolve() maps relative roots onto the hub's cwd
		const root = typeof body?.root === "string" && isAbsolute(body.root) ? resolve(body.root) : "";
		// trust boundary: the hub reads board files from root, so only absolute existing dirs register
		if (!name || name.length > 200 || !root || !isAbsolute(root) || !existsSync(root)) {
			res.writeHead(400).end();
			return;
		}
		const branch = typeof body?.branch === "string" ? body.branch.trim().slice(0, 200) : "";
		const stages = parseStageFlags(body?.stages);
		const entry: HubEntry = { name, root, branch, stages, start: Date.now(), lastHeartbeat: Date.now() };
		entries.set(root, entry); // root is the identity: same-named checkouts register their own entries
		flush();
		json(res, entry);
	} else if (req.method === "POST" && path === "/heartbeat") {
		let body: any;
		try {
			body = JSON.parse((await readBody(req)) || "{}");
		} catch {
			body = null;
		}
		// the body's root finds the sender's own entry when names duplicate; without a root (old
		// daemon) the name resolves it, and an unregistered sender 404s into re-registering
		const beatRoot = typeof body?.root === "string" && isAbsolute(body.root) ? resolve(body.root) : "";
		const stages = parseStageFlags(body?.stages);
		const entry = beatRoot
			? entries.get(beatRoot)
			: typeof body?.name === "string"
				? resolveEntry(entries, body.name)
				: undefined;
		if (!entry) {
			res.writeHead(404).end(); // unregistered or aged out: the daemon re-registers
		} else {
			entry.lastHeartbeat = Date.now();
			if (typeof body?.branch === "string") entry.branch = body.branch.trim().slice(0, 200); // live: the label tracks the checkout as it moves
			if (stages) entry.stages = stages; // a restarted daemon refreshes its flags even when its old entry is still alive
			flush();
			json(res, entry);
		}
	} else {
		res.writeHead(404).end();
	}
}

// Start the hub inside this daemon: inherit the previous hub's registry (stale entries age out
// at seed), serve the ui and every API on the webUi host/port, and register this daemon's
// project. Resolves null when the port cannot be bound, so the caller stands down.
export async function startHub(opts: HubOptions): Promise<{ port: number; close: () => void } | null> {
	const staleMs = opts.staleMs ?? envMs("SE_LLM_TEAM_HUB_STALE_MS", DEFAULT_STALE_MS);
	const tickMs = opts.healthMs ?? envMs("SE_LLM_TEAM_HUB_HEALTH_MS", DEFAULT_HEALTH_MS);
	const now = Date.now();
	const entries = new Map<string, HubEntry>();
	for (const e of readHubRegistry()) if (e.root && now - e.lastHeartbeat <= staleMs) entries.set(e.root, e);
	const self: HubEntry = { name: opts.name, root: opts.root, branch: currentBranch(opts.root), stages: opts.stages, start: now, lastHeartbeat: now };
	entries.set(opts.root, self);
	const flush = () => writeRegistry([...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
	flush();

	const server = createServer((req, res) => {
		res.on("error", () => {}); // client aborted mid-response
		route(opts, entries, flush, req, res).catch(() => {
			try {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end("hub error");
			} catch {
				/* headers already sent */
			}
		});
	});
	// the hub refreshes its own heartbeat and ages out silent entries on every rewrite
	const reap = setInterval(() => {
		const t = Date.now();
		self.lastHeartbeat = t;
		for (const [name, e] of entries) if (t - e.lastHeartbeat > staleMs) entries.delete(name);
		flush();
	}, tickMs);
	reap.unref();
	server.unref();
	return new Promise((resolve) => {
		server.on("error", () => {
			clearInterval(reap);
			resolve(null);
		});
		server.listen(opts.port, opts.host, () => {
			const addr = server.address();
			resolve({
				port: addr && typeof addr === "object" ? addr.port : Number(opts.port),
				close: () => {
					clearInterval(reap);
					if (entries.get(opts.root) === self) entries.delete(opts.root); // entries key by root
					flush();
					server.close();
				},
			});
		});
	});
}

// The daemon side of the hub: at startup (webUi enabled) check /health; when no hub answers,
// race for the shared lock. The winner serves the ui in-process, losers stand down and
// register with the winner. Every daemon heartbeats and polls /health: repeated failures
// re-run the election, so a dead hub fails over to a surviving daemon. A daemon rooted in a
// linked git worktree never races (its checkout can hold old code): it registers and
// heartbeats only, so a production restart leaves the port free for the new production daemon
// (000165; 000168: any linked worktree, not just task worktrees under .worktrees).
// Runs for the daemon's lifetime.
export function joinHub(opts: HubOptions): void {
	const log = opts.log ?? (() => {});
	const tickMs = opts.healthMs ?? envMs("SE_LLM_TEAM_HUB_HEALTH_MS", DEFAULT_HEALTH_MS);
	const base = `http://${dialHost(opts.host)}:${opts.port}`;
	// 000168: candidacy is git topology, not a path rule: a linked worktree checkout can hold
	// old code, so its daemon never races for the port; main checkouts stay production (000165)
	const canHub = !isLinkedWorktree(opts.root);
	let timer: NodeJS.Timeout | undefined;
	let busy = false;
	let failures = 0;
	let bindFailures = 0;
	let registered = false;

	const healthy = async (): Promise<boolean> => {
		try {
			return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })).ok;
		} catch {
			return false;
		}
	};
	const register = async (): Promise<boolean> => {
		try {
			return (
				await fetch(`${base}/register`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: opts.name, root: opts.root, branch: currentBranch(opts.root), stages: opts.stages }),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				})
			).ok;
		} catch {
			return false;
		}
	};
	const beat = async (): Promise<number> => {
		try {
			return (
				await fetch(`${base}/heartbeat`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: opts.name, root: opts.root, branch: currentBranch(opts.root), stages: opts.stages }),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				})
			).status;
		} catch {
			return 0;
		}
	};

	// one election attempt: win the lock and serve, or stand down (lock lost or bind failed). The
	// hub is optional, the pipeline is not: 000220 an unwritable global config dir must never kill
	// the daemon, so every error is caught here, released and logged with its code and path
	const becomeHub = async (): Promise<boolean> => {
		try {
			const lock = acquireHubLock();
			if (lock !== true) {
				// only a rival lock reads as another daemon; a write failure names its own cause
				log(lock ? `${lock}, running without the hub` : "hub lock held by another daemon, standing down");
				return false;
			}
			const hub = await startHub(opts);
			if (hub) {
				bindFailures = 0;
				log(`web ui on http://${opts.host}:${hub.port} (hub for ${opts.name})`);
				process.on("exit", () => {
					hub.close();
					releaseHubLock();
				});
				return true;
			}
			releaseHubLock();
			// a wedged foreign port holder would loop the election: the first failure logs, the rest stay silent
			if (++bindFailures === 1) log(`web ui bind failed on ${opts.host}:${opts.port} (port taken), standing down`);
			return false;
		} catch (err: any) {
			releaseHubLock(); // idempotent: a lock carrying another pid is left alone
			log(`hub election failed (${err?.code ?? err}${err?.path ? ` at ${err.path}` : ""}), running without the hub`);
			return false;
		}
	};

	const tick = async (): Promise<void> => {
		if (busy) return;
		busy = true;
		try {
			if (await healthy()) {
				failures = 0;
				// 404 = the hub does not know us (fresh hub or aged-out entry): register until accepted
				if ((await beat()) === 404 && (await register()) && !registered) {
					registered = true;
					log(`registered ${opts.name} with the hub at ${base}`);
				}
			} else if (canHub && ++failures >= HEALTH_FAILS) {
				failures = 0;
				clearInterval(timer);
				await becomeHub();
				registered = false;
				timer = setInterval(() => void tick(), tickMs);
			}
		} finally {
			busy = false;
		}
	};

	void (async () => {
		// startup election: no hub answered, so race for the lock; the winner serves the ui,
		// the loser joins the winner's hub. A linked worktree never races: its code can be
		// stale, so it stands down and waits for a hub to register with (000165)
		if (!(await healthy())) {
			if (canHub) await becomeHub();
			else log("no hub answering; linked worktree checkout stands down (the port is not ours to take)");
		}
		timer = setInterval(() => void tick(), tickMs);
		void tick();
	})();
}
