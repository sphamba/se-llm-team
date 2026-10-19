import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPLEXITIES } from "../kanban.ts";
import { BACKENDS, type Backend } from "./backends.ts";
import { log } from "./log.ts";

const DEFAULT_POLL_MINUTES = 1;
// board-wide PM quiet window: minutes the whole board must sit untouched before backlog tasks auto-schedule
const DEFAULT_BACKLOG_IDLE_MINUTES = 1;
// per-task retry cooldown: failed-merge retry, respawn past the 5-death cap
const DEFAULT_RETRY_IDLE_MINUTES = 1;
// minutes a working agent's log may keep its size before the agent is assumed dead
const DEFAULT_LOG_STALL_MINUTES = 60;
// global parallelism cap: tasks in a working state (doing, reviewing, merging, live-testing)
// at once; 0 disables the cap
const DEFAULT_MAX_PARALLEL = 0;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const RESPAWN_CAP = 5;
// final fallback for the per-complexity cap when a Config carries no reviewerCap entry for
// the task's complexity
export const REVIEWER_RUN_CAP = 3;
// per-complexity forced-advance caps: successful reviewer runs before to-review moves on to
// to-merge; each overridable via the top-level reviewerCap config key
const DEFAULT_REVIEWER_CAP: Record<string, number> = { trivial: 0, simple: 1, moderate: 2, complex: 3 };
export interface LlmConfig {
	provider?: string;
	model?: string;
	thinking?: string;
}

// a roles entry may also hold per-complexity sub-objects keyed trivial/simple/moderate/complex, each
// an LlmConfig that overrides the role defaults for tasks of that complexity
export interface RoleLlmConfig extends LlmConfig {
	concurrency?: number;
	mergeThreshold?: number;
	trivial?: LlmConfig;
	simple?: LlmConfig;
	moderate?: LlmConfig;
	complex?: LlmConfig;
}

export interface Config {
	agent: string;
	backend: Backend;
	pollMinutes: number;
	backlogIdleMinutes: number;
	retryIdleMinutes: number;
	logStallMinutes: number;
	maxParallel: number;
	llm: LlmConfig;
	roles: Record<string, RoleLlmConfig>;
	reviewerCap: Record<string, number>;
}

// the provider/model/thinking triple of one config object (global or a roles entry); values
// of the wrong type and unknown thinking levels are dropped with a warning, never fatal
function cleanLlm(root: string, entry: unknown, where = ""): LlmConfig {
	const source = (entry ?? {}) as { provider?: unknown; model?: unknown; thinking?: unknown };
	const clean: LlmConfig = {};
	if (typeof source.provider === "string" && source.provider) clean.provider = source.provider;
	if (typeof source.model === "string" && source.model) clean.model = source.model;
	if (source.thinking === undefined) return clean;
	if (typeof source.thinking === "string" && THINKING_LEVELS.includes(source.thinking)) clean.thinking = source.thinking;
	else log(root, `unknown thinking level ${JSON.stringify(source.thinking)}${where}, ignored (expected ${THINKING_LEVELS.join("|")})`);
	return clean;
}

// a non-number or a negative value warns and keeps the default; 0 disables the wait
function idleMinutes(root: string, value: unknown, key: string, fallback: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || value < 0) {
		log(root, `${key} ${JSON.stringify(value)} ignored: must be a non-negative number of minutes`);
		return fallback;
	}
	return value;
}

// 000215: the global config lives in the agent-neutral config dir (XDG when set, else
// ~/.config/se-llm-team); the legacy pi path is a read-only fallback for old setups
const neutralConfigPath = () =>
	join(process.env.XDG_CONFIG_HOME || join(process.env.HOME ?? "", ".config"), "se-llm-team", "se-llm-team.json");
const legacyConfigPath = () => join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json");

