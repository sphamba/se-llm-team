import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kanbanDir, roleNotesPath, taskSlug, type Task } from "../kanban.ts";
import { agentAlive, writePid, pidPath } from "../pid.ts";
import { claudeSpawnArgs, piSpawnArgs } from "./backends.ts";
import { git } from "./board.ts";
import { resolveLlm, type Config } from "./config.ts";
import { log, logPath, nextRunIndex } from "./log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export function renderPrompt(root: string, role: string, logStallMinutes: number, taskFile?: string, rootCwd?: boolean): string {
	// the agents dir sits two levels up from src/orchestrator/
	let prompt = readFileSync(join(HERE, "..", "..", "agents", `${role}.md`), "utf8");
	// a root-cwd run (the splitter, the integration-tester) shares one root SPECS.md link that a
	// later root-cwd spawn re-points mid-run: name the literal task path instead (#313)
	if (rootCwd && taskFile) prompt = `Task file: \`.kanban/${taskFile}\` in this checkout. The root \`SPECS.md\` is a shared link that another root-cwd spawn can re-point at any time. Read and write the task file only through \`.kanban/${taskFile}\`, and pass \`${taskFile}\` as the \`file\` argument of every kanban_* call.\n\n${prompt}`;
	// the reviewer's base-branch resolution is the one remaining {{ROOT}} use: it diffs against
	// the branch the project root checkout has checked out. The other roles carry no absolute
	// path: the cwd SPECS.md and AGENTS.md symlinks give them the task and the role notes
	if (role === "reviewer") prompt = prompt.replaceAll("{{ROOT}}", root);
	// every role that names the stall window carries the daemon's configured minutes
	prompt = prompt.replaceAll("{{logStallMinutes}}", String(logStallMinutes));
	return prompt;
}
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
function readRoleNotes(root: string, role: string): string | null {
	try {
		const notes = readFileSync(roleNotesPath(root, role), "utf8");
		return notes.trim() ? notes : null;
	} catch {
		return null;
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

function isRealFile(path: string): boolean {
	try {
		return lstatSync(path).isFile();
	} catch {
		return false;
	}
}

function realpathOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
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

// after the agent terminated: remove both context symlinks from the task's cwd (its worktree,
// or the project root for a role that runs there), so a cwd without a running agent resolves no
// task (the kanban tools then say so). Hooked where the orchestrator clears the agent pid; the
// done cleanup removes the whole worktree
export function clearContextSymlinks(root: string, task: Task): void {
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

function projectAgentsPrompt(root: string): string | null {
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

// the exit-code file next to the pid file: the sh wrapper writes it when the agent exits, so
// the code survives a daemon restart and the poll can tell a successful finish from a crash.
// One per pid name (the task slug, or the project-wide "merger") at a time
export const exitFilePath = (root: string, name: string) => join(kanbanDir(root), ".pids", `${name}.exit`);

// the exit code the wrapper recorded, or null when the file is missing or unparseable (the
// wrapper was killed, or never got to write): the poll treats null as a crash
export function readExitCode(root: string, name: string): number | null {
	try {
		const code = parseInt(readFileSync(exitFilePath(root, name), "utf8").trim(), 10);
		return Number.isNaN(code) ? null : code;
	} catch {
		return null;
	}
}

export function clearExitFile(root: string, name: string): void {
	try {
		rmSync(exitFilePath(root, name));
	} catch {
		/* already gone */
	}
}

// claude system-prompt injection: the project AGENTS.md and the role notes concatenated
// into one file next to the pid files, passed as --append-system-prompt-file. One file: the
// claude flag does not repeat, and a file ref avoids the 131,000-byte argv cap that bounds
// pi's inline injection, so the project part keeps the same cap policy as pi and skips with
// a warning above it. Overwritten at every spawn, so stale content never survives
function claudeSystemPromptFile(root: string, name: string, role: string, projectPrompt: string | null): string | null {
	const notes = readRoleNotes(root, role);
	if (!projectPrompt && !notes) return null;
	const path = join(kanbanDir(root), ".pids", `${name}.system-prompt.md`);
	writeFileSync(path, [projectPrompt, notes].filter((part) => part && part.trim()).join("\n\n") + "\n");
	return path;
}

export function spawnAgent(root: string, cfg: Config, role: string, task: Task, cwd: string, pidName?: string): void {
	const slug = taskSlug(task.file);
	const name = pidName ?? slug;
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	// stdout and stderr write the log file directly through an fd the child owns: a pipe read
	// end would live in this daemon, and the daemon's death (stop, restart) would close it and
	// EPIPE-kill the agent's next write. An open file fd survives the daemon, so a restart
	// leaves in-flight agents running and logging; the raw log is compacted at run end
	const fd = openSync(logPath(root, `${slug}.${role}.${nextRunIndex(root, slug, role)}`), "a");
	// one exit file per task at a time: a stale one from a previous run would read as this run's code
	clearExitFile(root, name);
	// the splitter has no role notes: its guidance is the shipped prompt plus the project's
	// own root AGENTS.md, so no .kanban/AGENTS.splitter.md is ever created for it
	if (role !== "splitter") ensureRoleNotes(root, role);
	// the cwd symlinks give the session its task (SPECS.md) and role guidance (AGENTS.md) at startup
	ensureContextSymlinks(root, cwd, task.file, role);
	// hide both context paths from git status, so a blanket git add never commits them
	ensureInfoExclude(root, cwd);
	// the project's own AGENTS.md rides as an appended system prompt: the cwd AGENTS.md is the
	// role-notes symlink, so the project's own instructions would otherwise never load. At the
	// project root (the Splitter) there is no AGENTS.md symlink and no role notes: pi's cwd
	// chain loads the project's own file, so the appended element is omitted there
	const projectPrompt = projectAgentsPrompt(root);
	const rootCwd = realpathOrSelf(cwd) === realpathOrSelf(root);
	const piPrompt = rootCwd ? readRoleNotes(root, role) : projectPrompt;
	// per-backend argv from the resolved provider/model/thinking triple: pi keeps the
	// byte-identical pre-backend construction (--approve, --mode json, the inline
	// --append-system-prompt), claude swaps in bypassPermissions and stream-json and carries
	// the system prompt as one file ref
	const llm = resolveLlm(root, cfg, role, task.complexity ?? "moderate");
	const prompt = renderPrompt(root, role, cfg.logStallMinutes, task.file, rootCwd);
	const agentArgs = cfg.backend === "claude"
		? claudeSpawnArgs(llm, prompt, claudeSystemPromptFile(root, name, role, projectPrompt))
		: piSpawnArgs(llm, piPrompt, prompt);
	// the sh wrapper runs the agent and records its exit code into <name>.exit, so the poll can
	// tell a successful finish (exit 0) from a crash even after a daemon restart. The agent
	// command travels as positional args ($1..), so paths with spaces stay safe; $0 is a dummy
	const exitPath = exitFilePath(root, name);
	const child = spawn("sh", ["-c", `"$@" ; echo $? > "${exitPath}"`, "sh", cfg.agent, ...agentArgs], {
		cwd,
		detached: true,
		stdio: ["ignore", fd, fd],
	});
	closeSync(fd); // the child holds its own dup of the fd from uv_spawn
	child.on("error", (err) => {
		log(root, `agent ${role} for ${task.file} failed to start: ${err.message}`);
	});
	child.unref();
	// a failed spawn (ENOENT) reports no pid; a written 0 reads as the caller's process group
	if (child.pid) {
		// the pid file holds the wrapper's pid: it lives as long as the agent runs, and the
		// poll's kill reaches the whole group (killTree) when a stall or crash needs it
		writePid(root, name, child.pid);
		log(root, `spawned ${role} pid=${child.pid} for ${task.file} (cwd=${cwd})`);
	}
}

// the detached post-run analysis runner: the orchestrator spawns this file through
// process.execPath per finished agent run; it loads the project config itself, so the spawn
// carries only the root, the run log and the role (a reloaded config could lose the daemon's
// --default-agent override, such as a test's stub agent)
const ANALYSIS_RUNNER = join(HERE, "..", "analysis-run.ts");

// Spawn the analyst+doctor analysis on a finished run's log, detached with spawnAgent's sh
// wrapper shape (the runner command as positional args, the exit code into <name>.exit) and
// a pid file under .kanban/.pids/, so a daemon restart neither orphans nor re-triggers it.
// Skips when there is no run log (plain or compacted), when an analysis for the run already
// exists (report or doctor log present) or is in flight: exactly one analysis fires per run
// and the sticky reviewer exit file never re-fires it. Best-effort: a failing analysis
// never affects the pipeline. The run index is the newest log of the role; a negative one
// (only a legacy unsuffixed log) is never analysed.
export function spawnRunAnalysis(root: string, slug: string, role: string): void {
	const n = nextRunIndex(root, slug, role) - 1;
	if (n < 0) return;
	const base = `${slug}.${role}.${n}`;
	const raw = existsSync(logPath(root, base)) ? logPath(root, base) : `${logPath(root, base)}.gz`;
	if (!existsSync(raw)) return;
	const logs = join(kanbanDir(root), ".logs");
	// the doctor log exists from the runner's first moment (plain until the sweep gzips it,
	// 000250) and the report lands at its end, so either present means the run was already
	// analysed or is
	if (existsSync(join(logs, `${base}.analysis.md`)) || existsSync(join(logs, `${base}.doctor.log`)) || existsSync(join(logs, `${base}.doctor.log.gz`))) return;
	if (agentAlive(root, `${base}.analysis`)) return;
	const name = `${base}.analysis`;
	const exitPath = exitFilePath(root, name);
	// one failed attempt per run (#229): a failed analysis leaves only the wrapper's exit
	// file (no report, no doctor log, pid self-removed), so its presence caps the to-merge
	// sweep's respawn loop. A fresh run (new index) keys its own marker, and a manual run
	// bypasses this spawn entirely
	if (existsSync(exitPath)) {
		log(root, `analysis of ${raw} already attempted, skipping respawn (exit marker)`);
		return;
	}
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	// spawnAgent's wrapper extended: the analysis pid file self-removes at exit, so finished
	// analyses leave only the exit file, which keys the one-failed-attempt guard above (the
	// janitor keeps it while the task exists)
	const child = spawn("sh", ["-c", `"$@" ; echo $? > "${exitPath}" ; rm -f "${pidPath(root, name)}"`, "sh", process.execPath, ANALYSIS_RUNNER, root, raw, role], {
		cwd: logs, // the doctor's cwd stays the .logs dir: it edits the role file by absolute path
		detached: true,
		stdio: ["ignore", "ignore", "ignore"],
	});
	child.on("error", (err) => {
		log(root, `analysis of ${raw} failed to start: ${err.message}`);
	});
	child.unref();
	if (child.pid) {
		writePid(root, name, child.pid);
		log(root, `spawned analysis pid=${child.pid} for ${raw}`);
	}
}
// the slug the current project-wide agent (the merger, the integration-tester) was spawned for,
// next to its pid/exit files: those pid files are project-wide, so a task in its lane can outlive
// its own run while another task's run works (or after a daemon restart). The poll matches a lane
// task against this file, so only the task the current run serves may stall-bounce it or consume
// its exit code; on disk, so the match survives a daemon restart (an in-memory slug would not)
export const mergerSlugPath = (root: string, name = "merger") => join(kanbanDir(root), ".pids", `${name}.slug`);

export function writeMergerSlug(root: string, slug: string, name = "merger"): void {
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	writeFileSync(mergerSlugPath(root, name), `${slug}\n`);
}

export function readMergerSlug(root: string, name = "merger"): string | null {
	try {
		return readFileSync(mergerSlugPath(root, name), "utf8").trim() || null;
	} catch {
		return null;
	}
}

export function clearMergerSlug(root: string, name = "merger"): void {
	try {
		rmSync(mergerSlugPath(root, name));
	} catch {
		/* already gone */
	}
}
