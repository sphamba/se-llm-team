import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kanbanDir, taskSlug, type Task } from "../kanban.ts";
import { agentAlive, writePid, pidPath } from "../pid.ts";
import { claudeSpawnArgs, piSpawnArgs } from "./backends.ts";
import { resolveLlm, type Config } from "./config.ts";
import { log, logPath, nextRunIndex } from "./log.ts";
import { ensureContextSymlinks, ensureInfoExclude, ensureRoleNotes, projectAgentsPrompt, readRoleNotes, realpathOrSelf } from "./context.ts";
import { renderPrompt } from "./prompt.ts";

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
	const prompt = renderPrompt(root, role, cfg.logStallMinutes, task.file, rootCwd, cfg.testCommand);
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

const HERE = dirname(fileURLToPath(import.meta.url));

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

// the slug the current project-wide merger was spawned for,
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
