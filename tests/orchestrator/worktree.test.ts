import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startHub } from "../../src/hub.ts";
import { createTask, kanbanDir, parseTask, setState, setWorktree } from "../../src/kanban.ts";
import { promoteBacklog } from "../../src/orchestrator.ts";
import { HERE, fixture, mirrorSubjects, showTip, deadStub, runDaemon, waitFor, waitForAsync, freePort, runIdx, daemons, cleaned } from "../helpers.ts";

// an external mirror-head move, built with the same plumbing the daemon uses (full-tree
// snapshot, parent = current tip): files is name -> content for the whole .kanban board
const externalCommit = (root: string, files: Record<string, string>, message: string): string => {
	const entries = Object.entries(files)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([name, content]) => {
			const sha = execSync("git hash-object -w --stdin", { input: content, cwd: root, encoding: "utf8" }).trim();
			return `100644 blob ${sha}\t${name}\n`;
		})
		.join("");
	const board = execSync("git mktree", { input: entries, cwd: root, encoding: "utf8" }).trim();
	const tree = execSync("git mktree", { input: `040000 tree ${board}\t.kanban\n`, cwd: root, encoding: "utf8" }).trim();
	const parent = execSync("git rev-parse --verify refs/heads/meta/kanban", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	const commit = execSync(`git commit-tree ${tree} -p ${parent} -m '${message}'`, { cwd: root, encoding: "utf8", shell: "/bin/bash" }).trim();
	execSync(`git update-ref refs/heads/meta/kanban ${commit}`, { cwd: root, shell: "/bin/bash" });
	return commit;
};

// a task file's frontmatter, for hand-written board entries in the tests
const taskContent = (name: string, state = "backlog") =>
	`---\nname: "${name}"\npriority: "medium"\nstate: "${state}"\nworktree: ""\n---\n\n# Summary\nTest task.\n\n# Specs\nn/a\n\n# Notes\n`;

// stub agent that lingers a few seconds before exiting 0: gives the test a window to inspect
// the context symlinks while the agent runs; the orchestrator moves the state on the exit
const lingerAgent = (root: string) => {
	const stub = join(root, "linger-agent.cjs");
	writeFileSync(stub, `#!/usr/bin/env node\nsetTimeout(() => {}, 6000);\n`);
	chmodSync(stub, 0o755);
	return stub;
};

// --- part D: the worktree board is a symlink to the shared board, invisible to the worktree's git ---
const rootD = fixture();
cleaned.push(rootD);
// the fixture's committed .gitignore ignores the context symlinks: the worktrees share it, so
// an agent's blanket git add -A never stages or commits them
mkdirSync(kanbanDir(rootD), { recursive: true });
writeFileSync(join(kanbanDir(rootD), "se-llm-team.json"), JSON.stringify({ agent: lingerAgent(rootD), backlogIdleMinutes: 0 }));
const taskD = createTask(rootD, { name: "feat: shared board", summary: "Symlink smoke", specs: "n/a" });
setState(rootD, taskD, "to-do");

