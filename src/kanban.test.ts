import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendNote, createTask, getTask, listAll, listTasks, parseTask, setState, setWorktree, slugFile, slugWorktree, taskNum, updateTask } from "./kanban.ts";

const root = mkdtempSync(join(tmpdir(), "kanban-test-"));
const fail = (msg: string) => {
	rmSync(root, { recursive: true, force: true });
	console.error(msg);
	process.exit(1);
};

// slug rules: capped at 4 words with the type word dropped, number prefix kept
assert.equal(slugFile("feat: nice thing"), "nice_thing");
assert.equal(slugFile("fix: restore board state lost to stale mirror snapshots"), "restore_board_state");
assert.equal(
	slugWorktree("fix: restore board state lost to stale mirror snapshots", "000042_fix_restore_board_state_lost_to_stale_mirror_snapshots.md"),
	"fix/42-restore-board-state",
);
assert.equal(slugWorktree("feat: nice thing", 42), "feat/42-nice-thing");
assert.equal(slugWorktree("nice thing", "000042_nice_thing.md"), "task/42-nice-thing");
assert.equal(slugWorktree("feat: nice thing"), "feat/nice-thing"); // no file, no number

// taskNum: leading digits, safe fallback for non-numbered names
assert.equal(taskNum("000042_fix_thing.md"), 42);
assert.equal(taskNum("000001_feat_nice_thing.md"), 1);
assert.equal(taskNum("other.md"), 0);

// create + numbering + frontmatter roundtrip
const t1 = createTask(root, { name: "feat: nice thing", priority: "high", summary: "Do a thing", specs: "Do it well" });
assert.equal(t1.file, "000001_nice_thing.md");
assert.equal(t1.state, "backlog");
assert.equal(t1.name, "feat: nice thing");
assert.equal(t1.priority, "high");
const t2 = createTask(root, { name: "fix: other thing", summary: "Fix it" });
assert.equal(t2.file, "000002_other_thing.md");
assert.equal(t2.priority, "medium");
// name with colon must round-trip through the quoted frontmatter
assert.equal(parseTask(root, t1.file).name, "feat: nice thing");

// scoping
assert.deepEqual(listTasks(root, "backlog").map((t) => t.file), [t1.file, t2.file]);
assert.equal(listTasks(root, "in-progress").length, 0);
assert.equal(listTasks(root, "done").length, 0);

// listTasks returns priority and state per task
assert.deepEqual(listTasks(root, "backlog").map((t) => ({ file: t.file, priority: t.priority, state: t.state })), [
	{ file: t1.file, priority: "high", state: "backlog" },
	{ file: t2.file, priority: "medium", state: "backlog" },
]);

// listTasks entries carry num
assert.deepEqual(listTasks(root, "backlog").map((t) => ({ file: t.file, num: t.num })), [
	{ file: t1.file, num: 1 },
	{ file: t2.file, num: 2 },
]);

// priority filter, alone and combined with scope
assert.deepEqual(listTasks(root, "backlog", "high").map((t) => t.file), [t1.file]);
assert.deepEqual(listTasks(root, "backlog", "medium").map((t) => t.file), [t2.file]);
assert.equal(listTasks(root, "done", "high").length, 0);

