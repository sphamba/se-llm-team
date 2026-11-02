// #455 the changes map: one detached pass per completed Developer or Reviewer run reads the
// task branch's diff and asks the `mapper` role for strict JSON, stored in the task's `map` attr.
// The map is display-only, and the attr is the only record left once doneCleanup drops the
// branch, so it carries the 7-char branch head the served `since` count needs.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalystCommand, spawnAnalyst } from "./efficiency-analysis.ts";
import { kanbanDir, updateAttrs, type Task } from "./kanban.ts";
import { claudeAnalystArgs, piLlmFlags } from "./orchestrator/backends.ts";
import { resolveLlm, type Config } from "./orchestrator/config.ts";
import { git } from "./orchestrator/board.ts";
import { log } from "./orchestrator/log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
import { agentAlive } from "./pid.ts";

export type TaskMapKind = "fn" | "class" | "case";
const KINDS: readonly string[] = ["fn", "class", "case"];

export interface TaskMapSymbol {
	name: string;
	kind: TaskMapKind;
	ins: number;
	del: number;
	isNew: boolean;
}

export interface TaskMapFile {
	path: string;
	symbols: TaskMapSymbol[];
}

export interface TaskMapFlow {
	from: string;
	to: string;
	what: string;
}

export interface TaskMap {
	files: TaskMapFile[];
	flows: TaskMapFlow[];
	role: string;
	run: number;
	model: string;
	at: string;
	head: string;
}

type TaskMapContent = Pick<TaskMap, "files" | "flows">;

// the stored size caps: a runaway answer must not bloat the task file the daemon rewrites
const MAX_MAP_FILES = 60;
const MAX_MAP_SYMBOLS = 20;
const MAX_MAP_FLOWS = 30;
// prompt ceiling for the diff text. A bigger diff keeps every changed file's numstat row and
// drops its section, so the model still knows what changed; raise the cap, or page the diff
// through several calls, if a branch outgrows the model's context
const DIFF_CAP = 60_000;

const lines = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// The model answer in the contract shape, or null. Defensive by design: a fence, prose around
// the object, garbage, an unknown kind, a bad count or an oversized map never reaches the task
// file. `note` receives one message per clamp.
export function parseChangesMap(raw: string | undefined, note?: (msg: string) => void): TaskMapContent | null {
	if (!raw) return null;
	let body = raw.trim();
	const fence = body.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (fence) body = fence[1];
	// the outermost object: prose before or after the answer is ignored
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const o = parsed as Record<string, unknown>;
	const files: TaskMapFile[] = [];
	for (const f of Array.isArray(o.files) ? o.files : []) {
		if (!f || typeof f !== "object") continue;
		const fo = f as Record<string, unknown>;
		const path = text(fo.path);
		if (!path) continue; // a file with no path cannot be grouped by the client
		const symbols: TaskMapSymbol[] = [];
		for (const s of Array.isArray(fo.symbols) ? fo.symbols : []) {
			if (!s || typeof s !== "object") continue;
			const so = s as Record<string, unknown>;
			const name = text(so.name);
			const kind = text(so.kind);
			if (!name || !KINDS.includes(kind)) continue;
			symbols.push({ name, kind: kind as TaskMapKind, ins: lines(so.ins), del: lines(so.del), isNew: so.isNew === true });
		}
		files.push({ path, symbols });
	}
	// maps stored before the rename carry the old `transfers` key, so both are read
	const flows: TaskMapFlow[] = [];
	const rawFlows = Array.isArray(o.flows) ? o.flows : Array.isArray(o.transfers) ? o.transfers : [];
	for (const t of rawFlows) {
		if (!t || typeof t !== "object") continue;
		const to = t as Record<string, unknown>;
		const from = text(to.from);
		const dest = text(to.to);
		if (!from || !dest) continue;
		flows.push({ from, to: dest, what: text(to.what) });
	}
	// one note per clamp kind: a 60-file answer would otherwise log a line per file
	const noted = new Set<string>();
	const cap = <T>(list: T[], max: number, what: string): T[] => {
		if (list.length <= max) return list;
		if (!noted.has(what)) {
			noted.add(what);
			note?.(`changes map: clamped ${what} from ${list.length} to ${max}`);
		}
		return list.slice(0, max);
	};
	const capped = files.map((f) => ({ path: f.path, symbols: cap(f.symbols, MAX_MAP_SYMBOLS, "symbols") }));
	return { files: cap(capped, MAX_MAP_FILES, "files"), flows: cap(flows, MAX_MAP_FLOWS, "flows") };
}