const d = await runDaemon(rootD);
const wtD = join(rootD, ".worktrees", "feat/1-shared-board");
const wtBoardD = join(wtD, ".kanban");
await waitFor(
	() => {
		try {
			return lstatSync(wtBoardD).isSymbolicLink();
		} catch {
			return false;
		}
	},
	60000,
	"worktree board symlink",
	d.output,
);
assert.equal(readlinkSync(wtBoardD), kanbanDir(rootD)); // absolute path to the shared board
// the context symlinks exist before the agent spawn: SPECS.md is the task file through the
// linked board, AGENTS.md the role's notes; the agent reads both from its cwd at startup
await waitFor(
	() => existsSync(join(wtD, "SPECS.md")) && existsSync(join(wtD, "AGENTS.md")),
	30000,
	"context symlinks before spawn",
	d.output,
);
assert.equal(readlinkSync(join(wtD, "SPECS.md")), join(".kanban", taskD.file));
assert.equal(readlinkSync(join(wtD, "AGENTS.md")), join(".kanban", "AGENTS.developer.md"));
// the excludes setup lands milliseconds after the symlink: wait for convergence before asserting
await waitFor(
	() => {
		try {
			return !execSync("git status --porcelain", { cwd: wtD, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").some((l) => l.includes(".kanban"));
		} catch {
			return false;
		}
	},
	10000,
	"worktree git stops showing .kanban",
	d.output,
);
// the board is untracked (mirror commits never touch the index), so the worktree index
// carries no board entries at all and the symlink stays invisible to the worktree's git
assert.equal(execSync("git ls-files .kanban", { cwd: wtD, encoding: "utf8" }).trim(), "", "worktree index tracks no board entries");
// a blanket git add -A cannot stage board changes, and the shared board sees writes through the symlink
const wtTask = join(wtBoardD, taskD.file);
writeFileSync(wtTask, readFileSync(wtTask, "utf8").replace(/^state: .*/m, 'state: "doing"'));
assert.match(readFileSync(join(kanbanDir(rootD), taskD.file), "utf8"), /^state: "doing"$/m);
execSync("git add -A", { cwd: wtD });
assert.equal(
	execSync("git diff --cached --name-only", { cwd: wtD, encoding: "utf8" }).split("\n").filter((l) => l.includes(".kanban") || l.includes("SPECS.md") || l.includes("AGENTS.md")).length,
	0,
	"blanket git add -A staged board or context-symlink changes",
);
// after the agent terminates the orchestrator removes both symlinks; the next role's spawn
// re-points AGENTS.md at its own notes file (SPECS.md stays the task file)
await waitFor(
	() => !existsSync(join(wtD, "SPECS.md")) && !existsSync(join(wtD, "AGENTS.md")) && parseTask(rootD, taskD.file).state === "to-review",
	30000,
	"context symlinks removed after the developer terminated",
	d.output,
);
await waitFor(
	() => {
		try {
			return readlinkSync(join(wtD, "AGENTS.md")) === join(".kanban", "AGENTS.reviewer.md");
		} catch {
			return false; // removed after the developer terminated, re-pointed at the next spawn
		}
	},
	30000,
	"AGENTS.md re-pointed for the reviewer",
	d.output,
);
assert.equal(readlinkSync(join(wtD, "SPECS.md")), join(".kanban", taskD.file), "SPECS.md re-pointed for the next role");
await waitFor(() => !existsSync(join(wtD, "SPECS.md")) && !existsSync(join(wtD, "AGENTS.md")), 30000, "context symlinks removed after the reviewer terminated", d.output);
d.daemon.kill("SIGTERM");

// --- part E: to-review tasks get their worktree ensured before the spawn (to-live-test no
// longer needs one: the live test runs on the merged commit) ---
const rootE = fixture();
cleaned.push(rootE);
mkdirSync(kanbanDir(rootE), { recursive: true });
writeFileSync(join(kanbanDir(rootE), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootE), backlogIdleMinutes: 0 }));
const taskE = createTask(rootE, { name: "fix: review without worktree", summary: "Ensured worktree", specs: "n/a" });
setState(rootE, taskE, "to-review");

const e = await runDaemon(rootE);
const wtE = join(rootE, ".worktrees", "fix/1-review-without-worktree");
await waitFor(() => e.output().includes("spawned reviewer"), 30000, "reviewer spawn with ensured worktree", e.output);
assert.ok(existsSync(wtE), "worktree dir created for a to-review task with no worktree dir");
assert.ok(lstatSync(join(wtE, ".kanban")).isSymbolicLink(), "worktree board is a symlink to the shared board");
assert.ok(e.output().includes(`(cwd=${wtE})`), `reviewer spawn log shows an existing cwd: ${e.output()}`);
assert.equal(parseTask(rootE, taskE.file).worktree, "fix/1-review-without-worktree", "worktree recorded on the task");
// the dead reviewer respawns per the dead counter; past the cap the cooldown log fires and
// the fresh spawn defers; died runs never count as successful runs
await waitFor(() => e.output().includes("respawn waits for the idle cooldown"), 90000, "reviewer respawn cooldown", e.output);
const slugE = taskE.file.replace(/\.md$/, "");
const reviewerLogsE = runIdx(rootE, `${slugE}.reviewer`);
assert.deepEqual(
	reviewerLogsE,
	[0, 1, 2, 3, 4, 5].map(String),
	"each reviewer run wrote its own indexed log",
);
assert.ok(!existsSync(join(kanbanDir(rootE), ".logs", `${slugE}.reviewer-runs.count`)), "died reviewer runs never counted as successful");
e.daemon.kill("SIGTERM");

