import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kanbanDir, roleNotesPath, taskSlug, type Task } from "../kanban.ts";
import { agentAlive, writePid, pidPath } from "../pid.ts";
import { claudeSpawnArgs, piSpawnArgs } from "./backends.ts";
import { git } from "./board.ts";
import { resolveLlm, type Config } from "./config.ts";
import { log, logPath, nextRunIndex } from "./log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export function renderPrompt(root: string, role: string): string {
	// the agents dir sits two levels up from src/orchestrator/
	let prompt = readFileSync(join(HERE, "..", "..", "agents", `${role}.md`), "utf8");
	// the reviewer's base-branch resolution is the one remaining {{ROOT}} use: it diffs against
	// the branch the project root checkout has checked out. The other roles carry no absolute
	// path: the cwd SPECS.md and AGENTS.md symlinks give them the task and the role notes
	if (role === "reviewer") prompt = prompt.replaceAll("{{ROOT}}", root);
	return prompt;
}
// per-role project notes: .kanban/AGENTS.<role>.md, created when missing with a one-line
// starter header; agents append their project's guidance (how to run, how to live-test) so
// future agents of the role start faster. The AGENTS.md cwd symlink points here, so pi loads
// the file from the session cwd at startup with no spawn flag
export function ensureRoleNotes(root: string, role: string): string {
	const path = roleNotesPath(root, role);
	if (!existsSync(path)) {
		writeFileSync(path, `# ${role}: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.\n`);
	}
	return path;
}

// the two cwd context symlinks the agent session reads at startup: SPECS.md is the task file
// through the linked board, AGENTS.md the role's notes. Re-pointed at every spawn so the
// correct role guidance loads (idempotent: a matching link stays untouched)
export function ensureContextSymlinks(root: string, cwd: string, taskFile: string, role: string): void {
	repointContextSymlink(root, join(cwd, "SPECS.md"), join(".kanban", taskFile));
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
	rmSync(link, { force: true, recursive: true });
	try {
		symlinkSync(target, link);
	} catch (err) {
		log(root, `could not symlink ${link} to ${target}: ${err instanceof Error ? err.message : err}`);
	}
}

// after the agent terminated: remove both context symlinks from the task's worktree, so a
// worktree without a running agent resolves no task (the kanban tools then say so). Hooked
// where the orchestrator clears the agent pid; the done cleanup removes the whole worktree
export function clearContextSymlinks(root: string, task: Task): void {
	if (!task.worktree) return;
	const cwd = join(root, ".worktrees", task.worktree);
	for (const name of ["SPECS.md", "AGENTS.md"]) {
		try {
			const path = join(cwd, name);
			if (lstatSync(path).isSymbolicLink()) rmSync(path);
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
	let notes = "";
	try {
		notes = readFileSync(roleNotesPath(root, role), "utf8");
	} catch {
		/* no role notes yet: the project part alone */
	}
	if (!projectPrompt && !notes.trim()) return null;
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
	ensureRoleNotes(root, role);
	// the cwd symlinks give the session its task (SPECS.md) and role guidance (AGENTS.md) at startup
	ensureContextSymlinks(root, cwd, task.file, role);
	// the project's own AGENTS.md rides as an appended system prompt: the cwd AGENTS.md is the
	// role-notes symlink, so the project's own instructions would otherwise never load
	const projectPrompt = projectAgentsPrompt(root);
	// per-backend argv from the resolved provider/model/thinking triple: pi keeps the
	// byte-identical pre-backend construction (--approve, --mode json, the inline
	// --append-system-prompt), claude swaps in bypassPermissions and stream-json and carries
	// the system prompt as one file ref
	const llm = resolveLlm(root, cfg, role, task.complexity ?? "moderate");
	const prompt = renderPrompt(root, role);
	const agentArgs = cfg.backend === "claude"
		? claudeSpawnArgs(llm, prompt, claudeSystemPromptFile(root, name, role, projectPrompt))
		: piSpawnArgs(llm, projectPrompt, prompt);
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
	// the doctor log exists from the runner's first moment and the report lands at its end,
	// so either present means the run was already analysed or is
	if (existsSync(join(logs, `${base}.analysis.md`)) || existsSync(join(logs, `${base}.doctor.log`))) return;
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
// the slug the current merger was spawned for, next to its pid/exit files: the merger pid
// files are project-wide, so a merging task can outlive its own merger run while another
// task's merger works (or after a daemon restart). The poll matches a merging task against
// this file, so only the task the current merger serves may stall-bounce it or consume its
// exit code; on disk, so the match survives a daemon restart (an in-memory slug would not)
export const mergerSlugPath = (root: string) => join(kanbanDir(root), ".pids", "merger.slug");

export function writeMergerSlug(root: string, slug: string): void {
	mkdirSync(join(kanbanDir(root), ".pids"), { recursive: true });
	writeFileSync(mergerSlugPath(root), `${slug}\n`);
}

export function readMergerSlug(root: string): string | null {
	try {
		return readFileSync(mergerSlugPath(root), "utf8").trim() || null;
	} catch {
		return null;
	}
}

export function clearMergerSlug(root: string): void {
	try {
		rmSync(mergerSlugPath(root));
	} catch {
		/* already gone */
	}
}