// Backend selection: a config agent value that names a backend wins, then the host-passed
// default (--default-agent), then pi. Any other config agent value is an executable override
// (stubs, custom wrappers) and leaves the backend to the host default, with the spawned
// executable staying that override.
export function loadConfig(root: string, defaultAgent?: string): Config {
	let cfg: { agent?: string; pollMinutes?: number; backlogIdleMinutes?: unknown; retryIdleMinutes?: unknown; logStallMinutes?: unknown; maxParallel?: unknown; provider?: unknown; model?: unknown; thinking?: unknown; roles?: unknown; reviewerCap?: unknown } = {};
	// neutral global first, the legacy pi path is a read-only fallback, project .kanban/se-llm-team.json overrides both
	const paths = [neutralConfigPath()];
	if (!existsSync(paths[0])) {
		const legacy = legacyConfigPath();
		if (existsSync(legacy)) {
			log(root, `using the legacy config at ${legacy} (${paths[0]} not found)`);
			paths.push(legacy);
		}
	}
	paths.push(join(root, ".kanban", "se-llm-team.json"));
	for (const path of paths) {
		try {
			cfg = { ...cfg, ...JSON.parse(readFileSync(path, "utf8")) };
		} catch {
			/* optional file */
		}
	}
	const roles: Record<string, RoleLlmConfig> = {};
	if (cfg.roles && typeof cfg.roles === "object" && !Array.isArray(cfg.roles)) {
		for (const [role, entry] of Object.entries(cfg.roles)) {
			const clean: RoleLlmConfig = cleanLlm(root, entry, ` for role "${role}"`);
			// nested complexity sub-objects are cleaned like role entries; a non-object value
			// under those keys warns and is ignored
			const src = (entry ?? {}) as Record<string, unknown>;
			for (const cx of COMPLEXITIES) {
				const v = src[cx];
				if (v === undefined) continue;
				if (v && typeof v === "object" && !Array.isArray(v)) clean[cx] = cleanLlm(root, v, ` for role "${role}" ${cx}`);
				else log(root, `non-object complexity override ${JSON.stringify(v)} for role "${role}" ${cx}, ignored`);
			}
			// the in-flight analysis cap for the role: cleanLlm drops it, so it needs its own
			// parse. A non-integer or non-positive value warns and stays unset, so the module
			// default of 8 applies
			const rawConcurrency = src.concurrency;
			if (rawConcurrency !== undefined) {
				if (typeof rawConcurrency === "number" && Number.isInteger(rawConcurrency) && rawConcurrency > 0) clean.concurrency = rawConcurrency;
				else log(root, `invalid roles.${role}.concurrency ${JSON.stringify(rawConcurrency)}, ignored (expected a positive integer)`);
			}
			// the lead-in merge threshold for the role: cleanLlm drops it, so it needs its own
			// parse. A non-integer or non-positive value warns and stays unset, so the module
			// default of 250 applies
			const rawMergeThreshold = src.mergeThreshold;
			if (rawMergeThreshold !== undefined) {
				if (typeof rawMergeThreshold === "number" && Number.isInteger(rawMergeThreshold) && rawMergeThreshold > 0) clean.mergeThreshold = rawMergeThreshold;
				else log(root, `invalid roles.${role}.mergeThreshold ${JSON.stringify(rawMergeThreshold)}, ignored (expected a positive integer)`);
			}
			roles[role] = clean;
		}
	}
	// backward compat: a pre-rename roles.analyser entry serves as roles.analyst when absent
	if (roles.analyser && !roles.analyst) roles.analyst = roles.analyser;
	const reviewerCap: Record<string, number> = { ...DEFAULT_REVIEWER_CAP };
	if (cfg.reviewerCap && typeof cfg.reviewerCap === "object" && !Array.isArray(cfg.reviewerCap)) {
		for (const cx of COMPLEXITIES) {
			const v = (cfg.reviewerCap as Record<string, unknown>)[cx];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
				log(root, `invalid reviewerCap.${cx} ${JSON.stringify(v)}, ignored (expected an integer >= 0)`);
				continue;
			}
			reviewerCap[cx] = v;
		}
	}
	let logStallMinutes = DEFAULT_LOG_STALL_MINUTES;
	const stall = cfg.logStallMinutes;
	if (stall !== undefined) {
		if (typeof stall !== "number" || stall <= 0) log(root, `logStallMinutes ${JSON.stringify(stall)} ignored: must be a positive number of minutes`);
		else logStallMinutes = stall;
	}
	let maxParallel = DEFAULT_MAX_PARALLEL;
	const mp = cfg.maxParallel;
	if (mp !== undefined) {
		if (typeof mp !== "number" || !Number.isInteger(mp) || mp < 0) log(root, `maxParallel ${JSON.stringify(mp)} ignored: must be an integer >= 0`);
		else maxParallel = mp;
	}
	const configured = typeof cfg.agent === "string" && cfg.agent ? cfg.agent : undefined;
	const backend: Backend = configured && BACKENDS.includes(configured as Backend)
		? (configured as Backend)
		: defaultAgent && BACKENDS.includes(defaultAgent as Backend)
			? (defaultAgent as Backend)
			: "pi";
	if (defaultAgent && !BACKENDS.includes(defaultAgent as Backend)) log(root, `unknown default agent ${JSON.stringify(defaultAgent)}, using pi`);
	return {
		agent: configured ?? backend,
		backend,
		pollMinutes: cfg.pollMinutes ?? DEFAULT_POLL_MINUTES,
		backlogIdleMinutes: idleMinutes(root, cfg.backlogIdleMinutes, "backlogIdleMinutes", DEFAULT_BACKLOG_IDLE_MINUTES),
		retryIdleMinutes: idleMinutes(root, cfg.retryIdleMinutes, "retryIdleMinutes", DEFAULT_RETRY_IDLE_MINUTES),
		logStallMinutes,
		maxParallel,
		llm: cleanLlm(root, cfg, " (global)"),
		roles,
		reviewerCap,
	};
}

// The resolved provider/model/thinking triple for one spawn: per-field precedence, the
// role's complexity entry wins over the role default, which wins over the global default.
// A provider without a model is dropped with a warning (--provider is only valid together
// with --model in pi; the claude backend ignores the provider entirely).
export function resolveLlm(root: string, cfg: Config, role: string, complexity: string): LlmConfig {
	const roleCfg = cfg.roles[role] ?? {};
	const cxCfg = (roleCfg as Record<string, LlmConfig | undefined>)[complexity] ?? {};
	const provider = cxCfg.provider ?? roleCfg.provider ?? cfg.llm.provider;
	const model = cxCfg.model ?? roleCfg.model ?? cfg.llm.model;
	const thinking = cxCfg.thinking ?? roleCfg.thinking ?? cfg.llm.thinking;
	if (provider && !model) log(root, `provider "${provider}" for role ${role} ignored: --provider requires --model`);
	return provider && model ? { provider, model, thinking } : { model, thinking };
}

export function parseArgs(argv: string[]): { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean; defaultAgent?: string } {
	const args: { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean; defaultAgent?: string } = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") args.root = resolve(argv[++i]);
		else if (argv[i] === "--rescan-seconds") args.rescanSeconds = Number(argv[++i]);
		else if (argv[i] === "--poll-minutes") args.pollMinutes = Number(argv[++i]);
		else if (argv[i] === "--no-webui") args.noWebui = true;
		else if (argv[i] === "--compact-logs") args.compactLogs = true;
		else if (argv[i] === "--default-agent") args.defaultAgent = argv[++i];
	}
	return args;
}
