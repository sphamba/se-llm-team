// Detached post-run analysis entry: spawnRunAnalysis (src/orchestrator/spawn.ts) spawns this
// file through process.execPath per finished agent run. It loads the project config itself
// (so the daemon's spawn carries only the root, the run log and the role), runs the
// analyst+doctor pipeline on the run's log with the doctor stream persisted next to it, and
// logs the outcome. Best-effort: a failure logs and exits non-zero, the pipeline moves on.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseLog } from "./efficiency-analysis.ts";
import { loadConfig, resolveLlm } from "./orchestrator/config.ts";
import { log } from "./orchestrator/log.ts";
import { ensureRoleNotes } from "./orchestrator/spawn.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const [root, logArg, role] = process.argv.slice(2);
if (!root || !logArg || !role) {
	process.stderr.write("usage: node analysis-run.ts <root> <logPath> <role>\n");
	process.exitCode = 1;
} else {
	const cfg = loadConfig(root);
	// the compactor may gzip the finished log between the spawn and the first read: fall
	// back to the .gz replacement
	const logPath = existsSync(logArg) ? logArg : `${logArg}.gz`;
	try {
		// the doctor revises the role file, so it must exist even when no agent spawn created it
		ensureRoleNotes(root, role);
		await analyseLog(logPath, {
			// the shipped prompt files travel with the package: a per-project agents dir would
			// fail every unattended analysis for projects without the files
			root: join(HERE, ".."),
			agent: cfg.agent,
			backend: cfg.backend,
			llm: resolveLlm(root, cfg, "analyst", ""),
			doctorLlm: resolveLlm(root, cfg, "doctor", ""),
			concurrency: cfg.roles.analyst?.concurrency,
			mergeThreshold: cfg.roles.analyst?.mergeThreshold,
			role,
			roleFile: join(root, ".kanban", `AGENTS.${role}.md`),
			doctorLogPath: `${logArg.replace(/\.log(\.gz)?$/, "")}.doctor.log`,
		});
		log(root, `analysis of ${logPath} complete`);
	} catch (err) {
		log(root, `analysis of ${logArg} failed: ${err instanceof Error ? err.message : err}`);
		process.exitCode = 1;
	}
}
