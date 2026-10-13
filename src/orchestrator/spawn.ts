import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kanbanDir, roleNotesPath, taskSlug, type Task } from "../kanban.ts";
import { writePid } from "../pid.ts";
import { llmFlags, type Config } from "./config.ts";
import { log, logPath, nextRunIndex } from "./log.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export function renderPrompt(root: string, role: string, task: Task, worktreeDir?: string): string {
	// the agents dir sits two levels up from src/orchestrator/
	return readFileSync(join(HERE, "..", "..", "agents", `${role}.md`), "utf8")
		.replaceAll("{{ROOT}}", root)
		.replaceAll("{{TASK_FILE}}", join(kanbanDir(root), task.file))
		.replaceAll("{{WORKTREE}}", worktreeDir ?? "")
		.replaceAll("{{WORKTREE_NAME}}", task.worktree)
		.replaceAll("{{NAME}}", task.name)
		.replaceAll("{{PRIORITY}}", task.priority);
}
// per-role project notes: .kanban/AGENTS.<role>.md, created when missing with a one-line
// starter header; agents append their project's guidance (how to run, how to live-test) so
// future agents of the role start faster. Appended to the system prompt at spawn: pi reads
// the value as file contents when the path exists, and the flag applies to all modes
// including headless --mode json
function ensureRoleNotes(root: string, role: string): string {
	const path = roleNotesPath(root, role);
	if (!existsSync(path)) {
		writeFileSync(path, `# ${role}: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.\n`);
	}
	return path;
}

export function spawnAgent(root: string, cfg: Config, role: string, task: Task, cwd: string, pidName?: string): void {
	const slug = taskSlug(task.file);
	mkdirSync(join(kanbanDir(root), ".logs"), { recursive: true });
	// stdout and stderr write the log file directly through an fd the child owns: a pipe read
	// end would live in this daemon, and the daemon's death (stop, restart) would close it and
	// EPIPE-kill the agent's next write. An open file fd survives the daemon, so a restart
	// leaves in-flight agents running and logging; the raw log is compacted at run end
	const fd = openSync(logPath(root, `${slug}.${role}.${nextRunIndex(root, slug, role)}`), "a");
	// --approve trusts the project-local files of the worktree, so the headless session never waits for a trust prompt;
	// --mode json streams the full JSONL event log (thinking, tool calls, text) instead of print mode's final text only;
	// the provider/model/thinking flags come from the config, resolved per role
	const notesPath = ensureRoleNotes(root, role);
	const child = spawn(cfg.agent, ["--approve", "--mode", "json", ...llmFlags(root, cfg, role, task.complexity ?? "moderate"), "-p", renderPrompt(root, role, task, cwd === root ? undefined : cwd), "--append-system-prompt", notesPath], {
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
		writePid(root, pidName ?? slug, child.pid);
		log(root, `spawned ${role} pid=${child.pid} for ${task.file} (cwd=${cwd})`);
	}
}
// the slug the live merger was spawned for: the merger pid file is project-wide, so a merging
// task can outlive its own merger run while another task's merger works; only the task the
// current merger serves may stall-bounce it, or an old merger log would get the wrong
// process killed
let mergerLogSlug: string | null = null;

export function setMergerLogSlug(slug: string): void {
	mergerLogSlug = slug;
}

export function getMergerLogSlug(): string | null {
	return mergerLogSlug;
}
