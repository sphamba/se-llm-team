import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createTask, kanbanDir, listAll, parseTask, setState, setWorktree, taskNum, taskSlug } from "../../src/kanban.ts";
import { loadConfig, poll } from "../../src/orchestrator.ts";
import { rescan } from "../../src/orchestrator/pipeline.ts";
import { agentAlive, pidAlive, pidPath } from "../../src/pid.ts";
import { exitFilePath, readMergerSlug, renderPrompt, readExitCode } from "../../src/orchestrator/spawn.ts";
import { fixture, mirrorSubjects, roleStub, runDaemon, waitFor, runIdx, cleanupAll, cleaned } from "../helpers.ts";

// --- part G: the to-merge sweep waits for the task's registered agent to die, and the live
// test runs on the merged commit in the worktree ---
const rootG = fixture();
cleaned.push(rootG);
mkdirSync(kanbanDir(rootG), { recursive: true });
// reviewer stub that waits for the armed marker, re-affirms to-review (a fixes run), then
// lingers alive before exiting: the per-complexity cap advance lands while it lingers, so
// the to-merge sweep must wait for its pid. The orchestrator merges once the reviewer
// exits; the live-tester appends its report in the worktree and finishes
const lingerStub = join(rootG, "linger-agent.cjs");
writeFileSync(
	lingerStub,
	`#!/usr/bin/env node
const { readFileSync, writeFileSync, appendFileSync, existsSync, readlinkSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
// the task comes from the cwd SPECS.md symlink, which the orchestrator re-points at spawn
const file = "SPECS.md";
let front = "";
let taskFile = "";
try {
	front = readFileSync(file, "utf8");
	taskFile = readlinkSync(file); // ".kanban/<taskFile>", the real task file through the board
} catch {}
if (!front.match(/^state: /m)) process.exit(0);
const armed = () => join(dirname(taskFile), ".logs", basename(taskFile, ".md") + ".reviewer-armed");
const waitUntil = (cond, ms) => {
	const end = Date.now() + ms;
	while (!cond() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
};
if (prompt.includes("Reviewer agent")) {
	waitUntil(() => existsSync(armed()), 10000);
	writeFileSync(file, readFileSync(file, "utf8").replace(/^state: .*/m, 'state: "to-review"'));
	waitUntil(() => !existsSync(armed()), 10000);
	setTimeout(() => process.exit(0), 3000);
} else if (prompt.includes("Live-tester")) {
	appendFileSync(file, "\\nLive test report: merge deferred until the reviewer finished.\\n");
	process.exit(0);
}
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootG), "se-llm-team.json"), JSON.stringify({ agent: lingerStub, pollMinutes: 0.01, reviewerCap: { moderate: 1 }, backlogIdleMinutes: 0 }));
const taskG = createTask(rootG, { name: "fix: defer merge while alive", summary: "Deferred merge smoke", specs: "n/a" });
setState(rootG, taskG, "to-review");

const g = await runDaemon(rootG);
// "fix: defer merge while alive" caps at 4 words then drops the type word: defer-merge-while
const wtG = join(rootG, ".worktrees", "fix/1-defer-merge-while");
// cap 1: the first successful reviewer run advances the task to to-merge while the reviewer
// still lingers; the merge must wait for its pid
await waitFor(() => parseTask(rootG, taskG.file).state === "to-merge", 30000, "cap advance to to-merge", g.output);
// the stub lingers 3s before exiting, but its node startup eats into that window, so a fixed
// sleep can land after the stub's death and the whole merger chain on a loaded machine. Poll
// until the registered pid is actually dead instead, asserting the defer continuously while
// it lives: every sweep in the window must defer
const livePidG = () => {
	try {
		return parseInt(readFileSync(join(kanbanDir(rootG), ".pids", `${taskG.file.replace(/\.md$/, "")}.pid`), "utf8").trim(), 10);
	} catch {
		return 0; // pid file cleared once the poll saw the agent dead: the defer window is over
	}
};
await waitFor(
	() => {
		if (!pidAlive(livePidG())) return true;
		assert.ok(existsSync(wtG), "worktree kept while the reviewer pid is alive");
		assert.ok(!g.output().includes("fast-forwarded main to fix/1-defer-merge-while, set to-live-test"), "no merge while the reviewer pid is alive");
		assert.ok(!mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), "no done mirror commit while the reviewer pid is alive");
		return false;
	},
	30000,
	"reviewer pid death",
	g.output,
);
// once the reviewer exits, the orchestrator merges, the rescan spawns the live-tester in the
// task worktree, and the done mirror commit folds in the live test report
await waitFor(() => g.output().includes("fast-forwarded main to fix/1-defer-merge-while, set to-live-test"), 30000, "the orchestrator merged after the reviewer died", g.output);
await waitFor(() => g.output().includes("spawned live-tester") && g.output().includes(`(cwd=${wtG})`), 30000, "live-tester runs in the task worktree", g.output);
await waitFor(() => !existsSync(wtG), 30000, "worktree removed at done", g.output);
await waitFor(() => mirrorSubjects(rootG).includes(`kanban: done ${taskG.file}`), 30000, "deferred done mirror commit", g.output);
const committedG = execSync(`git show refs/heads/meta/kanban:.kanban/${taskG.file}`, { cwd: rootG, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedG, /Live test report: merge deferred until the reviewer finished\./, "live test report folded into the done mirror commit");
g.daemon.kill("SIGTERM");

// --- part J: a conflict-marked task file is left untouched until the merger resolves it ---
const rootJ = fixture();
cleaned.push(rootJ);
mkdirSync(kanbanDir(rootJ), { recursive: true });
writeFileSync(join(kanbanDir(rootJ), "se-llm-team.json"), JSON.stringify({ agent: roleStub(rootJ), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskJ = createTask(rootJ, { name: "fix: conflicted task", summary: "Mid-merge conflict", specs: "n/a" });
setState(rootJ, taskJ, "to-do");
// simulate a mid-merge conflict on the task file itself: git leaves both markers in the
// working-tree file, and the merged-in side's state line sits last in the frontmatter
const taskFileJ = join(kanbanDir(rootJ), taskJ.file);
writeFileSync(
	taskFileJ,
	readFileSync(taskFileJ, "utf8").replace(
		/^state: "to-do"$/m,
		'<<<<<<< HEAD\nstate: "done"\n=======\nstate: "to-live-test"\n>>>>>>> fix/other-branch',
	),
);
const rawJ = readFileSync(taskFileJ, "utf8");

const j = await runDaemon(rootJ);
await new Promise((r) => setTimeout(r, 2000)); // a few sweeps and liveness polls
assert.ok(!j.output().includes("spawned developer"), "no agent spawned from a conflicted task file");
assert.ok(j.output().includes("unresolved merge conflict markers"), "daemon logs the skipped conflicted file");
assert.equal(readFileSync(taskFileJ, "utf8"), rawJ, "conflicted task file untouched by the daemon");
j.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip smoke passed");

// --- part K: a conflicting merge spawns the merger in the worktree; its exit requeues to
// to-merge and the retry waits for the idle cooldown ---
const rootK = fixture();
cleaned.push(rootK);
mkdirSync(kanbanDir(rootK), { recursive: true });
// a branch that conflicts with main: both edit README.md
execSync("git checkout -qb fix/conflict", { cwd: rootK, shell: "/bin/bash" });
writeFileSync(join(rootK, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootK, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK, shell: "/bin/bash" });
writeFileSync(join(rootK, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootK, shell: "/bin/bash" });
// merger stub that reads its orders from merger-cmd.txt in its cwd (the task worktree):
// absent -> sleep 1s then exit 0 without resolving, "crash" -> exit 1, "resolve" -> resolve
// with the base branch's side (--ours in a rebase) and continue the replay
writeFileSync(
	join(rootK, "cmd-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync, existsSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch {}
if (!front.match(/^state: /m) || !prompt.includes("Merger agent")) process.exit(0);
const cmd = existsSync("merger-cmd.txt") ? readFileSync("merger-cmd.txt", "utf8").trim() : "";
if (cmd === "crash") process.exit(1);
if (cmd !== "resolve") {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
	process.exit(0);
}
execSync("git checkout --ours README.md && git add -A && GIT_EDITOR=true git rebase --continue", { stdio: "ignore" });
`,
	{ mode: 0o755 },
);
// 0.08min = 4.8s idle cooldown; each merger exit only requeues the task, so the retry fits in the run
writeFileSync(join(kanbanDir(rootK), "se-llm-team.json"), JSON.stringify({ agent: join(rootK, "cmd-merger.cjs"), pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
const taskK = createTask(rootK, { name: "fix: stuck conflict", summary: "Merge cooldown smoke", specs: "n/a" });
setState(rootK, taskK, "to-merge");
setWorktree(rootK, taskK, "fix/conflict");

const k = await runDaemon(rootK);
const slugK = taskK.file.replace(/\.md$/, "");
const wtK = join(rootK, ".worktrees", "fix/conflict");
const spawnedK = () => k.output().split("spawned merger").length - 1;
// the merger pid file clears only after the poll processed its dead pid
const mergerGoneK = () => {
	try {
		return readFileSync(join(kanbanDir(rootK), ".pids", "merger.pid"), "utf8").trim() === "";
	} catch {
		return true;
	}
};
// run 1: no command -> the merger sleeps 1s and exits 0 without resolving; the orchestrator
// left the merge in progress in the worktree and requeues the task on the exit 0
await waitFor(() => spawnedK() === 1, 30000, "first merger spawned", k.output);
assert.ok(k.output().includes(`(cwd=${wtK})`), "the merger spawns in the task worktree");
await waitFor(() => parseTask(rootK, taskK.file).state === "merging", 30000, "task set to merging at spawn", k.output);
assert.match(readFileSync(join(wtK, "README.md"), "utf8"), /^<<<<<<< /m, "the conflicting rebase is left in progress in the worktree");
await waitFor(() => mergerGoneK() && parseTask(rootK, taskK.file).state === "to-merge", 30000, "unresolved merger exit requeued to to-merge", k.output);
assert.ok(k.output().includes("agent exited 0, merging -> to-merge"), "the merger's exit 0 requeued the task");
// run 2: the retry's rebase fails on the in-progress rebase (no fresh rebase while one is
// stopped) and re-takes the merger path; "crash" makes the merger exit 1 and the poll bounces merging -> to-merge
writeFileSync(join(wtK, "merger-cmd.txt"), "crash\n");
await waitFor(() => spawnedK() >= 2, 30000, "merger respawned after the cooldown", k.output);
await waitFor(() => k.output().includes("exited 1 without success, merging -> to-merge"), 30000, "crash bounced the merging task", k.output);
assert.ok(existsSync(join(kanbanDir(rootK), ".pids", `${slugK}.merge-attempted`)), "the merge-attempted marker is written");
// run 3: "resolve" concludes the merge; the retry then merges cleanly and the task reaches done
writeFileSync(join(wtK, "merger-cmd.txt"), "resolve\n");
await waitFor(() => spawnedK() >= 3, 30000, "merger spawned for the resolution", k.output);
await waitFor(
	() => parseTask(rootK, taskK.file).state === "done" && !existsSync(wtK),
	90000,
	"resolved merge reaches done and the worktree is cleaned",
	k.output,
);
// per-run merger logs: the three merger runs got their own indexed files
assert.deepEqual(runIdx(rootK, `${slugK}.merger`), ["0", "1", "2"], "merger runs got indexed log files");
k.daemon.kill("SIGTERM");

// --- part K2: at most one merger runs at a time, even with several tasks in to-merge ---
const rootK2 = fixture();
cleaned.push(rootK2);
mkdirSync(kanbanDir(rootK2), { recursive: true });
// merger stub that sleeps 2.5s before resolving, so an unserialized orchestrator would overlap spawns
writeFileSync(
	join(rootK2, "slow-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const { execSync } = require("node:child_process");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
let front = "";
try { front = readFileSync("SPECS.md", "utf8"); } catch {}
if (!front.match(/^state: /m) || !prompt.includes("Merger agent")) process.exit(0);
setTimeout(() => {
	try {
		execSync("git checkout --ours README.md && git add -A && GIT_EDITOR=true git rebase --continue", { stdio: "ignore" });
	} catch (e) {}
}, 2500);
`,
	{ mode: 0o755 },
);
// 0.08min = 4.8s idle cooldown: each merger exit only requeues the task, so the retries (and
// the done paths) still fit in the run
writeFileSync(join(kanbanDir(rootK2), "se-llm-team.json"), JSON.stringify({ agent: join(rootK2, "slow-merger.cjs"), pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
// two branches that each conflict with main (each edits README.md), main advanced so the
// worktree merges genuinely conflict, and two to-merge tasks
execSync("git checkout -qb feat/merger-one", { cwd: rootK2, shell: "/bin/bash" });
writeFileSync(join(rootK2, "README.md"), "one\n");
execSync("git commit -qam one", { cwd: rootK2, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK2, shell: "/bin/bash" });
execSync("git checkout -qb feat/merger-two", { cwd: rootK2, shell: "/bin/bash" });
writeFileSync(join(rootK2, "README.md"), "two\n");
execSync("git commit -qam two", { cwd: rootK2, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK2, shell: "/bin/bash" });
writeFileSync(join(rootK2, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootK2, shell: "/bin/bash" });
const taskK2a = createTask(rootK2, { name: "feat: merger one", summary: "Single merger smoke", specs: "n/a" });
const taskK2b = createTask(rootK2, { name: "feat: merger two", summary: "Single merger smoke", specs: "n/a" });
setWorktree(rootK2, taskK2a, "feat/merger-one");
setWorktree(rootK2, taskK2b, "feat/merger-two");
setState(rootK2, taskK2a, "to-merge");
setState(rootK2, taskK2b, "to-merge");

const k2 = await runDaemon(rootK2);
const spawnedK2 = () => k2.output().split("spawned merger").length - 1;
await waitFor(() => spawnedK2() === 1, 30000, "first merger spawned", k2.output);
await new Promise((r) => setTimeout(r, 1200));
assert.equal(spawnedK2(), 1, "no second merger while the first runs");
await waitFor(
	() => parseTask(rootK2, taskK2a.file).state === "done"
		&& parseTask(rootK2, taskK2b.file).state === "done"
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-one"))
		&& !existsSync(join(rootK2, ".worktrees", "feat/merger-two")),
	90000,
	"mergers serialized; both tasks reach done and both worktrees are cleaned",
	k2.output,
);
assert.equal(execSync("git log --format=%s --merges main", { cwd: rootK2, encoding: "utf8" }).trim(), "", "no merge commits on main");
k2.daemon.kill("SIGTERM");

// --- part K3: main moves between the rebase and the fast-forward: the post-rewrite hook in
// the shared hooks dir fires after the rebase and advances main, so the fast-forward fails;
// the retry re-runs a fresh rebase onto the moved base and the fast-forward lands before the
// live test runs ---
const rootK3 = fixture();
cleaned.push(rootK3);
mkdirSync(kanbanDir(rootK3), { recursive: true });
// live-tester stub that records which files exist in its cwd (the worktree) and just finishes
writeFileSync(
	join(rootK3, "probe-live.cjs"),
	`#!/usr/bin/env node
const { readFileSync, appendFileSync, existsSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = "SPECS.md";
let front = "";
try { front = readFileSync(file, "utf8"); } catch {}
if (!front.match(/^state: /m)) process.exit(0);
if (prompt.includes("Live-tester")) {
	const files = ["other.txt", "race.txt", "main-only.txt"].filter((f) => existsSync(f)).join(",");
	appendFileSync(file, "\\nLive test report: worktree has " + files + ".\\n");
}
`,
	{ mode: 0o755 },
);
// branch feat/race adds other.txt; main gains main-only.txt before the daemon runs, so the
// rebase genuinely replays the branch commit and fires the post-rewrite hook. The hook
// advances main by committing race.txt at the project root, once and only from a linked
// worktree (git-dir differs from git-common-dir), so the retry's rebase does not re-advance
execSync("git checkout -qb feat/race", { cwd: rootK3, shell: "/bin/bash" });
writeFileSync(join(rootK3, "other.txt"), "other\n");
execSync("git add -A && git commit -qm other", { cwd: rootK3, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK3, shell: "/bin/bash" });
writeFileSync(join(rootK3, "main-only.txt"), "main-only\n");
execSync("git add -A && git commit -qm main-only", { cwd: rootK3, shell: "/bin/bash" });
writeFileSync(
	join(rootK3, ".git", "hooks", "post-rewrite"),
	`#!/bin/sh
# git exports GIT_DIR (the invoking worktree's git dir) into hooks, which would override
# -C discovery and send the commit to the branch instead of main: unset it first
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
common=$(git rev-parse --path-format=absolute --git-common-dir)
dir=$(git rev-parse --path-format=absolute --git-dir)
[ "$common" = "$dir" ] && exit 0
[ -f "$common/race-hook-fired" ] && exit 0
touch "$common/race-hook-fired"
echo race > ${rootK3}/race.txt
git -C ${rootK3} add race.txt
git -C ${rootK3} commit -qm race
`,
	{ mode: 0o755 },
);
writeFileSync(join(kanbanDir(rootK3), "se-llm-team.json"), JSON.stringify({ agent: join(rootK3, "probe-live.cjs"), pollMinutes: 0.01, retryIdleMinutes: 0.08, backlogIdleMinutes: 0 }));
const taskK3 = createTask(rootK3, { name: "feat: base moved", summary: "Base branch race smoke", specs: "n/a" });
setWorktree(rootK3, taskK3, "feat/race");
setState(rootK3, taskK3, "to-merge");

const k3 = await runDaemon(rootK3);
const wtK3 = join(rootK3, ".worktrees", "feat/race");
await waitFor(
	() => parseTask(rootK3, taskK3.file).state === "done" && !existsSync(wtK3) && mirrorSubjects(rootK3).includes(`kanban: done ${taskK3.file}`),
	60000,
	"task done through the moving base",
	k3.output,
);
assert.ok(existsSync(join(rootK3, ".git", "race-hook-fired")), "the post-rewrite hook fired for the rebase");
const committedK3 = execSync(`git show refs/heads/meta/kanban:.kanban/${taskK3.file}`, { cwd: rootK3, encoding: "utf8", shell: "/bin/bash" });
assert.match(committedK3, /Live test report: worktree has other\.txt,race\.txt,main-only\.txt\./, "the live test ran the merged commit (all three files present)");
assert.equal(execSync("git log --format=%s --merges main", { cwd: rootK3, encoding: "utf8" }).trim(), "", "no merge commits on main");
assert.deepEqual(
	execSync("git log --format=%s main", { cwd: rootK3, encoding: "utf8" }).trim().split("\n"),
	["other", "race", "main-only", "init"],
	"main history stays linear with the branch commits replayed on top",
);
k3.daemon.kill("SIGTERM");

// --- part K4: a dirty root checkout refuses the fast-forward before it starts: no rebase
// state is left in progress, the task requeues to to-merge with the attempt marker, no merger
// agent spawns for a refused fast-forward ---
const rootK4 = fixture();
cleaned.push(rootK4);
mkdirSync(kanbanDir(rootK4), { recursive: true });
execSync("git checkout -qb fix/dirty-root", { cwd: rootK4, shell: "/bin/bash" });
writeFileSync(join(rootK4, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootK4, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK4, shell: "/bin/bash" });
// an uncommitted change to the file the branch also edits: the root merge refuses before starting
writeFileSync(join(rootK4, "README.md"), "dirty\n");
writeFileSync(join(rootK4, "noop.cjs"), `#!/usr/bin/env node\n`);
chmodSync(join(rootK4, "noop.cjs"), 0o755);
writeFileSync(join(kanbanDir(rootK4), "se-llm-team.json"), JSON.stringify({ agent: join(rootK4, "noop.cjs"), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskK4 = createTask(rootK4, { name: "fix: dirty root", summary: "Root merge refusal smoke", specs: "n/a" });
setWorktree(rootK4, taskK4, "fix/dirty-root");
setState(rootK4, taskK4, "to-merge");

const k4 = await runDaemon(rootK4);
const slugK4 = taskK4.file.replace(/\.md$/, "");
await waitFor(() => k4.output().includes("fast-forward to main failed, left in to-merge for the retry"), 30000, "the root fast-forward refused and requeued", k4.output);
assert.equal(parseTask(rootK4, taskK4.file).state, "to-merge", "the task stays in to-merge for the retry");
assert.ok(existsSync(join(kanbanDir(rootK4), ".pids", `${slugK4}.merge-attempted`)), "the merge-attempted marker is written");
assert.ok(!existsSync(join(rootK4, ".git", "MERGE_HEAD")), "nothing in progress at the root (the fast-forward never started)");
assert.ok(!existsSync(join(rootK4, ".git", "worktrees", "fix/dirty-root", "rebase-merge")), "no rebase in progress in the worktree");
assert.ok(!k4.output().includes("spawned merger"), "no merger agent for a refused fast-forward");
k4.daemon.kill("SIGTERM");

// --- part K5: a detached root checkout has no branch to merge into: the merge is refused
// before it starts, the task waits in to-merge for the PM, and the worktree is untouched ---
const rootK5 = fixture();
cleaned.push(rootK5);
mkdirSync(kanbanDir(rootK5), { recursive: true });
execSync("git checkout -qb fix/detached-root", { cwd: rootK5, shell: "/bin/bash" });
writeFileSync(join(rootK5, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootK5, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootK5, shell: "/bin/bash" });
execSync("git checkout -q --detach", { cwd: rootK5, shell: "/bin/bash" });
writeFileSync(join(rootK5, "noop.cjs"), `#!/usr/bin/env node\n`);
chmodSync(join(rootK5, "noop.cjs"), 0o755);
writeFileSync(join(kanbanDir(rootK5), "se-llm-team.json"), JSON.stringify({ agent: join(rootK5, "noop.cjs"), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskK5 = createTask(rootK5, { name: "fix: detached root", summary: "Detached root smoke", specs: "n/a" });
setWorktree(rootK5, taskK5, "fix/detached-root");
setState(rootK5, taskK5, "to-merge");

const k5 = await runDaemon(rootK5);
await waitFor(() => k5.output().includes("root checkout is detached, left in to-merge"), 30000, "the detached root refused the merge", k5.output);
assert.equal(parseTask(rootK5, taskK5.file).state, "to-merge", "the task waits in to-merge for the PM");
assert.ok(!k5.output().includes("fast-forwarded") && !k5.output().includes("merged into main"), "nothing was merged");
assert.ok(!k5.output().includes("spawned merger"), "no merger agent for a detached root");
k5.daemon.kill("SIGTERM");

// --- part AL: the merger prompt is rendered for the worktree cwd with the conflict-only contract ---
const rootAL = fixture();
cleaned.push(rootAL);
mkdirSync(kanbanDir(rootAL), { recursive: true });
// the recorder agent writes the rendered prompt into its cwd (the task worktree) and exits
// without resolving: the orchestrator requeues the task and the merge-attempted cooldown
// holds any second spawn (default 1 min), so the recorded prompt is the only merger's
const recorderAL = join(rootAL, "recorder-agent.cjs");
writeFileSync(
	recorderAL,
	`#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
writeFileSync(process.cwd() + "/merger-prompt.txt", prompt);
`,
);
chmodSync(recorderAL, 0o755);
writeFileSync(join(kanbanDir(rootAL), "se-llm-team.json"), JSON.stringify({ agent: recorderAL, pollMinutes: 0.01, backlogIdleMinutes: 0 }));
// a branch that really conflicts with main: both edit README.md, so the rebase stops
// and it is the merger (cwd = the task worktree) that gets the prompt
execSync("git checkout -qb feat/merger-prompt", { cwd: rootAL, shell: "/bin/bash" });
writeFileSync(join(rootAL, "README.md"), "branch\n");
execSync("git commit -qam branch", { cwd: rootAL, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootAL, shell: "/bin/bash" });
writeFileSync(join(rootAL, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootAL, shell: "/bin/bash" });
const taskAL = createTask(rootAL, { name: "fix: merger prompt", summary: "Prompt smoke", specs: "n/a" });
setWorktree(rootAL, taskAL, "feat/merger-prompt");
setState(rootAL, taskAL, "to-merge");

const al = await runDaemon(rootAL);
const wtAL = join(rootAL, ".worktrees", "feat/merger-prompt");
await waitFor(() => existsSync(join(wtAL, "merger-prompt.txt")), 30000, "merger prompt recorded", al.output);
al.daemon.kill("SIGTERM");
const promptAL = readFileSync(join(wtAL, "merger-prompt.txt"), "utf8");
assert.ok(promptAL.includes("Merger agent"), "prompt is the merger's");
assert.ok(promptAL.includes("resolve the conflicts"), "the merger only resolves conflicts");
assert.ok(promptAL.includes("conclude the replayed commit with git rebase --continue"), "the merger concludes with git rebase --continue");
assert.ok(promptAL.includes("never start a rebase or merge yourself"), "the merger starts no merge");
assert.ok(promptAL.includes("never change the task states"), "the merger never changes the task states");
assert.ok(promptAL.includes("run the full test suite in your worktree"), "the merger runs the full suite after the replay");
assert.ok(!promptAL.includes(rootAL) && !promptAL.includes(wtAL), "no absolute path survives rendering");
assert.ok(!promptAL.includes("{{"), "no placeholder survives rendering");
assert.ok(promptAL.includes("git branch --show-current"), "the merger resolves its branch in its cwd");
assert.ok(promptAL.includes("SPECS.md"), "the prompt names the cwd task file symlink");
// the reviewer prompt: step 2 resolves the base branch from the project root checkout (the
// one remaining {{ROOT}} use), no hardcoded main, and no absolute task-file or worktree path
const promptRev = renderPrompt(rootAL, "reviewer", 60);
assert.ok(promptRev.includes(`git -C ${rootAL} branch --show-current`), "the reviewer resolves the base branch from the project root checkout");
assert.ok(!promptRev.includes("git diff main"), "the reviewer diffs no hardcoded main");
assert.ok(!promptRev.includes(join(rootAL, ".kanban")) && !promptRev.includes(".worktrees"), "no absolute task-file or worktree path survives rendering");
assert.ok(!promptRev.includes("{{"), "no placeholder survives rendering");
assert.ok(promptRev.includes("under 60 minutes"), "the reviewer prompt carries the configured stall window");
assert.ok(promptRev.includes("SPECS.md"), "the prompt names the cwd task file symlink");
assert.ok(promptRev.includes("For research or parallel sub-work, use subagents."), "the reviewer prompt carries the developer's subagent line");
// the stripped prompts: only the state setters (splitter, reviewer) keep state knowledge,
// developer/merger/live-tester carry only the ban; no doctor narrative, no AGENTS.md loading
// explanation and no role-notes path anywhere
for (const [role, prompt] of [["developer", renderPrompt(rootAL, "developer", 60)], ["merger", promptAL], ["live-tester", renderPrompt(rootAL, "live-tester", 60)]] as const) {
	assert.ok(prompt.toLowerCase().includes("never change the task states"), `the ${role} prompt bans changing the task states`);
	assert.ok(!prompt.includes("doctor maintains"), `the ${role} prompt carries no doctor-maintains sentence`);
	assert.ok(!prompt.includes("loads into your context"), `the ${role} prompt carries no AGENTS.md loading explanation`);
	assert.ok(!prompt.includes(".kanban/AGENTS"), `the ${role} prompt names no role-notes path`);
}
assert.ok(promptRev.includes("does not fulfill the Specs") && promptRev.includes("move the task back to to-do"), "the reviewer prompt carries the to-do outcome");
assert.ok(!promptRev.includes("doctor maintains"), "the reviewer prompt carries no doctor-maintains sentence");
assert.ok(!promptRev.includes("loads into your context") && !promptRev.includes(".kanban/AGENTS"), "the reviewer prompt carries no loading explanation or role-notes path");
const promptSplitAL = renderPrompt(rootAL, "splitter", 60);
assert.ok(promptSplitAL.includes("Leave every AGENTS.md file untouched"), "the splitter AGENTS.md paragraph is the shortened form");
assert.ok(!promptSplitAL.includes("loads from your cwd") && !promptSplitAL.includes("no per-role notes file"), "the splitter drops the guidance-loading explanation");
assert.ok(!promptSplitAL.includes("symlink"), "the splitter prompt explains no symlink");
console.log("orchestrator.test.ts: ... + merger prompt conflict-only smoke passed");

// --- part AU: 000189 two conflicted to-merge tasks, one merger at a time. The second
// merger's spawn supersedes the first task's unconsumed merger exit (it clears the shared
// exit file), so the poll must requeue the superseded task instead of false-bouncing it: no
// dead marker, no dead-count bump, and the recorded task consumes its own exit 0 ---
const rootAU = fixture();
cleaned.push(rootAU);
const homeAU = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAU);
mkdirSync(kanbanDir(rootAU), { recursive: true });
const savedHomeAU = process.env.HOME;
process.env.HOME = homeAU;
let cfgAU: ReturnType<typeof loadConfig>;
try {
	cfgAU = loadConfig(rootAU);
} finally {
	process.env.HOME = savedHomeAU;
}
// merger stub: no command file in its cwd -> sleeps 1s, exits 0 without resolving, so each
// merger stays alive while the same sweep defers the other task (one merger at a time)
writeFileSync(
	join(rootAU, "au-merger.cjs"),
	`#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const prompt = process.argv[process.argv.indexOf("-p") + 1] ?? "";
const file = (prompt.match(/\\S*\\.kanban\\/\\S*\\.md/) ?? [])[0];
if (!file || !readFileSync(file, "utf8").match(/^state: /m) || !prompt.includes("Merger agent")) process.exit(0);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
`,
	{ mode: 0o755 },
);
cfgAU.agent = join(rootAU, "au-merger.cjs");
// two branches that each conflict with main (both edit README.md), main advanced after both
execSync("git checkout -qb feat/au-one", { cwd: rootAU, shell: "/bin/bash" });
writeFileSync(join(rootAU, "README.md"), "one\n");
execSync("git commit -qam one", { cwd: rootAU, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootAU, shell: "/bin/bash" });
execSync("git checkout -qb feat/au-two", { cwd: rootAU, shell: "/bin/bash" });
writeFileSync(join(rootAU, "README.md"), "two\n");
execSync("git commit -qam two", { cwd: rootAU, shell: "/bin/bash" });
execSync("git checkout -q main", { cwd: rootAU, shell: "/bin/bash" });
writeFileSync(join(rootAU, "README.md"), "main\n");
execSync("git commit -qam main", { cwd: rootAU, shell: "/bin/bash" });
const taskAUa = createTask(rootAU, { name: "fix: merger one", summary: "Misattribution smoke", specs: "n/a" });
const taskAUb = createTask(rootAU, { name: "fix: merger two", summary: "Misattribution smoke", specs: "n/a" });
setWorktree(rootAU, taskAUa, "feat/au-one");
setWorktree(rootAU, taskAUb, "feat/au-two");
setState(rootAU, taskAUa, "to-merge");
setState(rootAU, taskAUb, "to-merge");
const slugAUa = taskSlug(taskAUa.file);
const slugAUb = taskSlug(taskAUb.file);
const orchLogAU = () => readFileSync(join(kanbanDir(rootAU), ".logs", "orchestrator.log"), "utf8");
// sweep 1: the first task's merger takes the global pid/exit pair; the second task defers
rescan(rootAU, cfgAU);
assert.equal(parseTask(rootAU, taskAUa.file).state, "merging", "the first task sits in merging");
await waitFor(() => readExitCode(rootAU, "merger") === 0 && !agentAlive(rootAU, "merger"), 15000, "the first merger exited 0", () => "");
// sweep 2, before any poll consumed the first exit: the second task's merger spawns and
// clobbers the shared pair (clearExitFile + writePid), superseding the first task
rescan(rootAU, cfgAU);
assert.equal(readMergerSlug(rootAU), slugAUb, "the second merger's spawn recorded its own slug");
await waitFor(() => readExitCode(rootAU, "merger") === 0 && !agentAlive(rootAU, "merger"), 15000, "the second merger exited 0", () => "");
assert.equal(parseTask(rootAU, taskAUa.file).state, "merging", "the first task still sits in merging, superseded");
// one poll pass: the superseded task requeues (no death record), the recorded task reads its own exit 0
poll(rootAU, 5);
assert.equal(parseTask(rootAU, taskAUa.file).state, "to-merge", "the superseded task requeued merging -> to-merge");
assert.equal(parseTask(rootAU, taskAUb.file).state, "to-merge", "the recorded task requeued on its own exit 0");
assert.ok(
	!existsSync(join(kanbanDir(rootAU), ".logs", `${slugAUa}.merger.0.dead`)) && !existsSync(join(kanbanDir(rootAU), ".logs", `${slugAUb}.merger.0.dead`)),
	"no per-run death marker for either task",
);
assert.ok(
	!existsSync(join(kanbanDir(rootAU), ".logs", `${slugAUa}.dead.count`)) && !existsSync(join(kanbanDir(rootAU), ".logs", `${slugAUb}.dead.count`)),
	"no dead-count bump for either task",
);
assert.ok(!orchLogAU().includes("dead without state update"), "no false dead line in the poll log");
assert.ok(orchLogAU().includes(`${slugAUb}: agent exited 0, merging -> to-merge`), "the recorded task consumed its own exit 0");
assert.ok(orchLogAU().includes(`${slugAUa}: its merger run is over (superseded or unrecorded), merging -> to-merge`), "the superseded task's requeue is logged");
assert.ok(!existsSync(pidPath(rootAU, "merger")) && !existsSync(exitFilePath(rootAU, "merger")), "the recorded task consumed the shared pid/exit pair");
cleanupAll(rootAU, homeAU);
console.log("orchestrator.test.ts: ... + superseded merger requeue smoke passed");

// --- part AV: maxParallel gates the merge lane: at the cap a to-merge task waits (no rebase,
// no fast-forward), below the cap the clean merge lands. Direct-drive rescan (part AW
// harness), poll is not driven; the clean path spawns no merger ---
const rootAV = fixture();
cleaned.push(rootAV);
const homeAV = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAV);
mkdirSync(kanbanDir(rootAV), { recursive: true });
const savedHomeAV = process.env.HOME;
process.env.HOME = homeAV;
let cfgAV: ReturnType<typeof loadConfig>;
try {
	cfgAV = loadConfig(rootAV);
} finally {
	process.env.HOME = savedHomeAV;
}
cfgAV.backlogIdleMinutes = 0;
cfgAV.maxParallel = 1;
const holderAV = createTask(rootAV, { name: "fix: working slot", summary: "MaxParallel smoke", specs: "n/a" });
setState(rootAV, holderAV, "doing");
// a branch one commit ahead of main: below the cap the clean rebase+fast-forward lands
execSync("git checkout -qb feat/cap-merge && git commit -q --allow-empty -m capped && git checkout -q main", { cwd: rootAV, shell: "/bin/bash" });
const taskAV = createTask(rootAV, { name: "feat: capped merge", summary: "MaxParallel smoke", specs: "n/a" });
setWorktree(rootAV, taskAV, "feat/cap-merge");
setState(rootAV, taskAV, "to-merge");
rescan(rootAV, cfgAV);
assert.equal(parseTask(rootAV, taskAV.file).state, "to-merge", "at the cap the merge waits in to-merge");
assert.equal(execSync("git log --format=%s -1 main", { cwd: rootAV, encoding: "utf8" }).trim(), "init", "main unmoved at the cap");
setState(rootAV, holderAV, "done");
rescan(rootAV, cfgAV);
assert.equal(parseTask(rootAV, taskAV.file).state, "to-live-test", "below the cap the merge fast-forwarded and set to-live-test");
const laneAV = listAll(rootAV).filter((task) => task.state === "to-integration-test");
assert.equal(laneAV.length, 1, "the fast-forward opened exactly one integration task");
assert.equal(laneAV[0].name, `test: integration of #${taskNum(taskAV.file)}`, "the integration task names the merged ref");
assert.ok(execSync("git log --format=%s main", { cwd: rootAV, encoding: "utf8" }).includes("capped"), "main took the branch commit below the cap");
console.log("orchestrator.test.ts: ... + maxParallel merge cap smoke passed");
