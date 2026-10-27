// Claude Code plugin hook: drains the pending board reports into the session context.
// Runs on SessionStart and UserPromptSubmit (hooks/hooks.json) with cwd set to the
// project directory, the same root the MCP server resolves. Fresh reports (younger than
// REPORT_MAX_AGE_MS) are printed to stdout, which the host adds as context; stale ones
// are dropped, matching the pi extension drain. Zero dependencies, node >= 24.
import { readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPORT_MAX_AGE_MS, canTake, reportsDir } from "../src/orchestrator/report.ts";

// the claim by rename is the race guard, the same atomic approach the pi extension drain
// uses: the daemon writer renames a tmp file into place, so a visible file is complete, and
// a concurrent consumer loses the rename and never double-drains
let dir: string;
let files: string[];
const root = process.cwd();
try {
	dir = reportsDir(root);
	files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
} catch {
	process.exit(0); // no reports dir: nothing pending
}

const now = Date.now();
for (const f of files) {
	const claim = join(dir, `${f}.claiming`);
	try {
		if (now - statSync(join(dir, f)).mtimeMs > REPORT_MAX_AGE_MS) {
			rmSync(join(dir, f));
			continue;
		}
		// no session id here: the hook takes unaddressed and orphaned reports only, and leaves a
		// report addressed to a live owner for that session
		if (!canTake(root, f, null)) continue;
		renameSync(join(dir, f), claim);
	} catch {
		continue; // vanished or claimed mid-drain
	}
	try {
		process.stdout.write(readFileSync(claim, "utf8"));
	} finally {
		rmSync(claim, { force: true });
	}
}
