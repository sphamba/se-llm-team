import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendNote, createTask, getTask, listAll, listTasks, parseTask, setState, setWorktree, slugFile, slugWorktree, updateTask } from "./kanban.ts";

const root = mkdtempSync(join(tmpdir(), "kanban-test-"));
const fail = (msg: string) => {
	rmSync(root, { recursive: true, force: true });
	console.error(msg);
	process.exit(1);
};

// slug rules
assert.equal(slugFile("feat: nice thing"), "feat_nice_thing");
assert.equal(slugWorktree("feat: nice thing"), "feat/nice-thing");
assert.equal(slugWorktree("nice thing"), "nice-thing");

// create + numbering + frontmatter roundtrip
const t1 = createTask(root, { name: "feat: nice thing", priority: "high", summary: "Do a thing", specs: "Do it well" });
assert.equal(t1.file, "000001_feat_nice_thing.md");
assert.equal(t1.state, "backlog");
assert.equal(t1.name, "feat: nice thing");
assert.equal(t1.priority, "high");
const t2 = createTask(root, { name: "fix: other thing", summary: "Fix it" });
assert.equal(t2.file, "000002_fix_other_thing.md");
assert.equal(t2.priority, "medium");
// name with colon must round-trip through the quoted frontmatter
assert.equal(parseTask(root, t1.file).name, "feat: nice thing");

// scoping
assert.deepEqual(listTasks(root, "backlog").map((t) => t.file), [t1.file, t2.file]);
assert.equal(listTasks(root, "in-progress").length, 0);
assert.equal(listTasks(root, "done").length, 0);

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
updateTask(root, t1, { summary: "New summary" });
const after = parseTask(root, t1.file);
assert.equal(after.summary, "New summary");
assert.equal(after.specs, "Do it well");
assert.match(after.notes, /first note/);
assert.equal(after.state, "to-do");

// get + listing granularities
assert.equal(getTask(root, t1.file)?.name, "feat: nice thing");
assert.equal(getTask(root, "000001"), undefined); // exact file names only
assert.equal(listAll(root).length, 2);
setState(root, t2, "done");
assert.deepEqual(listTasks(root, "done").map((t) => t.file), [t2.file]);
assert.deepEqual(listTasks(root, "in-progress").map((t) => t.file), [t1.file]);

// quoted, backslash and newline values round-trip through the quoted frontmatter
const t4 = createTask(root, { name: 'feat: "quoted" \\ and\nnewline', summary: "s" });
assert.equal(parseTask(root, t4.file).name, 'feat: "quoted" \\ and\nnewline');
setState(root, t4, "to-do"); // attribute rewrite must not compound escaping
assert.equal(parseTask(root, t4.file).name, 'feat: "quoted" \\ and\nnewline');

// commit policy: task files commit only at create and done
const gitRoot = mkdtempSync(join(tmpdir(), "kanban-git-"));
execSync("git init -q", { cwd: gitRoot });
execSync("git config user.email t@t && git config user.name t && git config commit.gpgsign false", {
	cwd: gitRoot,
	shell: "/bin/bash",
});
writeFileSync(join(gitRoot, "README.md"), "x\n");
execSync("git add -A && git commit -qm init", { cwd: gitRoot, shell: "/bin/bash" });
const commitCount = () => parseInt(execSync("git rev-list --count HEAD", { cwd: gitRoot, encoding: "utf8" }).trim(), 10);
const lastCommit = () => execSync("git log -1 --format=%s", { cwd: gitRoot, encoding: "utf8" }).trim();
const dirty = (file: string) => execSync(`git status --porcelain -- .kanban/${file}`, { cwd: gitRoot, encoding: "utf8" }).trim();
assert.equal(commitCount(), 1);
const g1 = createTask(gitRoot, { name: "feat: committed", summary: "s" });
assert.equal(lastCommit(), "kanban: create 000001_feat_committed.md");
assert.equal(commitCount(), 2);
setState(gitRoot, g1, "to-do");
setWorktree(gitRoot, g1, "feat/committed");
appendNote(gitRoot, g1, "mid-flight note");
updateTask(gitRoot, g1, { summary: "s2" });
assert.equal(commitCount(), 2); // no commits between create and done
assert.notEqual(dirty(g1.file), ""); // edits stay uncommitted until done
setState(gitRoot, g1, "done");
assert.equal(lastCommit(), "kanban: done 000001_feat_committed.md");
assert.equal(commitCount(), 3);
assert.equal(dirty(g1.file), "");
setState(gitRoot, g1, "done"); // no-change state move must not repeat the done commit
assert.equal(commitCount(), 3);
rmSync(gitRoot, { recursive: true, force: true });

// no git repo must not throw (commit returns false)
const noGit = mkdtempSync(join(tmpdir(), "kanban-nogit-"));
const t3 = createTask(noGit, { name: "feat: no repo", summary: "s" });
assert.equal(t3.file, "000001_feat_no_repo.md");
assert.equal(setState(noGit, t3, "to-do"), undefined);
assert.equal(setState(noGit, t3, "done"), undefined);
rmSync(noGit, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log("kanban.test.ts: all assertions passed");
