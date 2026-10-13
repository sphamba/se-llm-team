import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main } from "./orchestrator/index.ts";

// the orchestrator modules live in src/orchestrator/; this facade keeps the old module path
// working for importers and for daemons spawned as this file (tests spawn and symlink this
// exact path), because Node ESM resolves an explicit file path only, never a directory index
export {
	compactFinishedLogs,
	compactLogLine,
	dropDoneBlockers,
	loadConfig,
	main,
	nextRunIndex,
	poll,
	promoteBacklog,
	removeTask,
	waitForBoardCommits,
} from "./orchestrator/index.ts";

// the extension (loaded by jiti) keeps the symlink path in import.meta.url and spawns the
// daemon through it, while plain node resolves symlinks, so the daemon's import.meta.url is
// the real path: compare real paths on both sides or the guard fails under a symlinked
// extension and main() never runs
function isMainEntry(): boolean {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false; // argv[1] or the module path is not an existing file: not the entry point
	}
}

if (isMainEntry()) {
	main(process.argv.slice(2));
}
