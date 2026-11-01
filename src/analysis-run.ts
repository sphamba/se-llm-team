// Detached post-run analysis entry: spawnRunAnalysis (src/orchestrator/spawn.ts) spawns this
// file through process.execPath per finished agent run. It loads the project config itself
// (so the daemon's spawn carries only the root, the run log and the role), runs the
// analyst+doctor pipeline on the run's log with the doctor stream persisted next to it, and
// logs the outcome. Best-effort: a failure logs and exits non-zero, the pipeline moves on.
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateChangesMap } from "./changes-map.ts";
import { analyseLog } from "./efficiency-analysis.ts";
import { getTask } from "./kanban.ts";
import { loadConfig, resolveLlm } from "./orchestrator/config.ts";
import { log } from "./orchestrator/log.ts";
import { ensureRoleNotes } from "./orchestrator/context.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// The run a log path names, from the `<slug>.<role>.<n>.log` shape spawnRunAnalysis writes: the
// map attr records the triggering run index, and the slug names the task file.
function runFromLog(path: string, role: string): { slug: string; index: number } | null {
	const base = basename(path).replace(/\.gz$/, "").replace(/\.log$/, "");
	const at = base.lastIndexOf(`.${role}.`);
	const index = at < 0 ? Number.NaN : Number(base.slice(at + role.length + 2));
	return at > 0 && Number.isInteger(index) && index >= 0 ? { slug: base.slice(0, at), index } : null;
}

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
		// #455 the map pass rides this spawn, so the analysis exit marker already limits it to one
		// map per triggering run: no map run on the poll, on /api/tasks or on /api/task-detail
		const run = runFromLog(logArg, role);
		if (run && (role === "developer" || role === "reviewer")) {
			try {
				const task = getTask(root, run.slug);
				if (task) await generateChangesMap({ root, cfg, task, role, run: run.index });
				else log(root, `changes map skipped for ${run.slug}: no such task`);
			} catch (err) {
				// a failed map leaves the previous attr untouched and never fails the analysis
				log(root, `changes map for ${run.slug} failed: ${err instanceof Error ? err.message : err}`);
			}
		}
		// the doctor revises the role file, so it must exist even when no agent spawn created
		// it; the splitter has no role notes, so an analysis for it (unreachable from the
		// pipeline today) can never recreate the file
		if (role !== "splitter") ensureRoleNotes(root, role);
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
			maxNotesBullets: cfg.roles.doctor?.maxNotesBullets,
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
