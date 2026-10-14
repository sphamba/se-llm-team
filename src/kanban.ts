import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, sep } from "node:path";

export const STATES = [
	"backlog",
	"to-do",
	"doing",
	"to-review",
	"reviewing",
	"to-merge",
	"merging",
	"to-live-test",
	"live-testing",
	"done",
] as const;
export type TaskState = (typeof STATES)[number];
export type Priority = "low" | "medium" | "high" | "critical";
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Scope = "backlog" | "in-progress" | "done";
// sort rank for priority-first boards: critical first, low last; unknown priorities sort after all
export const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const COMPLEXITIES = ["trivial", "simple", "moderate", "complex"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export interface Task {
	file: string;
	name: string;
	shortName: string;
	priority: string;
	state: TaskState;
	worktree: string;
	issuer: string;
	complexity: string;
	blockedBy: string;
	summary: string;
	specs: string;
	notes: string;
	openQuestions: string;
	conflicted: boolean;
}

export interface TaskRef {
	file: string;
	num: number;
	name: string;
	shortName: string;
	priority: string;
	state: TaskState;
	issuer: string;
	complexity: string;
	blockedBy: string;
	summary: string;
	openQuestions: string;
}

const IN_PROGRESS = new Set<TaskState>([
	"to-do",
	"doing",
	"to-review",
	"reviewing",
	"to-merge",
	"merging",
	"to-live-test",
	"live-testing",
]);

export function kanbanDir(root: string): string {
	return join(root, ".kanban");
}

// [main root, worktree name] of a task worktree root, e.g. /repo/.worktrees/fix/1-x ->
// ["/repo", "fix/1-x"]; null when root is not a task worktree (no .worktrees segment)
export function splitWorktreeRoot(root: string): [string, string] | null {
	const parts = root.split(sep);
	const i = parts.indexOf(".worktrees");
	if (i < 1) return null;
	return [parts.slice(0, i).join(sep), parts.slice(i + 1).join(sep)];
}

// whether root is a linked git worktree, decided by git topology, not path segments: a linked
// worktree's git dir is a per-worktree dir, not the common dir. A main checkout, a subdir of
// one, a separate-git-dir checkout and a non-git root all match and stay production, so a
// worktree created anywhere (not just under .worktrees) is caught. Shared by the hub
// candidacy rule and the PM report gate
export function isLinkedWorktree(root: string): boolean {
	try {
		const rev = (arg: string): string =>
			execFileSync("git", ["rev-parse", arg], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		const abs = (out: string): string => (isAbsolute(out) ? out : join(root, out));
		return realpathSync(abs(rev("--git-dir"))) !== realpathSync(abs(rev("--git-common-dir")));
	} catch {
		return false;
	}
}

export function taskFiles(root: string): string[] {
	try {
		return readdirSync(kanbanDir(root))
			.filter((f) => f.endsWith(".md"))
			.sort();
	} catch {
		return [];
	}
}

// leading 6-digit task number; 0 for names without one
export function taskNum(file: string): number {
	const n = parseInt(file.slice(0, 6), 10);
	return Number.isNaN(n) ? 0 : n;
}

// task file name without the .md extension: log handles, pid names, branch labels
export function taskSlug(file: string): string {
	return file.replace(/\.md$/, "");
}

// an unresolved git merge conflict leaves both marker lines in the working-tree file;
// both are required so content that merely mentions one marker does not read as conflicted
function hasConflictMarkers(raw: string): boolean {
	return /^<{7} /m.test(raw) && /^>{7} /m.test(raw);
}

// the four canonical body sections; only these names open or end one. Any other "^# "
// body line is ordinary content of the enclosing section (and is replaced when that
// section is rewritten), so spec text structured as "# 1. ..." stays readable and
// whole-region replaceable
const SECTION_NAMES = ["summary", "specs", "notes", "open questions"] as const;

function sectionName(line: string): string | undefined {
	const h = line.match(/^# (.+)$/);
	if (!h) return undefined;
	const name = h[1].trim().toLowerCase();
	return (SECTION_NAMES as readonly string[]).includes(name) ? name : undefined;
}

// frontmatter attrs + body; null when the frontmatter block is missing
export function splitFrontmatter(raw: string): { attrs: Record<string, string>; body: string } | null {
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return null;
	const attrs: Record<string, string> = {};
	for (const line of m[1].split("\n")) {
		const i = line.indexOf(":");
		if (i < 1) continue;
		let v = line.slice(i + 1).trim();
		if (v.startsWith('"') && v.endsWith('"')) v = decodeAttr(v.slice(1, -1));
		else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
		attrs[line.slice(0, i).trim()] = v;
	}
	return { attrs, body: m[2] };
}

export function parseTask(root: string, file: string): Task {
	const raw = readFileSync(join(kanbanDir(root), file), "utf8");
	const fm = splitFrontmatter(raw);
	const attrs = fm?.attrs ?? {};
	const body = fm?.body ?? raw;
	const sections: Record<string, string> = {};
	let current = "";
	for (const line of body.split("\n")) {
		const name = sectionName(line);
		if (name) {
			current = name;
			sections[name] = "";
		} else if (current) {
			sections[current] += line + "\n";
		}
	}
	const trim = (s?: string) => (s ?? "").trim();
	return {
		file,
		name: attrs.name ?? taskSlug(file),
		shortName: attrs.shortName ?? "",
		priority: attrs.priority ?? "medium",
		state: (STATES as readonly string[]).includes(attrs.state) ? (attrs.state as TaskState) : "backlog",
		worktree: attrs.worktree ?? "",
		issuer: attrs.issuer ?? "user",
		complexity: (COMPLEXITIES as readonly string[]).includes(attrs.complexity) ? attrs.complexity : "moderate",
		blockedBy: attrs.blockedBy ?? "",
		summary: trim(sections["summary"]),
		specs: trim(sections["specs"]),
		notes: trim(sections["notes"]),
		openQuestions: trim(sections["open questions"]),
		// a conflicted file parses bogus values (duplicate keys resolve last-wins, the
		// merged-in side wins); callers must not rewrite or act on it
		conflicted: hasConflictMarkers(raw),
	};
}

// per-role project notes (AGENTS.<role>.md) live beside the tasks in .kanban: the board
// mirror carries them, but they carry no frontmatter and must never parse as tasks; the bare
// AGENTS.md name is board noise too (pi discovers it only in the cwd chain, never here, so
// it would only ever phantom-task)
export const ROLE_NOTES_RE = /^AGENTS(\..+)?\.md$/;
export const roleNotesPath = (root: string, role: string) => join(kanbanDir(root), `AGENTS.${role}.md`);

export function listAll(root: string): Task[] {
	return taskFiles(root)
		.filter((f) => !ROLE_NOTES_RE.test(f))
		.map((f) => parseTask(root, f));
}

export function listTasks(root: string, scope: Scope, priority?: Priority | string): TaskRef[] {
	return listAll(root)
		.filter((t) =>
			scope === "backlog" ? t.state === "backlog" : scope === "done" ? t.state === "done" : IN_PROGRESS.has(t.state),
		)
		.filter((t) => priority === undefined || t.priority === priority)
		.map(({ file, name, shortName, priority, state, issuer, complexity, blockedBy, summary, openQuestions }) => ({ file, num: taskNum(file), name, shortName, priority, state, issuer, complexity, blockedBy, summary, openQuestions }));
}

export function getTask(root: string, file: string): Task | undefined {
	const f = file.endsWith(".md") ? file : `${file}.md`;
	return taskFiles(root).includes(f) ? parseTask(root, f) : undefined;
}

// the task behind the cwd's SPECS.md symlink (the orchestrator re-points it in the worktree
// root before every agent spawn): the readlink target ".kanban/<taskFile>" feeds getTask
// through the linked board. undefined when SPECS.md is missing or not a symlink (a PM
// session in the main checkout, or the links removed after the agent terminated)
export function resolveTaskFromCwd(root: string): Task | undefined {
	let target: string;
	try {
		target = readlinkSync(join(root, "SPECS.md"));
	} catch {
		return undefined;
	}
	return getTask(root, basename(target));
}

// capped at 4 words with the leading type prefix ("feat: " ...) dropped from the slug;
// the task name itself still carries the type word
function slugParts(name: string): { type?: string; words: string[] } {
	const lower = name.toLowerCase();
	const words = lower.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 4);
	const colon = lower.indexOf(":");
	const type = colon > 0 ? lower.slice(0, colon).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean) : [];
	if (!type.length) return { words };
	const short = words.slice(type.length);
	return { type: type.join("-"), words: short.length ? short : words };
}

export function slugFile(name: string): string {
	return slugParts(name).words.join("_");
}

// branch/worktree {typeDir}/{num}-{shortSlug} with the non-padded number from the task file;
// shortName, the creation slug, replaces the name-derived slug when present
export function slugWorktree(name: string, file?: string | number, shortName?: string): string {
	const { type, words } = slugParts(name);
	const slug = shortName || words.join("-");
	const num = typeof file === "number" ? file : file ? parseInt(file, 10) : Number.NaN;
	if (Number.isNaN(num)) return type ? `${type}/${slug}` : slug;
	return `${type ?? "task"}/${num}-${slug}`;
}

function encodeAttr(v: string): string {
	return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function decodeAttr(v: string): string {
	return v.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
}

function serializeFrontmatter(attrs: Record<string, string>): string {
	const lines = Object.entries(attrs).map(([k, v]) => `${k}: "${encodeAttr(v)}"`);
	return `---\n${lines.join("\n")}\n---\n`;
}

// task files this process rewrote (path -> mtimeMs recorded at write time): in the daemon
// process every task-file write is the daemon's own (state transitions, attr rewrites, mirror
// materializations), so the backlog promotion gate skips files whose mtime still matches a
// write made here; a write by any other process (PM session, agent, hand edit) never matches
// and still defers promotion. Role notes are not masked here: the gate skips them separately
// (ROLE_NOTES_RE) regardless of writer
const selfWrites = new Map<string, number>();

export function noteSelfWrite(path: string): void {
	try {
		selfWrites.set(path, statSync(path).mtimeMs);
	} catch {
		/* vanished between write and stat: nothing to mask */
	}
}

// exact mtime match: an unchanged file stats identically later, a rewrite by anyone else
// never does; a stale entry (the file rewritten by another process in between) is dropped
// here, so it cannot mask later edits of a recreated file
export function isSelfWrite(path: string, mtimeMs: number): boolean {
	const at = selfWrites.get(path);
	if (at === undefined) return false;
	if (at === mtimeMs) return true;
	selfWrites.delete(path);
	return false;
}

// Attribute-only rewrite; skips unchanged keys and refuses a conflicted file. Exported for
// the orchestrator's automatic blockedBy maintenance (updateTask would add a needless cycle
// check and board re-read to a pure ref removal).
export function updateAttrs(root: string, task: Task, patch: Record<string, string>): void {
	const path = join(kanbanDir(root), task.file);
	const raw = readFileSync(path, "utf8");
	if (hasConflictMarkers(raw)) throw new Error(`unresolved merge conflict markers in ${task.file}; not rewriting`);
	const fm = splitFrontmatter(raw);
	if (!fm) throw new Error(`no frontmatter in ${task.file}`);
	const changed = Object.entries(patch).filter(([k, v]) => fm.attrs[k] !== v);
	if (!changed.length) return;
	for (const [k, v] of changed) fm.attrs[k] = v;
	writeFileSync(path, serializeFrontmatter(fm.attrs) + fm.body);
	noteSelfWrite(path);
}

export function setState(root: string, task: Task, state: TaskState): void {
	updateAttrs(root, task, { state });
}

// Rewrites only the given body sections; everything else stays byte-for-byte.
function replaceSections(root: string, task: Task, updates: Record<string, string>): void {
	const path = join(kanbanDir(root), task.file);
	const raw = readFileSync(path, "utf8");
	const fm = splitFrontmatter(raw);
	const body = fm?.body ?? raw;
	const lines = body.split("\n");
	const headers: { index: number; name: string }[] = [];
	lines.forEach((line, index) => {
		const name = sectionName(line);
		if (name) headers.push({ index, name });
	});
	const jobs = Object.entries(updates)
		.map(([name, value]) => ({ name, value, header: headers.findLast((h) => h.name === name) }))
		.sort((a, b) => (b.header?.index ?? -1) - (a.header?.index ?? -1));
	const out = [...lines];
	for (const job of jobs) {
		if (!job.header) {
			if (out[out.length - 1] !== "") out.push("");
			const title = job.name[0].toUpperCase() + job.name.slice(1);
			out.push(`# ${title}`, ...job.value.split("\n"), "");
			continue;
		}
		const end = headers.find((h) => h.index > job.header.index)?.index ?? lines.length;
		out.splice(job.header.index + 1, end - job.header.index - 1, ...job.value.split("\n"), "");
	}
	writeFileSync(path, (fm ? raw.slice(0, raw.length - body.length) : "") + out.join("\n"));
}

// "#42, #43" -> [42, 43]; parses refs with or without the leading # and ignores malformed
// parts, matching the orchestrator's promotion gate (blockedByUndone) so the guard checks
// every ref the gate honors
function blockedNums(blockedBy: string): number[] {
	const nums: number[] = [];
	for (const part of blockedBy.split(",")) {
		const num = parseInt(part.trim().replace(/^#/, ""), 10);
		if (num > 0 && !nums.includes(num)) nums.push(num);
	}
	return nums;
}

// direct 2-cycle guard on the shared blockedBy write path: setting "B blocks A" while
// A already blocks B (or a task blocking itself) wedges both tasks forever, since neither
// can be promoted; one-directional pairs, longer chains, stale refs to missing tasks and
// clearing stay allowed
function assertNoBlockCycle(root: string, selfNum: number, blockedBy: string): void {
	if (!blockedBy.trim()) return;
	const tasks = listAll(root);
	for (const ref of blockedNums(blockedBy)) {
		if (ref === selfNum) throw new Error(`cannot set blockedBy: #${selfNum} blocks itself`);
		const blocker = tasks.find((t) => taskNum(t.file) === ref);
		if (blocker && blockedNums(blocker.blockedBy).includes(selfNum))
			throw new Error(`cannot set blockedBy: #${ref} is already blocked by #${selfNum} - #${selfNum} blocks #${ref} and #${ref} blocks #${selfNum} is not allowed`);
	}
}

export function updateTask(
	root: string,
	task: Task,
	patch: { name?: string; priority?: string; complexity?: string; blockedBy?: string; summary?: string; specs?: string; openQuestions?: string },
): void {
	const rawTask = readFileSync(join(kanbanDir(root), task.file), "utf8");
	if (hasConflictMarkers(rawTask)) throw new Error(`unresolved merge conflict markers in ${task.file}; not rewriting`);
	if (!splitFrontmatter(rawTask)) throw new Error(`no frontmatter in ${task.file}`);
	const attrs: Record<string, string> = {};
	if (patch.name !== undefined) attrs.name = patch.name;
	if (patch.priority !== undefined) attrs.priority = patch.priority;
	if (patch.complexity !== undefined) attrs.complexity = patch.complexity;
	if (patch.blockedBy !== undefined) {
		assertNoBlockCycle(root, taskNum(task.file), patch.blockedBy);
		attrs.blockedBy = patch.blockedBy;
	}
	if (Object.keys(attrs).length) updateAttrs(root, task, attrs);
	const sections: Record<string, string> = {};
	if (patch.summary !== undefined) sections.summary = patch.summary;
	if (patch.specs !== undefined) sections.specs = patch.specs;
	if (patch.openQuestions !== undefined) sections["open questions"] = patch.openQuestions;
	if (Object.keys(sections).length) replaceSections(root, task, sections);
}

export function setWorktree(root: string, task: Task, worktree: string): void {
	updateAttrs(root, task, { worktree });
}

// strict creation slug: lowercase letters/digits, single hyphens between words
const SHORTNAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createTask(
	root: string,
	input: { name: string; shortName?: string; priority?: Priority | string; complexity?: string; summary: string; specs?: string; openQuestions?: string; issuer?: string; blockedBy?: string },
): Task {
	const priority = (PRIORITIES as readonly string[]).includes(input.priority as Priority)
		? input.priority
		: "medium";
	const complexity = (COMPLEXITIES as readonly string[]).includes(input.complexity as string)
		? (input.complexity as string)
		: "moderate";
	// issuer is set at creation only and never changed afterwards; anything but "user" or "#<num>" falls back to "user"
	const issuer = input.issuer !== undefined && (input.issuer === "user" || /^#\d+$/.test(input.issuer)) ? input.issuer : "user";
	// shortName is set at creation only: it names the file and the branch, so it cannot change later;
	// anything invalid is rejected, unlike issuer which falls back
	const shortName = input.shortName || undefined;
	if (shortName && !SHORTNAME_RE.test(shortName))
		throw new Error(`invalid shortName "${shortName}": use lowercase letters and digits with single hyphens between words, no leading or trailing hyphen`);
	if (shortName && shortName.split("-").length > 5) throw new Error(`invalid shortName "${shortName}": max 5 hyphen-separated words`);
	const open = (input.openQuestions ?? "").trim();
	const front: Record<string, string> = { name: input.name, priority, state: "backlog", worktree: "", issuer, complexity };
	if (shortName) front.shortName = shortName;
	if (input.blockedBy) front.blockedBy = input.blockedBy;
	const content =
		`${serializeFrontmatter(front)}\n` +
		`# Summary\n${input.summary.trim()}\n\n# Specs\n${(input.specs ?? "").trim()}\n\n# Notes\n` +
		(open ? `\n# Open questions\n${open}\n` : "");
	mkdirSync(kanbanDir(root), { recursive: true });
	// serialize the allocation: wx guards only one exact path, so two creators scanning
	// the same max can otherwise write the same number under different slugs; the lock
	// makes scan+write one critical section. A live holder commits in microseconds.
	const lock = join(kanbanDir(root), ".create.lock");
	// a crashed holder's lock is only stolen after LOCK_STALE_MS, so the give-up window
	// must outlive the threshold: shorter, and a dead holder fails every create for its
	// whole duration instead of being recovered
	const LOCK_STALE_MS = 10_000;
	const lockDeadline = Date.now() + LOCK_STALE_MS + 5_000;
	let locked = false;
	while (!locked && Date.now() < lockDeadline) {
		try {
			writeFileSync(lock, String(process.pid), { flag: "wx" });
			locked = true;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			try {
				// steal a lock left behind by a crashed creator
				if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
			} catch {}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
	if (!locked) throw new Error(`could not lock "${kanbanDir(root)}" for task creation`);
	try {
		for (let attempt = 0; attempt < 10; attempt++) {
			const nums = taskFiles(root).map(taskNum).filter((n) => n > 0);
			const num = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(6, "0");
			// the new task's number is known only here: a stale ref to it (a deleted task's
			// number) or the create's own next number can still form a direct 2-cycle
			if (input.blockedBy) assertNoBlockCycle(root, parseInt(num, 10), input.blockedBy);
			const file = `${num}_${shortName ? shortName.replaceAll("-", "_") : slugFile(input.name)}.md`;
			try {
				writeFileSync(join(kanbanDir(root), file), content, { flag: "wx" });
				// a number claimed under a different basename (hand-written file) between
				// the scan and the write still succeeds; drop our file and retry
				if (taskFiles(root).some((f) => f !== file && taskNum(f) === parseInt(num, 10))) {
					unlinkSync(join(kanbanDir(root), file));
					continue;
				}
				return parseTask(root, file);
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			}
		}
		throw new Error(`could not allocate a task number for "${input.name}" after 10 attempts`);
	} finally {
		unlinkSync(lock);
	}
}
