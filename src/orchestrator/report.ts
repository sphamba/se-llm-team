import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kanbanDir, listAll, taskNum, type Task } from "../kanban.ts";
import { log } from "./log.ts";

// 1h delivery cutoff: the extension drain delivers reports younger than this and discards
// older ones; the prune uses the same constant (one knob for "the latest reports")
export const REPORT_MAX_AGE_MS = 3_600_000;

export const reportsDir = (root: string) => join(kanbanDir(root), ".reports");

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
	return `${parts.join("\n")}\n`;
}

// atomic write (tmp file + rename): a partial file is never claimable. The name is a sortable
// timestamp, so lexicographic order is chronological and the extension delivers oldest first
export function writeReport(root: string, content: string): void {
	const dir = reportsDir(root);
	mkdirSync(dir, { recursive: true });
	const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
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

// done tasks this process saw per root: seeded from the first sweep's board snapshot, so an
// already-done task at daemon startup never reports; a task done now but not at the snapshot
// is the sweep's done transition
const lastDone = new Map<string, Set<string>>();

// the rescan hook: the sweep schedules first (promoted passed in), then this detects the done
// transitions against the sweep's own pre-state snapshot and queues one report for them
export function reportDone(root: string, snapshot: Task[], promoted: Task[]): void {
	let seen = lastDone.get(root);
	if (!seen) {
		seen = new Set(snapshot.filter((t) => t.state === "done" && !t.conflicted).map((t) => t.file));
		lastDone.set(root, seen);
	}
	const doneNow = listAll(root).filter((t) => t.state === "done" && !t.conflicted);
	const finished = doneNow.filter((t) => !seen.has(t.file));
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
