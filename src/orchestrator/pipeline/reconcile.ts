import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { kanbanDir, listAll, setState, taskSlug, updateAttrs, type Task } from "../../kanban.ts";
import { agentAlive, pidAlive, pidEntry } from "../../pid.ts";
import { log } from "../log.ts";
import { queueAlert } from "../report.ts";

// the question reconcile: one pass, no memory, the board is the whole state. An open question
// adds the daemon's hold token and the task stops at the next gate; an answered task drops the
// token and continues by itself. The state move skips a live agent, because its exit path moves
// the task, and it never touches backlog or done. A user-held task stays silent: the user hold
// is the PM's own gate, so while it holds, the question gains no token and sends no alert; the
// token and the alert land on the sweep after the PM releases the hold
function reconcileQuestions(root: string): void {
	const asked: Task[] = [];
	for (const task of listAll(root)) {
		if (task.conflicted) continue;
		const parts = task.blockedBy.split(",").map((part) => part.trim()).filter(Boolean);
		const held = parts.some((part) => part.toLowerCase() === "question");
		const userHeld = parts.some((part) => part.toLowerCase() === "user");
		if (task.openQuestions && !held && !userHeld) {
			updateAttrs(root, task, { blockedBy: [...parts, "question"].join(", ") });
			asked.push(task);
			// the merger is the lane's agent, every other state maps to the task's own agent
			const alive = task.state === "merging" ? agentAlive(root, "merger") : agentAlive(root, taskSlug(task.file));
			if (!alive && task.state !== "backlog" && task.state !== "done") {
				setState(root, task, "to-do");
				log(root, `${task.file}: open question, ${task.state} -> to-do`);
			}
		} else if (!task.openQuestions && held) {
			updateAttrs(root, task, { blockedBy: parts.filter((part) => part.toLowerCase() !== "question").join(", ") });
			log(root, `${task.file}: open questions cleared, dropped the question hold`);
		}
	}
	// one report for the pass, not one per task
	if (asked.length) queueAlert(root, { kind: "waiting", tasks: asked });
}

// .pids janitor, one sweep per rescan. Exit-code files the poll never consumed (the task
// vanished mid-run) drop with their name: the next spawn clears its own exit file, so only
// orphaned names are swept here. Stale per-task merger pid leftovers (the old per-task merger
// scheme, e.g. 000038.merger.pid) drop once dead while their task is not merging. The generic
// pid files drop once their reader is done with them (see the branch below). The project-wide
// merger pid is live state for the poll: never swept
function janitorPids(root: string, tasks: Task[]): void {
	const merging = new Set(tasks.filter((t) => t.state === "merging").map((t) => taskSlug(t.file)));
	const slugs = new Set(tasks.map((t) => taskSlug(t.file)));
	const todo = new Set(tasks.filter((t) => t.state === "to-do").map((t) => taskSlug(t.file)));
	let files: string[] = [];
	try {
		files = readdirSync(join(kanbanDir(root), ".pids"));
	} catch {
		return; // no .pids dir yet
	}
	for (const f of files) {
		if (f.endsWith(".exit")) {
			const name = f.slice(0, -".exit".length);
			// "merger.exit" is lane state the poll consumes; a task
			// slug with no board task is an orphan. Per-run analysis exit files
			// (<slug>.<role>.<n>.analysis) key the one-failed-attempt guard (#229): keep them while
			// their task exists, sweep with the task
			if (name === "merger" || slugs.has(name) || slugs.has(name.split(".")[0])) continue;
			try {
				rmSync(join(kanbanDir(root), ".pids", f));
			} catch {
				/* already gone */
			}
			continue;
		}
		// the project-wide merger pid is live state for the poll's merging lane: never swept
		if (f === "merger.pid") continue;
		if (f.endsWith(".merger.pid")) {
			const name = f.slice(0, -".pid".length); // "<slug>.merger"
			if (merging.has(name.slice(0, -".merger".length))) continue;
			const { pid, disc } = pidEntry(root, name);
			if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
		} else if (f.endsWith(".pid")) {
			// generic pid files: per-task agents (<slug>.pid), Splitter agents (<slug>.splitter.pid)
			// and per-run analyses (<slug>.<role>.<n>.analysis.pid). Every live process keeps its
			// file. A dead one goes once its reader is done with it: the poll consumes a board
			// task's per-task pid in every state (exit code, review base marker, dead-streak
			// clear) and clears the file itself; startTodo reads a to-do task's splitter pid as
			// the splitter-ran marker that routes the fallback to the Developer; spawnRunAnalysis
			// reads an analysis pid only while it is alive (the wrapper self-removes its file at
			// exit, a killed analysis leaves it behind)
			const name = f.slice(0, -".pid".length);
			const { pid, disc } = pidEntry(root, name);
			if (pidAlive(pid, disc)) continue; // never remove a running process's pid file
			if (!name.endsWith(".analysis")) {
				const slug = name.endsWith(".splitter") ? name.slice(0, -".splitter".length) : name;
				if (name.endsWith(".splitter") ? todo.has(slug) : slugs.has(slug)) continue;
			}
		} else {
			continue; // not a pid file
		}
		try {
			rmSync(join(kanbanDir(root), ".pids", f));
		} catch {
			/* already gone */
		}
	}
}

export { reconcileQuestions, janitorPids };