// state + worktree transitions preserve the body
setState(root, t1, "to-do");
setWorktree(root, t1, "feat/nice-thing");
const raw = readFileSync(join(root, ".kanban", t1.file), "utf8");
assert.match(raw, /^state: "to-do"$/m);
assert.match(raw, /^worktree: "feat\/nice-thing"$/m);
assert.match(raw, /# Summary\nDo a thing/);
assert.equal(parseTask(root, t1.file).state, "to-do");

// notes, updateTask
appendNote(root, t1, "first note");
assert.match(parseTask(root, t1.file).notes, /first note/);
// a summary/specs patch rewrites only that section: unknown sections stay byte-for-byte
const withUnknown = readFileSync(join(root, ".kanban", t1.file), "utf8").replace(
	/\s*$/,
	"\n\n# Changelog\n2025-01-01 entry\n",
);
writeFileSync(join(root, ".kanban", t1.file), withUnknown);
updateTask(root, t1, { summary: "New summary" });
const after = parseTask(root, t1.file);
assert.equal(after.summary, "New summary");
assert.equal(after.specs, "Do it well");
assert.match(after.notes, /first note/);
assert.equal(after.state, "to-do");
assert.ok(readFileSync(join(root, ".kanban", t1.file), "utf8").endsWith("# Changelog\n2025-01-01 entry\n"));
updateTask(root, t1, { specs: "Do it very well" });
assert.equal(parseTask(root, t1.file).specs, "Do it very well");
assert.ok(readFileSync(join(root, ".kanban", t1.file), "utf8").endsWith("# Changelog\n2025-01-01 entry\n"));
assert.match(parseTask(root, t1.file).notes, /first note/);

// get + listing granularities
assert.equal(getTask(root, t1.file)?.name, "feat: nice thing");
assert.equal(getTask(root, "000001"), undefined); // exact file names only
assert.equal(listAll(root).length, 2);
setState(root, t2, "done");
assert.deepEqual(listTasks(root, "done").map((t) => t.file), [t2.file]);
assert.deepEqual(listTasks(root, "in-progress").map((t) => t.file), [t1.file]);
// priority filter combines with scope
assert.deepEqual(listTasks(root, "in-progress", "high").map((t) => t.file), [t1.file]);
assert.equal(listTasks(root, "in-progress", "low").length, 0);

// quoted, backslash and newline values round-trip through the quoted frontmatter
const t4 = createTask(root, { name: 'feat: "quoted" \\ and\nnewline', summary: "s" });
assert.equal(parseTask(root, t4.file).name, 'feat: "quoted" \\ and\nnewline');
setState(root, t4, "to-do"); // attribute rewrite must not compound escaping
assert.equal(parseTask(root, t4.file).name, 'feat: "quoted" \\ and\nnewline');

// no git repo must not throw (mutations write files only)
const noGit = mkdtempSync(join(tmpdir(), "kanban-nogit-"));
const t3 = createTask(noGit, { name: "feat: no repo", summary: "s" });
assert.equal(t3.file, "000001_no_repo.md");
assert.equal(setState(noGit, t3, "to-do"), undefined);
rmSync(noGit, { recursive: true, force: true });

// mutations commit nothing: the orchestrator daemon is the sole .kanban committer
const gitRoot = mkdtempSync(join(tmpdir(), "kanban-git-"));
const sh = (cmd: string) => execSync(cmd, { cwd: gitRoot, encoding: "utf8", shell: "/bin/bash" });
execSync("git init -q", { cwd: gitRoot });
sh("git config user.email t@t && git config user.name t && git config commit.gpgsign false");
writeFileSync(join(gitRoot, "README.md"), "x\n");
sh("git add -A && git commit -qm init");
const tg = createTask(gitRoot, { name: "feat: git board", summary: "s" });
assert.equal(sh("git rev-list --count HEAD").trim(), "1"); // create writes the file, no commit
assert.match(sh("git status --porcelain -uall"), new RegExp(`\\?\\? \\.kanban/${tg.file}`));
setState(gitRoot, tg, "to-do");
setWorktree(gitRoot, tg, "feat/git-board");
appendNote(gitRoot, tg, "note");
updateTask(gitRoot, tg, { summary: "s2" });
assert.equal(sh("git rev-list --count HEAD").trim(), "1"); // intermediate updates create no commits
assert.match(sh("git status --porcelain -uall"), new RegExp(`\\?\\? \\.kanban/${tg.file}`)); // still uncommitted
rmSync(gitRoot, { recursive: true, force: true });

// number allocation: repeated creates never share a number
const raceRoot = mkdtempSync(join(tmpdir(), "kanban-race-"));
const created: string[] = [];
for (let i = 0; i < 5; i++) {
	created.push(createTask(raceRoot, { name: `feat: race ${i}`, summary: "s" }).file);
}
assert.equal(new Set(created).size, created.length);
// a concurrent create landed between the max scan and the write: target file already exists
writeFileSync(join(raceRoot, ".kanban", "000006_other_creator.md"), '---\nname: "other"\n---\n');
const tr = createTask(raceRoot, { name: "feat: racer", summary: "s" });
assert.equal(tr.file, "000007_racer.md"); // bumped to the next free number
assert.match(readFileSync(join(raceRoot, ".kanban", "000006_other_creator.md"), "utf8"), /other/); // not overwritten
created.push(tr.file);
assert.equal(new Set(created).size, created.length);
rmSync(raceRoot, { recursive: true, force: true });

// merge-conflict handling: a conflict-marked file is never rewritten
const tc = createTask(root, { name: "fix: conflicted file", summary: "s", specs: "real specs" });
writeFileSync(
	join(root, ".kanban", tc.file),
	readFileSync(join(root, ".kanban", tc.file), "utf8").replace(
		/^state: "backlog"$/m,
		'<<<<<<< HEAD\nstate: "done"\n=======\nstate: "to-live-test"\n>>>>>>> fix/other-branch',
	),
);
assert.equal(parseTask(root, tc.file).conflicted, true);
assert.equal(parseTask(root, t1.file).conflicted, false); // a clean file does not read as conflicted
const conflictBefore = readFileSync(join(root, ".kanban", tc.file), "utf8");
assert.throws(() => setState(root, tc, "done"));
assert.throws(() => setWorktree(root, tc, "fix/x"));
assert.throws(() => updateTask(root, tc, { summary: "x" }));
assert.equal(readFileSync(join(root, ".kanban", tc.file), "utf8"), conflictBefore); // byte-identical: nothing resolved, nothing lost

// a normal rewrite is lossless: unknown attributes and unknown sections survive
const tu = createTask(root, { name: "feat: lossless rewrite", summary: "s" });
writeFileSync(
	join(root, ".kanban", tu.file),
	readFileSync(join(root, ".kanban", tu.file), "utf8").replace(/^priority: .*/m, 'priority: "medium"\ncustom-attr: "keep me"') + "\n# Design\nextra section\n",
);
setState(root, tu, "to-do");
const rawAfter = readFileSync(join(root, ".kanban", tu.file), "utf8");
assert.match(rawAfter, /^state: "to-do"$/m);
assert.match(rawAfter, /^custom-attr: "keep me"$/m);
assert.match(rawAfter, /# Design\nextra section/);

rmSync(root, { recursive: true, force: true });
console.log("kanban.test.ts: all assertions passed");