// the paths whose diff section the cap cut: their numstat row still tells the model the file
// changed and by how much
function uncappedPaths(diff: string): Set<string> {
	const cut = new Set<string>();
	let used = 0;
	for (const section of diff.split(/\n(?=diff --git )/)) {
		if (used >= DIFF_CAP) {
			const m = section.match(/^diff --git a\/(.+?) b\//);
			if (m) cut.add(m[1]);
		}
		used += section.length + 1;
	}
	return cut;
}

// the prompt template lives beside analyst.md and doctor.md in the package agents/ dir; a
// missing file logs and skips the pass instead of failing the run. Function replacements, so a
// diff containing `$&` cannot corrupt the template.
function mapperPrompt(diff: string, numstat: string): string | null {
	let template: string;
	try {
		template = readFileSync(join(HERE, "..", "agents", "mapper.md"), "utf8").trimEnd();
	} catch {
		return null;
	}
	const cut = diff.length > DIFF_CAP ? uncappedPaths(diff) : new Set<string>();
	const cutNumstat = cut.size
		? "\n\nNumstat of the files the diff cap cut (added, removed, path):\n" + numstat.split("\n").filter((row) => cut.has(row.split("\t")[2] ?? "")).join("\n")
		: "";
	return template
		.replace("{{numstat}}", () => numstat)
		.replace("{{cutNumstat}}", () => cutNumstat)
		.replace("{{diff}}", () => diff.slice(0, DIFF_CAP));
}

// #458 the roles whose analysis run writes the map. A live pid file for any of them means the
// attr write is in flight, so the trigger answers 409 and the served payload flags mapRunning.
// The name shape keys the check: a doctor run streams under `<slug>.<role>.<n>.analysis` of the
// analysed run, carries no task map, and is read from the same pid dir.
const MAP_ROLES = /^(.+)\.(developer|reviewer|mapper)\.\d+\.analysis\.pid$/;

export function mapRunAlive(root: string, slug: string): boolean {
	let names: string[];
	try {
		names = readdirSync(join(kanbanDir(root), ".pids"));
	} catch {
		return false; // no board yet: nothing can be in flight
	}
	return names.some((name) => {
		const m = name.match(MAP_ROLES);
		return !!m && m[1] === slug && agentAlive(root, name.slice(0, -4));
	});
}

// One map pass for one finished run. Best-effort: an absent worktree, a failed git call or an
// unparseable answer logs and leaves the previous attr untouched, and never throws.
export async function generateChangesMap(opts: { root: string; cfg: Config; task: Task; role: string; run: number }): Promise<TaskMap | null> {
	const { root, cfg, task, role, run } = opts;
	const wt = task.worktree ? join(root, ".worktrees", task.worktree) : "";
	if (!wt || !existsSync(wt)) {
		log(root, `changes map skipped for ${task.file}: no worktree for "${task.worktree}"`);
		return null;
	}
	// the base is the root's current branch, and the head is the worktree's HEAD: the range and
	// the head must come from one moment, so both are read before the model runs
	const base = git(root, ["branch", "--show-current"], true);
	const head = git(wt, ["rev-parse", "--short=7", "HEAD"], true);
	const numstat = base ? git(wt, ["diff", "--numstat", `${base}...HEAD`], true) : null;
	const diff = base ? git(wt, ["diff", `${base}...HEAD`], true) : null;
	if (!base || !head || numstat === null || diff === null) {
		log(root, `changes map for ${task.file} skipped: git could not read ${base ?? "the base"}...HEAD in ${wt}`);
		return null;
	}
	const llm = resolveLlm(root, cfg, "mapper", "");
	const prompt = mapperPrompt(diff, numstat);
	if (prompt === null) {
		log(root, `changes map for ${task.file} skipped: agents/mapper.md is missing`);
		return null;
	}
	const argv = cfg.backend === "claude" ? [cfg.agent, ...claudeAnalystArgs(llm, prompt)] : buildAnalystCommand(cfg.agent, piLlmFlags(llm), prompt);
	const answer = await spawnAnalyst(argv, wt);
	const content = parseChangesMap(answer ?? undefined, (msg) => log(root, msg));
	if (!content) {
		log(root, `changes map for ${task.file} failed: no parseable answer for ${role} run ${run}`);
		return null;
	}
	const map: TaskMap = { ...content, role, run, model: llm.model ?? "", at: new Date().toISOString(), head };
	// the daemon writes `changes` and `commits` from another process, so the attr write merges
	// through updateAttrs instead of a hand-written task file
	updateAttrs(root, task, { map: JSON.stringify(map) });
	log(root, `changes map for ${task.file} stored: ${map.files.length} files, ${map.flows.length} flows, head ${head} (${role} run ${run})`);
	return map;
}
