import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { roleNotesPath, type Task } from "../kanban.ts";
import { git } from "./board.ts";
import { log } from "./log.ts";

// per-role project notes: .kanban/AGENTS.<role>.md, created when missing with a starter
// header stating the notes contract: the doctor rewrites the file after every run, keeping
// only durable, task-agnostic bullets, and the role agent never edits it. The AGENTS.md cwd
// symlink points here, so pi loads the file from the session cwd at startup with no spawn flag
export function ensureRoleNotes(root: string, role: string): string {
	const path = roleNotesPath(root, role);
	if (!existsSync(path)) {
		writeFileSync(path, `# ${role}: project guidance for future agents of this role. The doctor rewrites this file after every run, keeping only durable, task-agnostic bullets (repo structure, build/test tips). Never edit this file as the role agent.\n`);
	}
	return path;
}

// the role notes content, or null when the file is missing or empty
export function readRoleNotes(root: string, role: string): string | null {
	try {
		const notes = readFileSync(roleNotesPath(root, role), "utf8");
		return notes.trim() ? notes : null;
	} catch {
		return null;
	}
}

export function realpathOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function isRealFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

function repointContextSymlink(root: string, link: string, target: string): void {
	try {
		if (readlinkSync(link) === target) return;
	} catch {
		/* missing or a real file: re-point */
	}
	try {
		if (lstatSync(link).isDirectory()) {
			log(root, `refusing to replace directory ${link} with the context symlink`);
			return;
		}
	} catch {
		/* missing: nothing to remove */
	}
	if (isRealFile(link) && realpathOrSelf(dirname(link)) === realpathOrSelf(root)) {
		log(root, `refusing to replace the real file ${link} at the project root`);
		return;
	}
	rmSync(link, { force: true, recursive: true });
	try {
		symlinkSync(target, link);
	} catch (err) {
		log(root, `could not symlink ${link} to ${target}: ${err instanceof Error ? err.message : err}`);
	}
}

// the two cwd context symlinks the agent session reads at startup: SPECS.md is the task file
// through the linked board, AGENTS.md the role's notes. Re-pointed at every spawn so the
// correct role guidance loads (idempotent: a matching link stays untouched)
export function ensureContextSymlinks(root: string, cwd: string, taskFile: string, role: string): void {
	repointContextSymlink(root, join(cwd, "SPECS.md"), join(".kanban", taskFile));
	// the Splitter runs at the project root, where a role-notes symlink would shadow the
	// project's own AGENTS.md and poison the projectAgentsPrompt read of every later spawn:
	// no AGENTS.md link at the root; the splitter has no notes file and runs on its shipped
	// prompt plus the project's own root AGENTS.md
	if (realpathOrSelf(cwd) === realpathOrSelf(root)) return;
	// a target project's own tracked AGENTS.md sits where the role-notes symlink must go:
	// skip-worktree hides the replacement from git status (an untracked file cannot be marked;
	// the failure is ignored), then the symlink replaces it
	if (isRealFile(join(cwd, "AGENTS.md"))) git(cwd, ["update-index", "--skip-worktree", "AGENTS.md"], true);
	repointContextSymlink(root, join(cwd, "AGENTS.md"), join(".kanban", `AGENTS.${role}.md`));
}

// fresh projects track neither context path, so the cwd symlinks are untracked and visible to
// a blanket git add -A (fix #234: committed symlinks wedge the merge lane). Hide both in the
// repo's common info/exclude, shared by the main checkout and all linked worktrees. Idempotent:
// append only the missing names. Excludes never affect tracked files, so a project's own
// tracked AGENTS.md keeps its skip-worktree flow. Best-effort: an unwritable info/exclude
// logs and never fails the spawn
export function ensureInfoExclude(root: string, cwd: string): void {
	try {
		const common = git(cwd, ["rev-parse", "--git-common-dir"], true);
		if (!common) return; // no git, nothing to hide from
		const dir = isAbsolute(common) ? common : join(cwd, common);
		mkdirSync(join(dir, "info"), { recursive: true });
		const path = join(dir, "info", "exclude");
		let content = "";
		try {
			content = readFileSync(path, "utf8");
		} catch {
			/* missing: start fresh */
		}
		const have = new Set(content.split("\n").map((l) => l.trim()));
		const missing = ["AGENTS.md", "SPECS.md"].filter((name) => !have.has(name));
		if (!missing.length) return;
		if (content && !content.endsWith("\n")) content += "\n";
		writeFileSync(path, content + missing.join("\n") + "\n");
	} catch (err) {
		log(root, `could not add AGENTS.md and SPECS.md to info/exclude: ${err instanceof Error ? err.message : err}`);
	}
}

// after the agent terminated: remove both context symlinks from the task's cwd (its worktree,
// or the project root for a role that runs there), so a cwd without a running agent resolves no
// task (the kanban tools then say so). Hooked where the orchestrator clears the agent pid; the
// done cleanup removes the whole worktree. The shared root SPECS.md goes only on an explicit
// rootCwd opt-in, from the sites that know the root-cwd run is gone (#335)
export function clearContextSymlinks(root: string, task: Task, opts?: { rootCwd?: boolean }): void {
	if (!task.worktree && !opts?.rootCwd) return;
	const cwd = task.worktree ? join(root, ".worktrees", task.worktree) : root;
	for (const name of ["SPECS.md", "AGENTS.md"]) {
		try {
			const path = join(cwd, name);
			if (!lstatSync(path).isSymbolicLink()) continue;
			// the root link is shared by every root-cwd run, and a live one may have repointed it
			// since this run started: remove it only while it still points at this run's task file
			if (!task.worktree && (name !== "SPECS.md" || readlinkSync(path) !== join(".kanban", task.file))) continue;
			rmSync(path);
		} catch {
			/* already gone */
		}
	}
}

// the target project's own AGENTS.md, injected at every spawn and for every role as an
// appended system prompt: pi loads one context file per directory and the agent cwd's
// AGENTS.md is the role-notes symlink, so the project's own instructions reach agents no
// other way. One argv element, capped below the kernel's 131,072-byte argv limit
// (MAX_ARG_STRLEN); above it the injection skips with one logged warning and the spawn continues
const PROJECT_PROMPT_CAP = 131_000;

export function projectAgentsPrompt(root: string): string | null {
	const path = join(root, "AGENTS.md");
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch {
		return null; // missing: nothing to inject
	}
	if (!content.trim()) return null;
	const bytes = Buffer.byteLength(content);
	if (bytes > PROJECT_PROMPT_CAP) {
		log(root, `skipping ${path} injection: ${bytes} bytes is over the ${PROJECT_PROMPT_CAP}-byte argv cap`);
		return null;
	}
	return content;
}