// a to-live-test task whose branch is not merged yet is requeued to to-merge first: the
// orchestrator merges it, and only then the live-tester spawns (in the worktree); a
// to-live-test task with no worktree at all routes to to-merge too, where the
// nothing-to-merge path sets done without a live test
const rootF = fixture();
cleaned.push(rootF);
mkdirSync(kanbanDir(rootF), { recursive: true });
writeFileSync(join(kanbanDir(rootF), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootF), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskF = createTask(rootF, { name: "fix: unmerged live test", summary: "Unmerged branch smoke", specs: "n/a" });
execSync("git checkout -qb feat/unmerged-live && git commit -q --allow-empty -m x && git checkout -q main", { cwd: rootF, shell: "/bin/bash" });
setWorktree(rootF, taskF, "feat/unmerged-live");
setState(rootF, taskF, "to-live-test");
const taskF2 = createTask(rootF, { name: "fix: worktree-less live test", summary: "No-worktree smoke", specs: "n/a" });
setState(rootF, taskF2, "to-live-test");

const f = await runDaemon(rootF);
await waitFor(() => f.output().includes("branch not merged yet, moving to to-merge"), 30000, "unmerged branch requeued for the orchestrator merge", f.output);
// ordering: the merge log precedes the live-tester spawn; the dead stub then bounces the
// spawned live-tester back, but the merge came first
await waitFor(() => f.output().includes("fast-forwarded main to feat/unmerged-live, set to-live-test"), 30000, "the orchestrator merged the unmerged branch", f.output);
await waitFor(() => f.output().includes("spawned live-tester"), 30000, "live-tester spawned after the merge", f.output);
assert.ok(
	f.output().indexOf("fast-forwarded main to feat/unmerged-live, set to-live-test") < f.output().indexOf("spawned live-tester"),
	"the orchestrator merge preceded the live-tester spawn",
);
const fState = parseTask(rootF, taskF.file).state;
assert.ok(fState === "to-live-test" || fState === "live-testing", `merged task moved on to the live test (${fState})`);
await waitFor(() => parseTask(rootF, taskF2.file).state === "done", 30000, "no-worktree task done without a live test", f.output);
assert.ok(f.output().includes("nothing to merge, set done"), "no-worktree task routed through the nothing-to-merge path");
f.daemon.kill("SIGTERM");

// --- part L: bootstrap materializes board files missing from .kanban/ from the mirror branch ---
const rootL = fixture();
cleaned.push(rootL);
mkdirSync(kanbanDir(rootL), { recursive: true });
writeFileSync(join(kanbanDir(rootL), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootL), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskL = createTask(rootL, { name: "fix: bootstrap board", summary: "Bootstrap smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
// board content on refs/heads/meta/kanban via the same plumbing the daemon uses, then the
// working board file removed: the daemon must materialize it on startup (fresh clone)
const shaL = execSync(`git hash-object -w .kanban/${taskL.file}`, { cwd: rootL, encoding: "utf8", shell: "/bin/bash" }).trim();
const boardTreeL = execSync("git mktree", { cwd: rootL, input: `100644 blob ${shaL}\t${taskL.file}\n`, encoding: "utf8" }).trim();
const rootTreeL = execSync("git mktree", { cwd: rootL, input: `040000 tree ${boardTreeL}\t.kanban\n`, encoding: "utf8" }).trim();
const commitL = execSync(`git commit-tree ${rootTreeL} -m "kanban: create ${taskL.file}"`, { cwd: rootL, encoding: "utf8", shell: "/bin/bash" }).trim();
execSync(`git update-ref refs/heads/meta/kanban ${commitL}`, { cwd: rootL, shell: "/bin/bash" });
const contentL = readFileSync(join(kanbanDir(rootL), taskL.file), "utf8");
rmSync(join(kanbanDir(rootL), taskL.file));

const l = await runDaemon(rootL);
await waitFor(() => existsSync(join(kanbanDir(rootL), taskL.file)), 10000, "bootstrap materialized the board from the mirror branch", l.output);
assert.equal(readFileSync(join(kanbanDir(rootL), taskL.file), "utf8"), contentL, "bootstrapped content matches the mirror branch");
// the bootstrapped file is already on the mirror: no duplicate commits, nothing on main
await new Promise((r) => setTimeout(r, 1500));
assert.equal(mirrorSubjects(rootL), `kanban: create ${taskL.file}`, "bootstrap adds no mirror commits");
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: rootL, encoding: "utf8" }).trim(), "", "bootstrap commits nothing on main");
l.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap smoke passed");

// --- part M: a fresh non-bare clone bootstraps the board from origin's meta/kanban ---
// a fresh `git clone` carries only refs/remotes/origin/meta/kanban, no local branch: the
// daemon must seed refs/heads/meta/kanban from it so the board materializes and the first
// board change mirrors with a parent (fast-forward push instead of an orphan commit)
const rootM = fixture();
cleaned.push(rootM);
const remoteM = `${rootM}-origin.git`;
execSync(`git init -q --bare ${remoteM}`, { shell: "/bin/bash" });
execSync(`git remote add origin ${remoteM}`, { cwd: rootM, shell: "/bin/bash" });
mkdirSync(kanbanDir(rootM), { recursive: true });
const taskM = createTask(rootM, { name: "fix: fresh clone bootstrap", summary: "Fresh clone bootstrap smoke", specs: "n/a" });
setState(rootM, taskM, "done");
setWorktree(rootM, taskM, "");
// board content on the mirror via the same plumbing the daemon uses, then both branches pushed
const shaM = execSync(`git hash-object -w .kanban/${taskM.file}`, { cwd: rootM, encoding: "utf8", shell: "/bin/bash" }).trim();
const boardTreeM = execSync("git mktree", { cwd: rootM, input: `100644 blob ${shaM}\t${taskM.file}\n`, encoding: "utf8" }).trim();
const rootTreeM = execSync("git mktree", { cwd: rootM, input: `040000 tree ${boardTreeM}\t.kanban\n`, encoding: "utf8" }).trim();
const commitM = execSync(`git commit-tree ${rootTreeM} -m "kanban: create ${taskM.file}"`, { cwd: rootM, encoding: "utf8", shell: "/bin/bash" }).trim();
execSync(`git update-ref refs/heads/meta/kanban ${commitM}`, { cwd: rootM, shell: "/bin/bash" });
execSync("git push -q --all origin", { cwd: rootM, shell: "/bin/bash" });
execSync("git push -q origin meta/kanban", { cwd: rootM, shell: "/bin/bash" });
// fresh non-bare clone: empty .kanban/ and only the remote-tracking mirror ref
const cloneM = `${rootM}-clone`;
execSync(`git clone -q ${remoteM} ${cloneM}`, { shell: "/bin/bash" });
cleaned.push(cloneM);
assert.equal(execSync("git branch --list meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "", "precondition: fresh clone has no local meta/kanban");
assert.ok(execSync("git rev-parse --verify refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "precondition: clone has the remote-tracking mirror ref");
// a fresh clone is configured before the daemon runs, like a real setup
mkdirSync(kanbanDir(cloneM), { recursive: true });
writeFileSync(join(kanbanDir(cloneM), "se-llm-team.json"), JSON.stringify({ agent: deadStub(cloneM), pollMinutes: 0.01, backlogIdleMinutes: 0 }));

const m = await runDaemon(cloneM);
await waitFor(() => existsSync(join(kanbanDir(cloneM), taskM.file)), 10000, "bootstrap materialized the board in a fresh clone", m.output);
assert.ok(m.output().includes("seeded refs/heads/meta/kanban from refs/remotes/origin/meta/kanban"), "daemon logged the mirror seed");
const seededShaM = execSync("git rev-parse refs/heads/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim();
assert.equal(seededShaM, commitM, "local mirror branch seeded from the remote-tracking ref");
assert.equal(readFileSync(join(kanbanDir(cloneM), taskM.file), "utf8"), readFileSync(join(kanbanDir(rootM), taskM.file), "utf8"), "bootstrapped content matches origin's board");
assert.equal(execSync("git log --format=%s -- .kanban", { cwd: cloneM, encoding: "utf8" }).trim(), "", "bootstrap commits nothing on main");
// the first board change in the clone mirrors with a parent and pushes fast-forward to origin
appendFileSync(join(kanbanDir(cloneM), taskM.file), "\nNote: post-clone board change.\n");
await waitFor(
	() => execSync("git rev-parse refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim() !== seededShaM,
	30000,
	"post-clone mirror commit pushed to origin",
	m.output,
);
const advancedShaM = execSync("git rev-parse refs/heads/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim();
assert.equal(execSync("git rev-parse refs/remotes/origin/meta/kanban", { cwd: cloneM, encoding: "utf8" }).trim(), advancedShaM, "remote-tracking ref advanced with the push");
assert.equal(execSync("git rev-parse refs/heads/meta/kanban", { cwd: remoteM, encoding: "utf8" }).trim(), advancedShaM, "origin's meta/kanban advanced to the clone's commit");
assert.deepEqual(mirrorSubjects(cloneM).split("\n"), [`kanban: done ${taskM.file}`, `kanban: create ${taskM.file}`], "mirror commit has a parent, no orphan");
assert.ok(!m.output().includes("push of refs/heads/meta/kanban failed"), "no push failures");
m.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: all smoke parts passed (pipeline + liveness + lock lifecycle + shared board + ensured worktree + symlinked spawn + failed-spawn pid guard + conflict skip + merge cooldown + mirror board + bootstrap + fresh-clone bootstrap)");

// --- part P: an external mirror-head move is reconciled into the working tree within one scan
// (external add and external deletion both propagate; the reconcile itself commits nothing)
const rootP = fixture();
cleaned.push(rootP);
mkdirSync(kanbanDir(rootP), { recursive: true });
writeFileSync(join(kanbanDir(rootP), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootP), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskP = createTask(rootP, { name: "fix: external move", summary: "Reconcile smoke", specs: "n/a", openQuestions: "- [user] Which API?" });
const p = await runDaemon(rootP);
await waitFor(() => mirrorSubjects(rootP) !== "", 30000, "task mirrored", p.output);
const contentP = readFileSync(join(kanbanDir(rootP), taskP.file), "utf8");
// the tip gains a task while the working tree lacks it: one scan must materialize it
const externalP = "000002_feat_external_task.md";
const externalContentP = taskContent("fix: external task", "done");
const extP = externalCommit(rootP, { [taskP.file]: contentP, [externalP]: externalContentP }, "external: add a task");
await waitFor(() => existsSync(join(kanbanDir(rootP), externalP)), 30000, "external add materialized within one scan", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), externalP), "utf8"), externalContentP, "external content materialized byte-for-byte");
// the tip then loses it again: the deletion propagates to the working tree
const extP2 = externalCommit(rootP, { [taskP.file]: contentP }, "external: drop a task");
await waitFor(() => !existsSync(join(kanbanDir(rootP), externalP)), 30000, "external deletion propagated to the working tree", p.output);
assert.equal(readFileSync(join(kanbanDir(rootP), taskP.file), "utf8"), contentP, "untouched task file unchanged by the reconcile");
assert.ok(showTip(rootP, taskP.file) !== null, "the untouched task stays on the branch");
// the reconcile itself commits nothing: the board already matches the tip
await new Promise((r) => setTimeout(r, 1500));
assert.deepEqual(
	mirrorSubjects(rootP).split("\n").filter((s) => s.startsWith("kanban:")),
	[`kanban: create ${taskP.file}`],
	"reconcile adds no mirror commits",
);
await waitFor(() => p.output().includes(`reconciled .kanban to ${extP2}`), 30000, "reconcile logged", p.output);
assert.ok(p.output().includes(`reconciled .kanban to ${extP}: 1 file(s) updated, 0 deleted`), "reconcile log line carries hash, updated and deleted counts");
assert.ok(p.output().includes(`reconciled .kanban to ${extP2}: 0 file(s) updated, 1 deleted`), "deletion reconcile logged with counts");
p.daemon.kill("SIGTERM");

// --- part Q: a stale working tree never erases branch-only files, and an unmirrored local
// write survives the reconcile: the next mirror commit is built after the reconcile, so the
// branch-only file folds in instead of being dropped
const rootQ = fixture();
cleaned.push(rootQ);
mkdirSync(kanbanDir(rootQ), { recursive: true });
writeFileSync(join(kanbanDir(rootQ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootQ), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskQ = createTask(rootQ, { name: "fix: no branch erase", summary: "Reconcile smoke", specs: "n/a" });
const q = await runDaemon(rootQ);
await waitFor(() => mirrorSubjects(rootQ).includes(`kanban: create ${taskQ.file}`), 30000, "task mirrored", q.output);
// branch-only file: the tip gains it while the working tree lacks it (the drift that used to erase it)
const externalQ = "000002_feat_branch_only.md";
const externalContentQ = taskContent("fix: branch-only task");
const extQ = externalCommit(rootQ, { [taskQ.file]: readFileSync(join(kanbanDir(rootQ), taskQ.file), "utf8"), [externalQ]: externalContentQ }, "external: add a branch-only task");
// an in-flight PM write, never mirrored: the reconcile that materializes the branch-only
// file must keep it. The open question holds it in backlog: promoteBacklog would otherwise
// rewrite the file (state -> to-do) between the write and its create commit, and the
// byte-for-byte assert below would race the promotion
const inflightQ = "000009_feat_in_flight_write.md";
const inflightContentQ = `${taskContent("feat: in-flight write")}\n# Open questions\n- [user] Hold in backlog\n`;
writeFileSync(join(kanbanDir(rootQ), inflightQ), inflightContentQ);
await waitFor(() => existsSync(join(kanbanDir(rootQ), externalQ)), 30000, "branch-only file materialized", q.output);
assert.ok(existsSync(join(kanbanDir(rootQ), inflightQ)), "unmirrored in-flight write survives the reconcile");
// the next mirror commit (the in-flight file's own create) must carry the branch-only file
await waitFor(() => showTip(rootQ, externalQ) !== null && execSync(`git rev-parse refs/heads/meta/kanban`, { cwd: rootQ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() !== extQ, 30000, "next mirror commit keeps the branch-only file", q.output);
assert.equal(showTip(rootQ, externalQ), externalContentQ, "branch-only file survived the next mirror commit");
assert.ok(mirrorSubjects(rootQ).includes(`kanban: create ${inflightQ}`), "in-flight write got its own create commit");
assert.equal(showTip(rootQ, inflightQ), inflightContentQ, "in-flight write mirrored after the reconcile");
q.daemon.kill("SIGTERM");

console.log("orchestrator.test.ts: ... + mirror reconcile smoke passed");

// --- part Y: 000165 a worktree daemon never serves the ui and reaps itself when its task ends ---
const rootWt = fixture();
const homeWt = mkdtempSync(join(tmpdir(), "orch-hub-wt-home-"));
cleaned.push(rootWt, homeWt);
const portWt = await freePort();
mkdirSync(join(homeWt, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeWt, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portWt }, backlogIdleMinutes: 0 }));
// the owner task: open (openQuestions keep the sweep from promoting it), worktree attribute set
const taskWt = createTask(rootWt, { name: "feat: worktree daemon", summary: "Hub candidacy smoke", specs: "n/a", openQuestions: "smoke: stays open" });
setWorktree(rootWt, taskWt, "fix/1-wt");
setState(rootWt, taskWt, "doing");
execSync("git worktree add .worktrees/fix/1-wt -b fix/1-wt", { cwd: rootWt, shell: "/bin/bash" });
const wtPath = join(rootWt, ".worktrees", "fix", "1-wt");
const envWt = { ...process.env, HOME: homeWt, SE_LLM_TEAM_HUB_HEALTH_MS: "500" };
delete envWt.SE_LLM_TEAM_NO_WEBUI;
// the hub comes up AFTER the worktree daemon: its startup election stands down instead of racing
const dWt = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", wtPath, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envWt });
daemons.push({ daemon: dWt, root: wtPath });
let outWt = "";
dWt.stdout.on("data", (d) => (outWt += d));
dWt.stderr.on("data", (d) => (outWt += d));
const exitWt = new Promise<string>((r) => dWt.on("exit", (code) => r(String(code))));
await waitFor(() => outWt.includes("stands down"), 15000, "worktree daemon stands down at startup with no hub", () => outWt);
assert.ok(!outWt.includes("web ui on"), "a worktree daemon never races for the port");
const realHomeWt = process.env.HOME;
process.env.HOME = homeWt;
const hubWt = await startHub({ name: basename(rootWt), root: rootWt, host: "127.0.0.1", port: portWt, healthMs: 500, staleMs: 3000 });
assert.ok(hubWt, "the hub starts in-process");
await waitForAsync(async () => {
	try {
		return (await (await fetch(`http://127.0.0.1:${portWt}/api/projects`)).json()).some((e: any) => e.root === wtPath);
	} catch {
		return false;
	}
}, 15000, "worktree daemon registers with the hub once it appears");
await new Promise((r) => setTimeout(r, 2000)); // several hub ticks: still never served
assert.ok(!outWt.includes("web ui on"), "a worktree daemon never serves the ui");
assert.equal(await Promise.race([exitWt, Promise.resolve("alive")]), "alive", "the worktree daemon stays alive while its task is open");
// the task goes done: the daemon reaps itself on its next sweep
setState(rootWt, taskWt, "done");
assert.equal(await Promise.race([exitWt, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]), "0", "the worktree daemon reaped itself when its task went done");
// the task gone: a fresh daemon reaps at startup, before anything recreates the removed worktree's dirs
rmSync(join(rootWt, ".kanban", taskWt.file));
rmSync(join(rootWt, ".worktrees"), { recursive: true, force: true });
const dWt2 = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", wtPath, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envWt });
daemons.push({ daemon: dWt2, root: wtPath });
let outWt2 = "";
dWt2.stdout.on("data", (d) => (outWt2 += d));
dWt2.stderr.on("data", (d) => (outWt2 += d));
const exitWt2 = new Promise<string>((r) => dWt2.on("exit", (code) => r(String(code))));
assert.equal(await Promise.race([exitWt2, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]), "0", "a worktree daemon whose task is gone reaps at startup");
assert.ok(!existsSync(wtPath), "the startup reap ran before the dirs were recreated, no worktree shell left behind");
// close at the temp HOME: the close flush writes the registry, and after the restore it would
// hit the real user config dir
hubWt.close();
process.env.HOME = realHomeWt;
console.log("orchestrator.test.ts: ... + worktree hub candidacy smoke passed");

// --- part Z: a daemon restart preserves in-flight working-tree state and notes on a file
// already on the mirror. Mirror commits carry only creates and dones, so an agent's state
// and notes write lives in the working tree alone; the startup reconcile must keep it
// instead of reverting the task to its create-time mirror content and re-running it.
const rootZ = fixture();
cleaned.push(rootZ);
mkdirSync(kanbanDir(rootZ), { recursive: true });
writeFileSync(join(kanbanDir(rootZ), "se-llm-team.json"), JSON.stringify({ agent: deadStub(rootZ), pollMinutes: 0.01, backlogIdleMinutes: 0 }));
const taskZ = createTask(rootZ, { name: "fix: restart keeps in-flight state", summary: "Restart smoke", specs: "n/a" });
const z1 = await runDaemon(rootZ);
await waitFor(() => mirrorSubjects(rootZ).includes(`kanban: create ${taskZ.file}`), 30000, "task mirrored before the restart", z1.output);
z1.daemon.kill("SIGTERM");
// full exit first: the lock must be released and lastMirrorHash is process state
await Promise.race([new Promise((r) => z1.daemon.on("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
// in-flight write: the task settled done in the working tree, never mirrored
writeFileSync(
	join(kanbanDir(rootZ), taskZ.file),
	readFileSync(join(kanbanDir(rootZ), taskZ.file), "utf8")
		.replace(/^state: .*/m, 'state: "done"')
		.replace(/\n# Notes\n/, "\n# Notes\n- in-flight note\n"),
);
assert.ok(showTip(rootZ, taskZ.file)!.includes('state: "backlog"'), "precondition: the mirror tip still has the create-time state");

const z2 = await runDaemon(rootZ);
await waitFor(() => z2.output().includes("1 in-flight kept"), 30000, "reconcile kept the in-flight working-tree file", z2.output);
assert.ok(readFileSync(join(kanbanDir(rootZ), taskZ.file), "utf8").includes("- in-flight note"), "in-flight notes survived the restart");
// the in-flight done state is acted on, not reverted to the mirror's backlog: the done
// transition still mirrors because the working-tree file differs from the tip
await waitFor(() => mirrorSubjects(rootZ).includes(`kanban: done ${taskZ.file}`), 30000, "done mirror commit after the restart", z2.output);
assert.ok(showTip(rootZ, taskZ.file)!.includes("- in-flight note"), "the done mirror commit carries the in-flight note");
z2.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + restart preserves in-flight board state smoke passed");
