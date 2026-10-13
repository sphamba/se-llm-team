import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isLinkedWorktree, splitWorktreeRoot } from "./kanban.ts";
import { pidAlive } from "./pid.ts";

// Hub backend: daemons register on spawn, the hub is elected by a lock race, the registry is
// one hub-written file, failover re-elects on hub death, and only the hub serves the ui.
// All timestamps are epoch milliseconds.
export interface HubEntry {
	name: string; // repo basename
	root: string; // project root, the entry identity: two checkouts of one repo share the name
	branch: string; // the root checkout's current branch, resolved live; "" on a detached HEAD
	start: number; // registration time
	lastHeartbeat: number;
}

export interface HubOptions {
	name: string; // repo basename of this daemon's project
	root: string; // this daemon's project root
	host: string; // webUi host from the webUi config block
	port: number | string; // webUi port
	log?: (message: string) => void;
	healthMs?: number; // heartbeat + failover poll + hub reap cadence
	staleMs?: number; // registry age-out for silent entries
	webuiPath?: string; // the reloadable webui module; defaults to the sibling webui.ts
}

type WebuiModule = typeof import("./webui.ts");
const DEFAULT_WEBUI_PATH = fileURLToPath(new URL("./webui.ts", import.meta.url));
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

// static relative import specifiers of one file, for the graph walk below
const RELATIVE_IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

// the webui module graph, walked from webui.ts over its static relative imports (today kanban.ts
// and pid.ts): node: and bare specifiers stay out, they are process-global or resolve against
// the real node_modules
const webuiGraph = (entry: string): string[] => {
	const seen = new Set<string>();
	const walk = (file: string): void => {
		if (seen.has(file)) return;
		seen.add(file);
		let src: string;
		try {
			src = readFileSync(file, "utf8");
		} catch {
			return; // vanished mid-walk: the copy below fails and the last good module serves
		}
		for (const m of src.matchAll(RELATIVE_IMPORT_RE)) {
			const target = resolve(dirname(file), m[1]);
			try {
				if (statSync(target).isFile()) walk(target);
			} catch {
				// unresolvable specifier: the same import fails inside the copy
			}
		}
	};
	walk(entry);
	return [...seen];
};

// the deepest dir every graph file shares: the copy mirrors the graph layout from here, so
// relative imports inside the copy resolve to sibling copies, not the stale cached modules
const commonDir = (files: string[]): string => {
	let prefix = dirname(files[0]).split(sep);
	for (const f of files) {
		const parts = dirname(f).split(sep);
		let n = 0;
		while (n < prefix.length && n < parts.length && prefix[n] === parts[n]) n++;
		prefix = prefix.slice(0, n);
	}
	return prefix.join(sep) || sep;
};

// The webui module (page, rendering, payload builders) reloads when any file in its module graph
// changes: the whole graph is copied into a per-version dir and imported from the copy, so a
// reloaded webui.ts sees fresh sibling modules too and a kanban.ts-only change (e.g. a STATES
// reorder) goes live on browser reload without a daemon restart. The version is the newest
// mtime in the graph. The hub's registry, heartbeats and election stay in this process; only
// the request handlers swap. A vanished or unparseable file serves the last good module, so an
// edit mid-write never blanks the ui. The copy dir is removed after the import: node keeps the
// modules in memory and only a new version needs files on disk (the graph must not dynamic-import
// at call time; keep the dir if it ever does). hub.ts itself still needs a daemon restart to
// reload (upgrade path: an out-of-process webui child).
const webuiLoader = (path: string): (() => Promise<WebuiModule>) => {
	let mod: WebuiModule | undefined;
	let version = -1;
	let failed = -2;
	let graph = [path];
	let pending: Promise<void> | undefined;
	const srcDir = dirname(path);
	// the newest mtime in the whole graph, so a kanban.ts-only change reloads even though
	// webui.ts is unchanged; -1 when a graph file vanished
	const graphMtime = (): number => {
		let max = -1;
		for (const f of graph) {
			try {
				max = Math.max(max, statSync(f).mtimeMs);
			} catch {
				return -1;
			}
		}
		return max;
	};
	// stale .webui-hot dirs from a killed process or a failed copy: sweep on every reload
	const hotSweep = (): void => {
		try {
			for (const d of readdirSync(srcDir)) {
				if (d.startsWith(".webui-hot-")) rmSync(join(srcDir, d), { recursive: true, force: true });
			}
		} catch {
			// srcDir unreadable
		}
	};
	const reload = async (): Promise<void> => {
		const seen = graphMtime();
		if (mod !== undefined && (seen === version || seen === failed)) return;
		let v = seen;
		try {
			graph = webuiGraph(path);
			const base = commonDir(graph);
			v = graphMtime();
			const dir = join(srcDir, `.webui-hot-${process.pid}-${v}`);
			rmSync(dir, { recursive: true, force: true });
			for (const f of graph) {
				const dst = join(dir, relative(base, f));
				mkdirSync(dirname(dst), { recursive: true });
				copyFileSync(f, dst);
			}
			mod = await import(pathToFileURL(join(dir, relative(base, path))).href);
			version = v;
		} catch {
			failed = v; // a broken file at this version: keep the last good module until it changes
		}
		hotSweep();
	};
	return async () => {
		if (pending) await pending;
		else {
			pending = reload().finally(() => {
				pending = undefined;
			});
			await pending;
		}
		if (!mod) throw new Error(`webui module unavailable: ${path}`);
		return mod;
	};
};

