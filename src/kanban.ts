import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STATES = [
	"backlog",
	"to-do",
	"doing",
	"to-review",
	"reviewing",
	"to-live-test",
	"live-testing",
	"done",
] as const;
export type TaskState = (typeof STATES)[number];
export type Priority = "low" | "medium" | "high" | "critical";
export type Scope = "backlog" | "in-progress" | "done";

export interface Task {
	file: string;
	name: string;
	priority: string;
	state: TaskState;
	worktree: string;
	summary: string;
	specs: string;
	notes: string;
	conflicted: boolean;
}

export interface TaskRef {
	file: string;
	name: string;
	summary: string;
}

const IN_PROGRESS = new Set<TaskState>(["to-do", "doing", "to-review", "reviewing", "to-live-test", "live-testing"]);

export function kanbanDir(root: string): string {
	return join(root, ".kanban");
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

// an unresolved git merge conflict leaves both marker lines in the working-tree file;
// both are required so content that merely mentions one marker does not read as conflicted
function hasConflictMarkers(raw: string): boolean {
	return /^<{7} /m.test(raw) && /^>{7} /m.test(raw);
}

export function parseTask(root: string, file: string): Task {
	const raw = readFileSync(join(kanbanDir(root), file), "utf8");
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	const attrs: Record<string, string> = {};
	const body = m ? m[2] : raw;
	if (m) {
		for (const line of m[1].split("\n")) {
			const i = line.indexOf(":");
			if (i < 1) continue;
			let v = line.slice(i + 1).trim();
			if (v.startsWith('"') && v.endsWith('"')) v = decodeAttr(v.slice(1, -1));
			else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
			attrs[line.slice(0, i).trim()] = v;
		}
	}
	const sections: Record<string, string> = {};
	let current = "";
	for (const line of body.split("\n")) {
		const h = line.match(/^# (.+)$/);
		if (h) {
			current = h[1].trim().toLowerCase();
			sections[current] = "";
		} else if (current) {
			sections[current] += line + "\n";
		}
	}
	const trim = (s?: string) => (s ?? "").trim();
	return {
		file,
		name: attrs.name ?? file.replace(/\.md$/, ""),
		priority: attrs.priority ?? "medium",
		state: (STATES as readonly string[]).includes(attrs.state) ? (attrs.state as TaskState) : "backlog",
		worktree: attrs.worktree ?? "",
		summary: trim(sections["summary"]),
		specs: trim(sections["specs"]),
		notes: trim(sections["notes"]),
		// a conflicted file parses bogus values (duplicate keys resolve last-wins, the
		// merged-in side wins); callers must not rewrite or act on it
		conflicted: hasConflictMarkers(raw),
	};
}

export function listAll(root: string): Task[] {
	return taskFiles(root).map((f) => parseTask(root, f));
}

export function listTasks(root: string, scope: Scope): TaskRef[] {
	return listAll(root)
		.filter((t) =>
			scope === "backlog" ? t.state === "backlog" : scope === "done" ? t.state === "done" : IN_PROGRESS.has(t.state),
		)
		.map(({ file, name, summary }) => ({ file, name, summary }));
}

export function getTask(root: string, file: string): Task | undefined {
	const f = file.endsWith(".md") ? file : `${file}.md`;
	return taskFiles(root).includes(f) ? parseTask(root, f) : undefined;
}

export function slugFile(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function slugWorktree(name: string): string {
	const [prefix, rest] = name.toLowerCase().split(/:\s*/);
	const tail = rest === undefined ? prefix.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : `${prefix}/${rest.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
	return tail.replace(/\/+$/g, "");
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

function updateAttrs(root: string, task: Task, patch: Record<string, string>): void {
	const path = join(kanbanDir(root), task.file);
	const raw = readFileSync(path, "utf8");
	if (hasConflictMarkers(raw)) throw new Error(`unresolved merge conflict markers in ${task.file}; not rewriting`);
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) throw new Error(`no frontmatter in ${task.file}`);
	const attrs: Record<string, string> = {};
	for (const line of m[1].split("\n")) {
		const i = line.indexOf(":");
		if (i < 1) continue;
		let v = line.slice(i + 1).trim();
		if (v.startsWith('"') && v.endsWith('"')) v = decodeAttr(v.slice(1, -1));
		else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
		attrs[line.slice(0, i).trim()] = v;
	}
	const changed = Object.entries(patch).filter(([k, v]) => attrs[k] !== v);
	if (!changed.length) return;
	for (const [k, v] of changed) attrs[k] = v;
	writeFileSync(path, serializeFrontmatter(attrs) + m[2]);
}

export function setState(root: string, task: Task, state: TaskState): void {
	updateAttrs(root, task, { state });
}

// Rewrites only the given body sections; everything else stays byte-for-byte.
function replaceSections(root: string, task: Task, updates: Record<string, string>): void {
	const path = join(kanbanDir(root), task.file);
	const raw = readFileSync(path, "utf8");
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	const body = m ? m[2] : raw;
	const lines = body.split("\n");
	const headers: { index: number; name: string }[] = [];
	lines.forEach((line, index) => {
		const h = line.match(/^# (.+)$/);
		if (h) headers.push({ index, name: h[1].trim().toLowerCase() });
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
	writeFileSync(path, (m ? raw.slice(0, raw.length - body.length) : "") + out.join("\n"));
}

export function updateTask(
	root: string,
	task: Task,
	patch: { name?: string; priority?: string; summary?: string; specs?: string },
): void {
	const current = parseTask(root, task.file);
	const rawTask = readFileSync(join(kanbanDir(root), task.file), "utf8");
	if (hasConflictMarkers(rawTask)) throw new Error(`unresolved merge conflict markers in ${task.file}; not rewriting`);
	const m = rawTask.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) throw new Error(`no frontmatter in ${task.file}`);
	const attrs: Record<string, string> = {};
	if (patch.name !== undefined) attrs.name = patch.name;
	if (patch.priority !== undefined) attrs.priority = patch.priority;
	if (Object.keys(attrs).length) updateAttrs(root, task, attrs);
	const sections: Record<string, string> = {};
	if (patch.summary !== undefined) sections.summary = patch.summary;
	if (patch.specs !== undefined) sections.specs = patch.specs;
	if (Object.keys(sections).length) replaceSections(root, task, sections);
}

export function setWorktree(root: string, task: Task, worktree: string): void {
	updateAttrs(root, task, { worktree });
}

export function appendNote(root: string, task: Task, note: string): void {
	const path = join(kanbanDir(root), task.file);
	const raw = readFileSync(path, "utf8");
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
	const entry = `\n- [${stamp}] ${note}`;
	if (/^# Notes$/m.test(raw)) {
		writeFileSync(path, raw.replace(/^(# Notes$)/m, `$1${entry}`));
	} else {
		writeFileSync(path, `${raw.replace(/\s*$/, "")}\n\n# Notes${entry}\n`);
	}
}

export function createTask(
	root: string,
	input: { name: string; priority?: Priority | string; summary: string; specs?: string },
): Task {
	const priority = (["low", "medium", "high", "critical"] as const).includes(input.priority as Priority)
		? input.priority
		: "medium";
	const content =
		`${serializeFrontmatter({ name: input.name, priority, state: "backlog", worktree: "" })}\n` +
		`# Summary\n${input.summary.trim()}\n\n# Specs\n${(input.specs ?? "").trim()}\n\n# Notes\n`;
	mkdirSync(kanbanDir(root), { recursive: true });
	for (let attempt = 0; attempt < 10; attempt++) {
		const nums = taskFiles(root)
			.map((f) => parseInt(f.slice(0, 6), 10))
			.filter((n) => !Number.isNaN(n));
		const num = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(6, "0");
		const file = `${num}_${slugFile(input.name)}.md`;
		try {
			writeFileSync(join(kanbanDir(root), file), content, { flag: "wx" });
			return parseTask(root, file);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
	}
	throw new Error(`could not allocate a task number for "${input.name}" after 10 attempts`);
}
