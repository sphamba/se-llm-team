import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kanbanDir, setWorktree, slugWorktree, taskFiles, type Task } from "../kanban.ts";
import { pidAlive } from "../pid.ts";
import { bumpCounter, counterPath, log, readCounter } from "./log.ts";

// consecutive failed auto-pushes before the daemon logs its once-only warning (a success
// resets the count); the per-failure line is easy to miss, the warning names the consequence
const PUSH_WARN_AFTER = 3;
// the board's home ref: a branch is the only git-native carrier (push and clone transfer
// refs/heads/* only), so the board mirrors there and a fresh clone can bootstrap from it
const KANBAN_REF = "refs/heads/meta/kanban";
// the mirror head this process last materialized into the working tree or wrote with
// update-ref: rescan reconciles whenever the branch head differs from it
let lastMirrorHash: string | null = null;
export function git(root: string, args: string[], allowFailure = false): string | null {
	try {
		return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch (err) {
		if (allowFailure) return null;
		log(root, `git ${args.join(" ")} failed: ${err instanceof Error ? err.message : err}`);
		return null;
	}
}

// mirrors board changes onto refs/heads/meta/kanban via plumbing: git hash-object -w for the
// board files, mktree, git commit-tree (parent = current meta/kanban head), git update-ref.
// Never touches the index or working tree, so main history gets no kanban commits. The tree
// is rebuilt from the whole board, so deleted files and disk drift self-heal on the next
// mirror commit.
export function commitKanban(root: string, message: string, files: string[], allowEmpty = false): boolean {
	if (!files.length && !allowEmpty) return false;
	let tree: string;
	try {
		// empty board (removal of the last task): mktree with no entries yields the empty tree
		const blobs = files.length
			? execFileSync("git", ["hash-object", "-w", "--", ...files.map((f) => join(".kanban", f))], {
					cwd: root,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				})
					.trim()
					.split("\n")
			: [];
		const board = execFileSync("git", ["mktree"], {
			cwd: root,
			input: files.map((f, i) => `100644 blob ${blobs[i]}\t${f}\n`).join(""),
			encoding: "utf8",
		}).trim();
		tree = execFileSync("git", ["mktree"], {
			cwd: root,
			input: `040000 tree ${board}\t.kanban\n`,
			encoding: "utf8",
		}).trim();
	} catch {
		return false;
	}
	const parent = git(root, ["rev-parse", "--verify", KANBAN_REF], true);
	// identical tree = board already mirrored: no commit, no push
	if (parent && git(root, ["rev-parse", "--verify", `${parent}^{tree}`], true) === tree) return true;
	const commit = git(root, parent ? ["commit-tree", tree, "-p", parent, "-m", message] : ["commit-tree", tree, "-m", message]);
	if (!commit || git(root, ["update-ref", KANBAN_REF, commit]) === null) return false;
	lastMirrorHash = commit;
	pushMirror(root);
	return true;
}

// serialized in-flight push: the pushes were synchronous, so "consecutive failures" was
// well-defined; the queue keeps that order without blocking the daemon loop
let pushQueue: Promise<void> = Promise.resolve();

// best-effort auto-push of only the board mirror ref, detached: the daemon loop never waits
// on the network (a hanging SSH held the single-threaded sweep for the full 30s cap per
// changed board file). The 30s cap kills a hanging push; results (success/failure count) are
// logged and counted from the child's exit, asynchronously. PUSH_WARN_AFTER consecutive
// failures log a prominent warning once (a success resets the count and the warned marker),
// so a permanently unreachable origin is visible instead of silently defeating the mirror
// and the fresh-clone bootstrap
function pushMirror(root: string): void {
	if (!git(root, ["remote"], true)) return;
	pushQueue = pushQueue.then(() => doPush(root)).catch(() => {});
}

// in-flight push children, killed on daemon exit so a stopped daemon leaves no orphaned
// hanging push behind (the child's kill timer dies with the daemon that spawned it)
const pushChildren = new Set<ReturnType<typeof spawn>>();

// kills the in-flight push children; wired into the daemon's exit hook, which lives in
// main.ts while the queue lives here
export function killPushes(): void {
	for (const child of pushChildren) child.kill("SIGKILL");
}

function doPush(root: string): Promise<void> {
	return new Promise<void>((resolvePush) => {
		let settled = false;
		const finish = (failed: boolean, detail: string) => {
			if (settled) return;
			settled = true;
			pushChildren.delete(child);
			clearTimeout(timer);
			if (!failed) {
				if (readCounter(root, "push-failures") > 0) writeFileSync(counterPath(root, "push-failures"), "0");
				if (readCounter(root, "push-warned") > 0) writeFileSync(counterPath(root, "push-warned"), "0");
			} else {
				log(root, `push of ${KANBAN_REF} failed (non-fatal): ${detail}`);
				// >= plus a warned marker: a stale counter past PUSH_WARN_AFTER never hits equality, and
				// >= alone would warn on every failure past the cap instead of once per streak
				if (bumpCounter(root, "push-failures") >= PUSH_WARN_AFTER && readCounter(root, "push-warned") === 0) {
					writeFileSync(counterPath(root, "push-warned"), "1");
					log(root, `WARNING: auto-push of ${KANBAN_REF} to origin failed ${PUSH_WARN_AFTER} times in a row; the board mirror is not reaching origin and fresh-clone bootstrap cannot work. Check SSH access to origin for the daemon user (known_hosts entry, deploy key). This warning is logged once until a push succeeds.`);
				}
			}
			resolvePush();
		};
		const child = spawn("git", ["push", "origin", "meta/kanban"], { cwd: root, detached: true, stdio: ["ignore", "ignore", "pipe"] });
		pushChildren.add(child);
		child.unref();
		let stderr = "";
		child.stderr?.on("data", (d) => (stderr += d));
		child.stderr?.unref();
		const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
		timer.unref();
		child.on("error", (err) => finish(true, err.message));
		child.on("close", (code) => finish(code !== 0, stderr.trim() || `exit code ${code}`));
	});
}
// removes a task in one operation: delete the file, then commit a whole-board mirror
// snapshot, so the removal reaches refs/heads/meta/kanban and reconcileBoard cannot restore
// it (the tip no longer carries the file). The daemon is the only other mirror writer: a
// sweep mid-flight with a pre-removal board snapshot can re-add the file with its commit, so
// while a daemon runs the tip is checked after a settle delay and the removal retries when
// the file returned. Returns null on success, else a reason string.
export async function removeTask(root: string, file: string): Promise<string | null> {
	const name = file.endsWith(".md") ? file : `${file}.md`;
	if (!taskFiles(root).includes(name)) return `No task ${file}`;
	const hasGit = git(root, ["rev-parse", "--git-dir"], true) !== null;
	rmSync(join(kanbanDir(root), name), { force: true });
	// no git, no mirror and no reconcile: deleting the file is the whole removal
	if (!hasGit) return null;
	let daemonPid = 0;
	try {
		daemonPid = parseInt(readFileSync(join(kanbanDir(root), ".orchestrator.lock"), "utf8").trim(), 10) || 0;
	} catch {
		/* no lock: no daemon runs */
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!commitKanban(root, `kanban: delete ${name}`, taskFiles(root), true)) {
			return `mirror commit for ${name} failed, the board may restore the file: retry`;
		}
		// let a racing in-flight daemon commit land before the tip check
		if (pidAlive(daemonPid)) await new Promise((resolve) => setTimeout(resolve, 1000));
		const onTip = git(root, ["ls-tree", "--name-only", KANBAN_REF, "--", join(".kanban", name)], true);
		if (onTip === null) return "git unavailable, the removal may not be mirrored";
		if (!onTip) return null;
		// a racing sweep re-added the file: the daemon may have restored it to the tree too
		rmSync(join(kanbanDir(root), name), { force: true });
	}
	return `${name} returned to the mirror (a daemon sweep raced the removal): retry`;
}