const REGISTRY_FILE = "se-llm-team-hub.json";
const LOCK_FILE = "se-llm-team-hub.lock";
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

const piAgentDir = () => join(process.env.HOME || homedir(), ".pi", "agent");
const hubRegistryPath = () => join(piAgentDir(), REGISTRY_FILE);
const hubLockPath = () => join(piAgentDir(), LOCK_FILE);

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

// registry publish, hub only: sibling temp file + rename, so readers never see a partial file
function writeRegistry(entries: HubEntry[]): void {
	const path = hubRegistryPath();
	mkdirSync(piAgentDir(), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(entries, null, "\t") + "\n");
	renameSync(tmp, path);
}

// election lock shared by every daemon in ~/.pi/agent: create-exclusive, stale-pid steal
// (same pattern as the per-project orchestrator lock)
function acquireHubLock(): boolean {
	const lock = hubLockPath();
	mkdirSync(piAgentDir(), { recursive: true });
	try {
		writeFileSync(lock, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		let other = 0;
		try {
			other = parseInt(readFileSync(lock, "utf8").trim(), 10);
		} catch {
			return false; // lock vanished since the wx attempt: a rival holds or released it, stand down
		}
		if (pidAlive(other)) return false;
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

const json = (res: ServerResponse, body: unknown): void => {
	res.writeHead(200, { "content-type": "application/json; charset=utf-8", connection: "close" });
	res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => (data += chunk));
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});

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
	webui: () => Promise<WebuiModule>,
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
		const { PAGE } = await webui();
		// no-cache: a browser reload re-fetches the page instead of serving a stale one
		res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", connection: "close" });
		res.end(PAGE);
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
			json(res, (await webui()).taskPayload(entry.root));
		}
	} else if (req.method === "GET" && path === "/api/agent-log") {
		const entry = resolveEntry(entries, project);
		const payload = entry ? (await webui()).agentLogPayload(entry.root, url.searchParams) : null;
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
		const entry: HubEntry = { name, root, branch, start: Date.now(), lastHeartbeat: Date.now() };
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
	const self: HubEntry = { name: opts.name, root: opts.root, branch: currentBranch(opts.root), start: now, lastHeartbeat: now };
	entries.set(opts.root, self);
	const webui = webuiLoader(opts.webuiPath ?? DEFAULT_WEBUI_PATH);
	const flush = () => writeRegistry([...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
	flush();

	const server = createServer((req, res) => {
		res.on("error", () => {}); // client aborted mid-response
		route(opts, entries, flush, webui, req, res).catch(() => {
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
					body: JSON.stringify({ name: opts.name, root: opts.root, branch: currentBranch(opts.root) }),
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
					body: JSON.stringify({ name: opts.name, root: opts.root, branch: currentBranch(opts.root) }),
					signal: AbortSignal.timeout(REQUEST_TIMEOUT),
				})
			).status;
		} catch {
			return 0;
		}
	};

	// one election attempt: win the lock and serve, or stand down (lock lost or bind failed)
	const becomeHub = async (): Promise<boolean> => {
		if (!acquireHubLock()) {
			log("hub lock held by another daemon, standing down");
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
