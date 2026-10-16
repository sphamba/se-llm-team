import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, listAll, listTasks, parseTask, resolveTaskFromCwd, setState, setWorktree, updateTask } from "../../src/kanban.ts";

const root = mkdtempSync(join(tmpdir(), "kanban-taskfile-"));
// create + numbering + frontmatter roundtrip
const t1 = createTask(root, { name: "feat: nice thing", priority: "high", summary: "Do a thing", specs: "Do it well" });
assert.equal(t1.file, "000001_nice_thing.md");
assert.equal(t1.state, "backlog");
assert.equal(t1.name, "feat: nice thing");
assert.equal(t1.priority, "high");
assert.equal(t1.complexity, "moderate"); // default complexity written on every new task
assert.match(readFileSync(join(root, ".kanban", t1.file), "utf8"), /^complexity: "moderate"$/m);
const t2 = createTask(root, { name: "fix: other thing", summary: "Fix it" });
assert.equal(t2.file, "000002_other_thing.md");
assert.equal(t2.priority, "medium");
assert.equal(t2.complexity, "moderate");
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

// listTasks entries carry num and complexity
assert.deepEqual(listTasks(root, "backlog").map((t) => ({ file: t.file, num: t.num, complexity: t.complexity })), [
	{ file: t1.file, num: 1, complexity: "moderate" },
	{ file: t2.file, num: 2, complexity: "moderate" },
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

// notes survive a summary/specs patch: a seeded note, then the patch rewrites only that section
writeFileSync(
	join(root, ".kanban", t1.file),
	readFileSync(join(root, ".kanban", t1.file), "utf8").replace(/^# Notes$/m, "# Notes\n- first note"),
);
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

// resolveTaskFromCwd: the task behind the cwd SPECS.md symlink (the orchestrator re-points it
// in the worktree root), undefined without one
const cwdRoot = mkdtempSync(join(tmpdir(), "kanban-cwd-"));
const tCwd = createTask(cwdRoot, { name: "feat: cwd resolve", summary: "s", specs: "s" });
assert.equal(resolveTaskFromCwd(cwdRoot), undefined, "no SPECS.md: no task");
symlinkSync(join(".kanban", tCwd.file), join(cwdRoot, "SPECS.md"));
assert.equal(resolveTaskFromCwd(cwdRoot)?.file, tCwd.file, "the task resolves through the SPECS.md symlink");
assert.equal(resolveTaskFromCwd(cwdRoot)?.name, "feat: cwd resolve");
rmSync(cwdRoot, { recursive: true, force: true });
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
console.log("kanban: task file tests passed");
