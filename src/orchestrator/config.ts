import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPLEXITIES } from "../kanban.ts";
import { log } from "./log.ts";

const DEFAULT_POLL_MINUTES = 1;
const DEFAULT_AUTO_SCHEDULE_MINUTES = 5;
// minutes a working agent's log may keep its size before the agent is assumed dead
const DEFAULT_LOG_STALL_MINUTES = 5;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const RESPAWN_CAP = 5;
// final fallback for the per-complexity cap when a Config carries no reviewerCap entry for
// the task's complexity
export const REVIEWER_RUN_CAP = 3;
// per-complexity forced-advance caps: successful reviewer runs before to-review moves on to
// to-merge; each overridable via the top-level reviewerCap config key
const DEFAULT_REVIEWER_CAP: Record<string, number> = { simple: 1, moderate: 2, complex: 3, trivial: 0 };
export interface LlmConfig {
	provider?: string;
	model?: string;
	thinking?: string;
}

// a roles entry may also hold per-complexity sub-objects keyed simple/moderate/complex/trivial, each
// an LlmConfig that overrides the role defaults for tasks of that complexity
export interface RoleLlmConfig extends LlmConfig {
	simple?: LlmConfig;
	moderate?: LlmConfig;
	complex?: LlmConfig;
	trivial?: LlmConfig;
}

export interface Config {
	agent: string;
	pollMinutes: number;
	autoScheduleMinutes: number;
	logStallMinutes: number;
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

export function loadConfig(root: string): Config {
	let cfg: { agent?: string; pollMinutes?: number; autoScheduleMinutes?: number; logStallMinutes?: unknown; provider?: unknown; model?: unknown; thinking?: unknown; roles?: unknown; reviewerCap?: unknown } = {};
	// user-level first, project .kanban/se-llm-team.json overrides it
	for (const path of [join(process.env.HOME ?? "", ".pi", "agent", "se-llm-team.json"), join(root, ".kanban", "se-llm-team.json")]) {
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
			roles[role] = clean;
		}
	}
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
	return {
		agent: cfg.agent ?? "pi",
		pollMinutes: cfg.pollMinutes ?? DEFAULT_POLL_MINUTES,
		autoScheduleMinutes: cfg.autoScheduleMinutes ?? DEFAULT_AUTO_SCHEDULE_MINUTES,
		logStallMinutes,
		llm: cleanLlm(root, cfg, " (global)"),
		roles,
		reviewerCap,
	};
}

// per-field precedence: the role's complexity entry wins over the role default, which wins
// over the global default; an unset field adds no flag. --provider is only valid together
// with --model, so a provider alone is ignored.
export function llmFlags(root: string, cfg: Config, role: string, complexity: string): string[] {
	const roleCfg = cfg.roles[role] ?? {};
	const cxCfg = (roleCfg as Record<string, LlmConfig | undefined>)[complexity] ?? {};
	const provider = cxCfg.provider ?? roleCfg.provider ?? cfg.llm.provider;
	const model = cxCfg.model ?? roleCfg.model ?? cfg.llm.model;
	const thinking = cxCfg.thinking ?? roleCfg.thinking ?? cfg.llm.thinking;
	const flags: string[] = [];
	if (provider && !model) log(root, `provider "${provider}" for role ${role} ignored: --provider requires --model`);
	else if (provider) flags.push("--provider", provider);
	if (model) flags.push("--model", model);
	if (thinking) flags.push("--thinking", thinking);
	return flags;
}

export function parseArgs(argv: string[]): { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean } {
	const args: { root?: string; rescanSeconds?: number; pollMinutes?: number; noWebui?: boolean; compactLogs?: boolean } = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") args.root = resolve(argv[++i]);
		else if (argv[i] === "--rescan-seconds") args.rescanSeconds = Number(argv[++i]);
		else if (argv[i] === "--poll-minutes") args.pollMinutes = Number(argv[++i]);
		else if (argv[i] === "--no-webui") args.noWebui = true;
		else if (argv[i] === "--compact-logs") args.compactLogs = true;
	}
	return args;
}