// board file status relative to the meta/kanban mirror: "??" = not on the mirror yet (new
// task), non-empty = differs from the mirror (changed after its last mirror commit), "" =
// identical; empty when git is missing
export function boardStatus(root: string, files: string[]): Map<string, string> {
	const status = new Map<string, string>();
	if (!files.length) return status;
	if (git(root, ["rev-parse", "--git-dir"], true) === null) return status;
	let mirrored = "";
	try {
		mirrored = execFileSync("git", ["ls-tree", "-r", KANBAN_REF, "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		/* no mirror branch yet: every board file is new */
	}
	let shas: string[];
	try {
		shas = execFileSync("git", ["hash-object", "--", ...files.map((f) => join(".kanban", f))], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
			.trim()
			.split("\n");
	} catch {
		return status;
	}
	const mirror = new Map<string, string>();
	for (const line of mirrored.split("\n")) {
		const m = line.match(/^\S+ blob (\S+)\t(.+)$/);
		if (m) mirror.set(m[2], m[1]);
	}
	files.forEach((f, i) => {
		const path = join(".kanban", f);
		const blob = mirror.get(path);
		status.set(path, blob === undefined ? "??" : blob === shas[i] ? "" : "M");
	});
	return status;
}

// board-feed wait for the extension's orchestrator_wait tool: polls the meta/kanban mirror
// for new kanban: create/done commits. The feed resolves from the git common dir (the main
// checkout's .git even when the session cwd is a task worktree, whose HEAD is pinned at its
// branch tip), so every wait sees the main checkout's board commits from any session cwd.
// Returns the new subjects, or [] on timeout/abort; clamps the timeout to 1-900s.
export async function waitForBoardCommits(cwd: string, timeoutSeconds: number | undefined, signal?: AbortSignal): Promise<string[]> {
	const timeout = Math.min(900, Math.max(1, timeoutSeconds ?? 300)) * 1000;
	const started = Date.now();
	let feedRoot = cwd;
	try {
		const common = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		if (common) feedRoot = dirname(common);
	} catch {
		/* not a git repo: the feed resolution below fails and the wait times out */
	}
	const revParse = () => {
		try {
			return execSync(`git rev-parse ${KANBAN_REF}`, { cwd: feedRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		} catch {
			return "";
		}
	};
	const baseline = revParse();
	while (Date.now() - started < timeout) {
		const head = revParse();
		// no baseline ref at start: the whole mirror appeared during the wait, so all its commits are new
		if (head && head !== baseline) {
			try {
				const subjects = execSync(`git log --format=%s ${baseline ? baseline + ".." : ""}${KANBAN_REF}`, {
					cwd: feedRoot,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				})
					.split("\n")
					.filter((s) => s.startsWith("kanban: done ") || s.startsWith("kanban: create "));
				if (subjects.length) return subjects;
			} catch {
				/* mirror ref vanished, keep waiting */
			}
		}
		const remaining = started + timeout - Date.now();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, Math.min(2000, remaining));
			signal?.addEventListener("abort", () => {
				clearTimeout(timer);
				resolve();
			}, { once: true });
		});
		if (signal?.aborted) break;
	}
	return [];
}
// the worktree board is a symlink to the shared root board; hide it from the
// worktree's git (skip-worktree on the stale tracked entries, per-worktree
// excludesFile for the symlink itself) so merges never carry board changes
function syncBoard(root: string, wtDir: string): void {
	const wtBoard = join(wtDir, ".kanban");
	const target = kanbanDir(root);
	let linked = false;
	try {
		linked = lstatSync(wtBoard).isSymbolicLink() && readlinkSync(wtBoard) === target;
	} catch {
		/* missing, create it */
	}
	if (!linked) {
		rmSync(wtBoard, { recursive: true, force: true });
		try {
			symlinkSync(target, wtBoard);
		} catch (err) {
			log(root, `could not symlink ${wtBoard} to ${target}: ${err instanceof Error ? err.message : err}`);
			return;
		}
	}
	// idempotent: a partial setup (daemon died between steps) is completed here
	for (const path of (git(wtDir, ["ls-files", ".kanban"], true) ?? "").split("\n").filter(Boolean)) {
		git(wtDir, ["update-index", "--skip-worktree", path], true);
	}
	const gitDir = git(wtDir, ["rev-parse", "--absolute-git-dir"], true);
	if (!gitDir) return;
	const excludes = join(gitDir, "wt-excludes");
	if (!existsSync(excludes)) writeFileSync(excludes, ".kanban\n");
	git(wtDir, ["config", "extensions.worktreeConfig", "true"], true);
	git(wtDir, ["config", "--worktree", "core.excludesFile", excludes], true);
}

// whether the mirror branch's ancestry ever carried the file: a local file the tip lacks
// was deleted on the branch when the ancestry touched it, and is an unmirrored in-flight
// write (never committed) when not
function everOnMirror(root: string, file: string): boolean {
	try {
		return execFileSync("git", ["rev-list", "-n", "1", KANBAN_REF, "--", join(".kanban", file)], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim() !== "";
	} catch {
		return false;
	}
}
// materialize refs/heads/meta/kanban into the working-tree .kanban. Files the working tree
// lacks are written from the tip; local files the tip lacks that the last known mirror tree
// had are deleted (external deletions propagate). A local file that exists wins over the
// tip: agents write state and notes into the working tree while only creates and dones
// reach the mirror, so a differing local file is an in-flight write (the mirror cannot tell
// it from a stale copy). Never touches the index. Trigger: only when the branch head moved
// past the head this process last materialized or wrote; our own commits never re-trigger.
export function reconcileBoard(root: string): boolean {
	const head = git(root, ["rev-parse", "--verify", KANBAN_REF], true);
	if (!head || head === lastMirrorHash) return false;
	let out: string;
	try {
		out = execFileSync("git", ["ls-tree", "-r", KANBAN_REF, "--", ".kanban"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return false;
	}
	// the mirror carries flat .md names only (the taskFiles snapshot), so dot-entries and
	// nested paths are skipped exactly as the mirror path skips them
	const tip = new Map<string, string>();
	for (const line of out.split("\n")) {
		const m = line.match(/^\S+ blob (\S+)\t(.+)$/);
		if (!m) continue;
		const name = m[2].replace(/^\.kanban\//, "");
		if (!name.endsWith(".md") || name.includes("/")) continue;
		tip.set(name, m[1]);
	}
	const files = taskFiles(root);
	const local = new Map<string, string>();
	if (files.length) {
		try {
			const shas = execFileSync("git", ["hash-object", "--", ...files.map((f) => join(".kanban", f))], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim().split("\n");
			files.forEach((f, i) => local.set(f, shas[i]));
		} catch {
			return false;
		}
	}
	mkdirSync(kanbanDir(root), { recursive: true });
	let updated = 0;
	let kept = 0;
	for (const [name, blob] of tip) {
		// an existing local file is either equal to the tip or a newer in-flight write:
		// keep it, or a daemon restart reverts the state and notes written since the mirror
		if (local.has(name)) {
			if (local.get(name) !== blob) kept++;
			continue;
		}
		try {
			writeFileSync(
				join(kanbanDir(root), name),
				execFileSync("git", ["cat-file", "blob", blob], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
			);
			updated++;
		} catch {
			/* unreadable entry, skip */
		}
	}
	let deleted = 0;
	let previous: Set<string> | null = null;
	if (lastMirrorHash) {
		try {
			previous = new Set(
				execFileSync("git", ["ls-tree", "-r", lastMirrorHash, "--", ".kanban"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
					.split("\n")
					.map((l) => l.match(/^\S+ blob (\S+)\t(.+)$/))
					.filter((m): m is RegExpMatchArray => !!m)
					.map((m) => m[2].replace(/^\.kanban\//, ""))
					.filter((n) => n.endsWith(".md") && !n.includes("/")),
			);
		} catch {
			previous = null; // force-updated away from the old head: its tree is unreachable
		}
	}
	for (const f of files) {
		if (tip.has(f)) continue;
		if (!(previous?.has(f) || everOnMirror(root, f))) continue;
		try {
			rmSync(join(kanbanDir(root), f));
			deleted++;
		} catch {
			/* undeletable, keep */
		}
	}
	lastMirrorHash = head;
	log(root, `reconciled .kanban to ${head}: ${updated} file(s) updated, ${deleted} deleted${kept ? `, ${kept} in-flight kept` : ""}`);
	return true;
}

// ensures the task's worktree dir exists (creating it with the -b fallback when the branch
// is taken), links the shared board into it and records the worktree on the task;
// null when creation fails
export function ensureWorktree(root: string, task: Task): { wt: string; wtDir: string } | null {
	const wt = task.worktree || slugWorktree(task.name, task.file, task.shortName || undefined);
	const wtDir = join(root, ".worktrees", wt);
	if (!existsSync(wtDir)) {
		if (git(root, ["worktree", "add", join(".worktrees", wt), "-b", wt], true) === null) {
			git(root, ["worktree", "add", join(".worktrees", wt), wt]);
		}
	}
	if (!existsSync(wtDir)) return null;
	syncBoard(root, wtDir);
	setWorktree(root, task, wt);
	return { wt, wtDir };
}

// a fresh clone has an empty .kanban/, a stale working tree can lack branch content and a
// merge that untracks the board may leave files behind on main: the board lives on
// refs/heads/meta/kanban, so seed the mirror ref when missing and reconcile the working tree
// to its tip (missing files materialize, local files that differ win as in-flight writes;
// runs at every startup, idempotent)
export function bootstrapBoard(root: string): void {
	// a fresh non-bare clone carries only the remote-tracking ref, no local branch: seed the
	// mirror branch from it, or the reconcile below returns early (board never materializes)
	// and the first mirror commit is an orphan whose push fails non-fast-forward
	if (git(root, ["rev-parse", "--verify", KANBAN_REF], true) === null) {
		const source = git(root, ["rev-parse", "--verify", "refs/remotes/origin/meta/kanban"], true) !== null
			? "refs/remotes/origin/meta/kanban"
			: git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes/*/meta/kanban"], true)?.split("\n")[0];
		if (source && git(root, ["update-ref", KANBAN_REF, source], true) !== null) {
			log(root, `seeded ${KANBAN_REF} from ${source}`);
		}
	}
	reconcileBoard(root);
}
