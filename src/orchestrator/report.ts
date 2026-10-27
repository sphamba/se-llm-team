import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kanbanDir, listAll, taskNum, taskSlug, type Task } from "../kanban.ts";
import { pidAlive, pidDiscriminator } from "../pid.ts";
import { log } from "./log.ts";

// 1h delivery cutoff: the extension drain delivers reports younger than this and discards
// older ones; the prune uses the same constant (one knob for "the latest reports")
export const REPORT_MAX_AGE_MS = 3_600_000;

export const reportsDir = (root: string) => join(kanbanDir(root), ".reports");

// The session that owns the report queue: orchestrator_start claims it, so the report goes to the
// session that started the pipeline, not to the first root session that looks at the directory
export const ownerPath = (root: string) => join(kanbanDir(root), ".pids", "pm-owner.pid");

// the sid becomes part of a report file name and any process can write the record, so only a
// plain token is usable: no path separator can reach the name
const SID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function writeOwner(root: string, sid: string): void {
	const path = ownerPath(root);
	mkdirSync(dirname(path), { recursive: true });
	// the discriminator makes the liveness check pid-reuse-proof, as the pid files do
	const disc = pidDiscriminator(process.pid);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, disc === null ? `${sid} ${process.pid}` : `${sid} ${process.pid} ${disc}`);
	renameSync(tmp, path);
}

// the owner sid of a live process, or null: a dead pid (or a recycled one), a malformed record
// and an unacceptable sid all read as none, and a stale record is removed
const dropOwner = (path: string) => {
	try {
		rmSync(path, { force: true });
	} catch {
		/* already gone */
	}
};

export function liveOwner(root: string): { sid: string } | null {
	const path = ownerPath(root);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8").trim();
	} catch {
		return null; // no record yet
	}
	const [sid, pidStr, ...rest] = raw.split(/\s+/);
	if (SID_RE.test(sid ?? "") && pidAlive(parseInt(pidStr, 10) || 0, rest.length ? rest.join(" ") : null)) return { sid };
	dropOwner(path);
	return null;
}

// the sid segment of an addressed report name (`<timestamp>.<sid>.md`), null for an unaddressed one
export function reportSid(file: string): string | null {
	const base = file.replace(/\.md$/, "");
	const dot = base.lastIndexOf(".");
	return dot === -1 ? null : base.slice(dot + 1);
}

// one eligibility rule for both consumers, so the extension and the Claude Code hook cannot drift:
// a session takes its own report, an unaddressed one, and anything when no owner is registered;
// a report addressed to another live session stays on disk for that session
export function canTake(root: string, file: string, ownSid: string | null): boolean {
	const sid = reportSid(file);
	return (sid !== null && sid === ownSid) || sid === null || liveOwner(root) === null;
}

// the orchestrator-to-PM channel: on the sweep that moves one or several tasks to done, the
// daemon queues ONE report for the PM session. The extension claims it by rename and sends it
// to the PM chat, so a report must never be seen half-written
const taskLine = (t: Task) => `- ${t.name} (${t.file}${t.shortName ? `, shortName ${t.shortName}` : ""})`;

export function composeReport(root: string, finished: Task[], scheduled: Task[]): string {
	const parts = ["# Board report", "", "## Done", ...finished.map(taskLine)];
	if (scheduled.length) parts.push("", "## Scheduled (promoted to to-do)", ...scheduled.map((t) => `- ${t.name} (${t.file}): ${t.state}`));
	for (const t of finished) {
		parts.push("", `## Live-test findings for ${t.name} (#${taskNum(t.file)})`);
		const findings = listAll(root).filter((f) => f.issuer === `#${taskNum(t.file)}`);
		if (!findings.length) parts.push("none");
		for (const f of findings) parts.push("", `### ${f.name} (${f.file})`, "", `# Open questions`, f.openQuestions || "(none)");
	}
	parts.push("", "## Instructions for the Project manager");
	parts.push('- Create new tasks based on the findings above (kanban_create; issuer "#<num>" of the task whose live test produced the finding).');
	parts.push('- Ask the user every open question above immediately via the structured question dialogs; fold each answer into the finding task\'s Specs with kanban_update, then clear the section (openQuestions: "") so the orchestrator promotes the task.');
	parts.push("- After processing, mark the done tasks processed with kanban_mark_processed, so future PM sessions know they were handled.");
	return `${parts.join("\n")}\n`;
}

// atomic write (tmp file + rename): a partial file is never claimable. The name is a sortable
// timestamp plus the owner sid, so lexicographic order stays chronological and the extension
// delivers oldest first. No live owner leaves the name unaddressed, today's work-stealing name
export function writeReport(root: string, content: string): void {
	const dir = reportsDir(root);
	mkdirSync(dir, { recursive: true });
	const owner = liveOwner(root);
	const name = `${new Date().toISOString().replace(/[:.]/g, "-")}${owner ? `.${owner.sid}` : ""}.md`;
	const tmp = join(dir, `.${name}.tmp`);
	writeFileSync(tmp, content);
	renameSync(tmp, join(dir, name));
	log(root, `queued board report ${name}`);
}

// every sweep: reports and stale claims older than the cutoff are deleted (bounded growth; a
// process death between claim and send is cleaned here too)
export function pruneReports(root: string): void {
	let files: string[];
	try {
		files = readdirSync(reportsDir(root));
	} catch {
		return; // no reports dir yet
	}
	const now = Date.now();
	for (const f of files) {
		try {
			if (now - statSync(join(reportsDir(root), f)).mtimeMs <= REPORT_MAX_AGE_MS) continue;
			rmSync(join(reportsDir(root), f));
		} catch {
			/* vanished mid-prune */
		}
	}
}

// done tasks this process saw per root: the seed sweep seeds from the board snapshot and
// folds in every already-done task without a pm-processed marker (catch-up for a done
// transition missed while the daemon was dead); later sweeps report only new transitions
const lastDone = new Map<string, Set<string>>();

// the rescan hook: the sweep schedules first (promoted passed in), then this detects the done
// transitions against the sweep's own pre-state snapshot and queues one report for them
export function reportDone(root: string, snapshot: Task[], promoted: Task[]): void {
	const known = lastDone.get(root);
	const seen = known ?? new Set(snapshot.filter((t) => t.state === "done" && !t.conflicted).map((t) => t.file));
	if (!known) lastDone.set(root, seen);
	const doneNow = listAll(root).filter((t) => t.state === "done" && !t.conflicted);
	const finished = doneNow.filter((t) => !seen.has(t.file) || (!known && !existsSync(join(kanbanDir(root), ".logs", `${taskSlug(t.file)}.pm-processed`))));
	for (const t of doneNow) seen.add(t.file);
	if (finished.length) {
		try {
			writeReport(root, composeReport(root, finished, promoted));
		} catch (err) {
			log(root, `board report write failed: ${err instanceof Error ? err.message : err}`);
		}
	}
	pruneReports(root);
}
