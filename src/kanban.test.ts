import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, listAll, listTasks, parseTask, setState, setWorktree, slugFile, slugWorktree, splitWorktreeRoot, taskFiles, taskNum, updateTask } from "./kanban.ts";

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
// 000165: the hub candidacy and self-reap checks split a worktree root into main root + name
assert.deepEqual(splitWorktreeRoot("/repo/.worktrees/fix/1-x"), ["/repo", "fix/1-x"]);
assert.deepEqual(splitWorktreeRoot("/repo/.worktrees/x"), ["/repo", "x"]);
assert.equal(splitWorktreeRoot("/repo"), null, "a main root is not a task worktree");
assert.equal(splitWorktreeRoot("/repo/sub/dir"), null, "a nested non-worktree root is not a task worktree");
assert.equal(slugWorktree("feat: nice thing", "000042_nice_thing.md", "this-is-a-short-name"), "feat/42-this-is-a-short-name");
assert.equal(slugWorktree("feat: nice thing", 42, "this-is-a-short-name"), "feat/42-this-is-a-short-name");
assert.equal(slugWorktree("nice thing", "000042_nice_thing.md", "this-is-a-short-name"), "task/42-this-is-a-short-name");

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

// open questions: parsed, created, cleared and re-filled without duplicating the section
assert.equal(t1.openQuestions, ""); // absent section reads as empty
const qRoot = mkdtempSync(join(tmpdir(), "kanban-openq-"));
const tq = createTask(qRoot, { name: "feat: open questions", summary: "s", specs: "spec", openQuestions: "- [user] Which colour?" });
assert.equal(tq.openQuestions, "- [user] Which colour?");
assert.match(readFileSync(join(qRoot, ".kanban", tq.file), "utf8"), /# Notes\n\n# Open questions\n- \[user\] Which colour\?\n$/);
const tn = createTask(qRoot, { name: "feat: no questions", summary: "s" });
assert.equal(tn.openQuestions, "");
// without openQuestions the body is byte-identical to the pre-change format plus the issuer and complexity lines
assert.equal(
	readFileSync(join(qRoot, ".kanban", tn.file), "utf8"),
	`---\nname: "feat: no questions"\npriority: "medium"\nstate: "backlog"\nworktree: ""\nissuer: "user"\ncomplexity: "moderate"\n---\n\n# Summary\ns\n\n# Specs\n\n\n# Notes\n`,
);
// an empty/whitespace openQuestions reads as absent: no section
const te = createTask(qRoot, { name: "feat: empty questions", summary: "s", openQuestions: "  " });
assert.equal(te.openQuestions, "");
assert.ok(!readFileSync(join(qRoot, ".kanban", te.file), "utf8").includes("# Open questions"));
// state changes and spec rewrites leave the section alone
setState(qRoot, tq, "to-do");
updateTask(qRoot, tq, { specs: "spec v2" });
assert.equal(parseTask(qRoot, tq.file).openQuestions, "- [user] Which colour?");
assert.match(readFileSync(join(qRoot, ".kanban", tq.file), "utf8"), /# Open questions\n- \[user\] Which colour\?\n$/);
// answering clears the section in place; a new question re-fills it, never a second header
updateTask(qRoot, tq, { openQuestions: "" });
assert.equal(parseTask(qRoot, tq.file).openQuestions, "");
assert.equal((readFileSync(join(qRoot, ".kanban", tq.file), "utf8").match(/^# Open questions$/gm) ?? []).length, 1);
updateTask(qRoot, tq, { openQuestions: "- [user] Second question?" });
assert.equal(parseTask(qRoot, tq.file).openQuestions, "- [user] Second question?");
assert.equal((readFileSync(join(qRoot, ".kanban", tq.file), "utf8").match(/^# Open questions$/gm) ?? []).length, 1);
// updateTask creates the section when the task has none
updateTask(qRoot, tn, { openQuestions: "- [user] Fresh question?" });
assert.equal(parseTask(qRoot, tn.file).openQuestions, "- [user] Fresh question?");
// kanban_list refs carry the field
assert.equal(listTasks(qRoot, "backlog").find((t) => t.file === tn.file)?.openQuestions, "- [user] Fresh question?");
assert.equal(listTasks(root, "in-progress").find((t) => t.file === t4.file)?.openQuestions, "");
rmSync(qRoot, { recursive: true, force: true });

// body-level "^# " headings that are not one of the four section names are content:
// they neither open nor end a section, so a spec structured as "# 1. ..." stays whole
const hRoot = mkdtempSync(join(tmpdir(), "kanban-headings-"));
const th = createTask(hRoot, { name: "feat: heading spec", summary: "s", specs: "# 1. Part\npart text\n\n# Complexity\nmore" });
assert.equal(th.specs, "# 1. Part\npart text\n\n# Complexity\nmore");
assert.equal(parseTask(hRoot, th.file).specs, "# 1. Part\npart text\n\n# Complexity\nmore");
// a specs update replaces the whole region including the stray headings: no old text
// strands below them and exactly one "# Specs" header remains
updateTask(hRoot, th, { specs: "brand-new specs" });
const afterTh = readFileSync(join(hRoot, ".kanban", th.file), "utf8");
assert.equal(parseTask(hRoot, th.file).specs, "brand-new specs");
assert.ok(!afterTh.includes("part text") && !afterTh.includes("# Complexity"));
assert.equal((afterTh.match(/^# Specs$/gm) ?? []).length, 1);
assert.ok(afterTh.includes("# Notes"));
// a stray-heading-free file still updates byte-for-byte
updateTask(hRoot, th, { specs: "brand-new specs" });
assert.equal(readFileSync(join(hRoot, ".kanban", th.file), "utf8"), afterTh);
// a stray heading inside Notes does not truncate the notes text
writeFileSync(join(hRoot, ".kanban", th.file), afterTh.replace(/^# Notes$/m, "# Notes\n# Side heading\nnote body"));
assert.equal(parseTask(hRoot, th.file).notes, "# Side heading\nnote body");
// a near-miss name like "# Specs detail" neither opens nor ends a section
const sdFile = "000100_specs_detail.md";
writeFileSync(join(hRoot, ".kanban", sdFile), '---\nname: "specs detail"\n---\n\n# Summary\ns\n\n# Specs\nspec line\n\n# Specs detail\ndetail line\n\n# Notes\n');
const sd = parseTask(hRoot, sdFile);
assert.equal(sd.specs, "spec line\n\n# Specs detail\ndetail line");
assert.equal(sd.notes, "");
rmSync(hRoot, { recursive: true, force: true });

// issuer: "user" by default, "#<num>" when passed, quoted in the frontmatter so it is not a YAML comment
const ti = createTask(root, { name: "feat: issued", summary: "s", issuer: "#42" });
assert.equal(ti.issuer, "#42");
assert.match(readFileSync(join(root, ".kanban", ti.file), "utf8"), /^issuer: "#42"$/m);
assert.equal(parseTask(root, ti.file).issuer, "#42"); // the quoted value round-trips
const tui = createTask(root, { name: "feat: user issued", summary: "s" });
assert.equal(tui.issuer, "user");
assert.match(readFileSync(join(root, ".kanban", tui.file), "utf8"), /^issuer: "user"$/m);
assert.equal(createTask(root, { name: "feat: bad issuer", summary: "s", issuer: "#x" }).issuer, "user"); // invalid value falls back to "user"
// absent attribute (hand-written or pre-change files) reads as "user"
writeFileSync(join(root, ".kanban", "000090_legacy.md"), '---\nname: "legacy"\n---\n# Summary\nx\n');
assert.equal(getTask(root, "000090_legacy.md")?.issuer, "user");
// issuer is creation-only: state transitions and section rewrites never touch it
setState(root, ti, "to-do");
updateTask(root, ti, { summary: "s2" });
assert.equal(parseTask(root, ti.file).issuer, "#42");
// kanban_list refs carry the field
assert.equal(listTasks(root, "in-progress").find((t) => t.file === ti.file)?.issuer, "#42");
// to-merge and merging parse and count as in-progress (scope filter and orchestrator_status)
setState(root, ti, "to-merge");
assert.equal(parseTask(root, ti.file).state, "to-merge");
assert.ok(listTasks(root, "in-progress").some((t) => t.file === ti.file), "to-merge counts as in-progress");
setState(root, ti, "merging");
assert.equal(parseTask(root, ti.file).state, "merging");
assert.ok(listTasks(root, "in-progress").some((t) => t.file === ti.file), "merging counts as in-progress");

// complexity: passed value written and quoted, updatable with replace semantics
const tcx = createTask(root, { name: "feat: complex work", summary: "s", complexity: "complex" });
assert.equal(tcx.complexity, "complex");
assert.match(readFileSync(join(root, ".kanban", tcx.file), "utf8"), /^complexity: "complex"$/m);
assert.equal(parseTask(root, tcx.file).complexity, "complex"); // the quoted value round-trips
// trivial is a supported value and round-trips too
const ttriv = createTask(root, { name: "feat: trivial work", summary: "s", complexity: "trivial" });
assert.equal(ttriv.complexity, "trivial");
assert.match(readFileSync(join(root, ".kanban", ttriv.file), "utf8"), /^complexity: "trivial"$/m);
assert.equal(parseTask(root, ttriv.file).complexity, "trivial");
updateTask(root, tcx, { complexity: "simple" });
assert.equal(parseTask(root, tcx.file).complexity, "simple");
assert.match(readFileSync(join(root, ".kanban", tcx.file), "utf8"), /^complexity: "simple"$/m);
// state transitions and section rewrites never touch it
setState(root, tcx, "to-do");
updateTask(root, tcx, { summary: "s2" });
assert.equal(parseTask(root, tcx.file).complexity, "simple");
// unknown and absent values resolve as "moderate" at parse (attribute-less pre-change files too)
writeFileSync(join(root, ".kanban", "000091_banana.md"), '---\nname: "banana"\ncomplexity: "banana"\n---\n# Summary\nx\n');
assert.equal(getTask(root, "000091_banana.md")?.complexity, "moderate");
assert.equal(getTask(root, "000090_legacy.md")?.complexity, "moderate");
// kanban_list refs carry complexity
assert.equal(listTasks(root, "in-progress").find((t) => t.file === tcx.file)?.complexity, "simple");

// blockedBy: parsed, created, replaced, cleared and listed; absent reads as empty
assert.equal(t1.blockedBy, ""); // absent attribute reads as empty
const bRoot = mkdtempSync(join(tmpdir(), "kanban-blocked-"));
const tb = createTask(bRoot, { name: "feat: blocked task", summary: "s", blockedBy: "#42, #43" });
assert.equal(tb.blockedBy, "#42, #43");
// quoted in the frontmatter so the refs are not read as YAML comments
assert.match(readFileSync(join(bRoot, ".kanban", tb.file), "utf8"), /^blockedBy: "#42, #43"$/m);
const tnb = createTask(bRoot, { name: "feat: unblocked task", summary: "s" });
assert.equal(tnb.blockedBy, "");
// without blockedBy the file matches the default format: the complexity attribute is
// always written, blockedBy only when provided
assert.equal(
	readFileSync(join(bRoot, ".kanban", tnb.file), "utf8"),
	`---\nname: "feat: unblocked task"\npriority: "medium"\nstate: "backlog"\nworktree: ""\nissuer: "user"\ncomplexity: "moderate"\n---\n\n# Summary\ns\n\n# Specs\n\n\n# Notes\n`,
);
// updateTask replaces the whole list; omitted stays unchanged
updateTask(bRoot, tb, { blockedBy: "#44" });
assert.equal(parseTask(bRoot, tb.file).blockedBy, "#44");
setState(bRoot, tb, "to-do"); // attribute rewrite keeps the list
assert.equal(parseTask(bRoot, tb.file).blockedBy, "#44");
updateTask(bRoot, tb, { summary: "s2" }); // section rewrite keeps the list
assert.equal(parseTask(bRoot, tb.file).blockedBy, "#44");
updateTask(bRoot, tb, { blockedBy: "" });
assert.equal(parseTask(bRoot, tb.file).blockedBy, "");
// kanban_list refs and kanban_get carry the field
const tb2 = createTask(bRoot, { name: "feat: blocked again", summary: "s", blockedBy: "#42" });
assert.equal(listTasks(bRoot, "backlog").find((t) => t.file === tb2.file)?.blockedBy, "#42");
assert.equal(getTask(bRoot, tb2.file)?.blockedBy, "#42");
assert.equal(getTask(bRoot, tb.file)?.blockedBy, "");
rmSync(bRoot, { recursive: true, force: true });

// blockedBy cycle guard on the shared write path: a direct 2-cycle or a self-block
// rejects with a clear error; one-directional pairs, clearing, stale refs and longer
// chains stay allowed
const cRoot = mkdtempSync(join(tmpdir(), "kanban-cycle-"));
const ca = createTask(cRoot, { name: "feat: cycle a", summary: "s" });
const cb = createTask(cRoot, { name: "feat: cycle b", summary: "s" });
const aNum = taskNum(ca.file);
const bNum = taskNum(cb.file);
// one-directional pair passes: b blocks a
updateTask(cRoot, ca, { blockedBy: `#${bNum}` });
assert.equal(parseTask(cRoot, ca.file).blockedBy, `#${bNum}`);
// the direct 2-cycle rejects before the write: a is blocked by b already, so b cannot block a
assert.throws(
	() => updateTask(cRoot, cb, { blockedBy: `#${aNum}` }),
	new RegExp(`cannot set blockedBy: #${aNum} is already blocked by #${bNum}`),
);
assert.equal(parseTask(cRoot, cb.file).blockedBy, ""); // the rejected write changed nothing
// the guard parses refs without the leading # too (the promotion gate honors both forms)
assert.throws(
	() => updateTask(cRoot, cb, { blockedBy: `${aNum}` }),
	new RegExp(`cannot set blockedBy: #${aNum} is already blocked by #${bNum}`),
);
assert.equal(parseTask(cRoot, cb.file).blockedBy, "");
// a task cannot block itself
assert.throws(() => updateTask(cRoot, ca, { blockedBy: `#${aNum}` }), /blocks itself/);
// clearing stays allowed
updateTask(cRoot, ca, { blockedBy: "" });
assert.equal(parseTask(cRoot, ca.file).blockedBy, "");
// longer chains stay allowed: c blocks b, b blocks a (a -> b -> c, no direct 2-cycle)
const cc = createTask(cRoot, { name: "feat: cycle c", summary: "s" });
const cNum = taskNum(cc.file);
updateTask(cRoot, cb, { blockedBy: `#${cNum}` });
updateTask(cRoot, ca, { blockedBy: `#${bNum}` });
assert.equal(parseTask(cRoot, ca.file).blockedBy, `#${bNum}`);
assert.equal(parseTask(cRoot, cb.file).blockedBy, `#${cNum}`);
// create path: a stale ref to the next number (a deleted task's number) turns a create
// into a 2-cycle and rejects; the failed create writes no file
updateTask(cRoot, cc, { blockedBy: "#4" }); // stale ref: no task #4 exists yet, allowed
assert.throws(
	() => createTask(cRoot, { name: "feat: cycle d", summary: "s", blockedBy: `#${cNum}` }),
	new RegExp(`cannot set blockedBy: #${cNum} is already blocked by #4`),
);
assert.equal(taskFiles(cRoot).length, 3); // the rejected create wrote no file
// create path: a new task cannot block itself (the next number is predictable)
assert.throws(() => createTask(cRoot, { name: "feat: cycle e", summary: "s", blockedBy: "#4" }), /blocks itself/);
assert.equal(taskFiles(cRoot).length, 3);
rmSync(cRoot, { recursive: true, force: true });

// shortName: drives the file and branch/worktree names, quoted in the frontmatter; set at creation only
const sRoot = mkdtempSync(join(tmpdir(), "kanban-shortname-"));
const ts = createTask(sRoot, { name: "feat: this is a short name", shortName: "this-is-a-short-name", summary: "s" });
assert.equal(ts.file, "000001_this_is_a_short_name.md"); // the file slug is the shortName; the type prefix does not enter it
assert.equal(ts.shortName, "this-is-a-short-name");
assert.match(readFileSync(join(sRoot, ".kanban", ts.file), "utf8"), /^shortName: "this-is-a-short-name"$/m);
assert.equal(parseTask(sRoot, ts.file).shortName, "this-is-a-short-name"); // the quoted value round-trips
assert.equal(listTasks(sRoot, "backlog").find((t) => t.file === ts.file)?.shortName, "this-is-a-short-name"); // kanban_list carries it
assert.equal(getTask(sRoot, ts.file)?.shortName, "this-is-a-short-name"); // kanban_get carries it
// without shortName the truncation slug applies unchanged
const tns = createTask(sRoot, { name: "feat: plain task", summary: "s" });
assert.equal(tns.file, "000002_plain_task.md");
assert.equal(tns.shortName, "");
// strict validation rejects anything but a clean hyphenated slug, max 5 words
assert.throws(() => createTask(sRoot, { name: "feat: upper", shortName: "This-Is-Invalid", summary: "s" }));
assert.throws(() => createTask(sRoot, { name: "feat: six words", shortName: "one-two-three-four-five-six", summary: "s" }));
assert.throws(() => createTask(sRoot, { name: "feat: chars", shortName: "has_underscore", summary: "s" }));
assert.throws(() => createTask(sRoot, { name: "feat: lead", shortName: "-leading-hyphen", summary: "s" }));
assert.throws(() => createTask(sRoot, { name: "feat: trail", shortName: "trailing-hyphen-", summary: "s" }));
assert.equal(taskFiles(sRoot).length, 2); // rejected creates wrote no files
// updateTask has no shortName parameter: the file name derives from it, so it never changes
assert.equal(updateTask(sRoot, ts, { summary: "s2" }), undefined);
assert.equal(parseTask(sRoot, ts.file).shortName, "this-is-a-short-name");
rmSync(sRoot, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log("kanban.test.ts: all assertions passed");
