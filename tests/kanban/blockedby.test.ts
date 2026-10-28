import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, hasHold, heldToken, listAll, listTasks, parseTask, setState, taskFiles, taskNum, updateTask } from "../../src/kanban.ts";
import { dropDoneBlockers } from "../../src/orchestrator/pipeline.ts";

const root = mkdtempSync(join(tmpdir(), "kanban-blockedby-"));
const t1 = createTask(root, { name: "feat: nice thing", summary: "s" });
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

// the hold tokens: "user" and "question" are holds on the task, not task refs. They parse,
// they round-trip, and they mix with task refs, which keep their old meaning
const hRoot = mkdtempSync(join(tmpdir(), "kanban-userhold-"));
const th = createTask(hRoot, { name: "feat: held by the user", summary: "s", blockedBy: "user" });
assert.equal(th.blockedBy, "user");
assert.equal(parseTask(hRoot, th.file).blockedBy, "user", "the hold token round-trips");
const thm = createTask(hRoot, { name: "feat: held with a ref", summary: "s", blockedBy: "user, #42" });
assert.equal(parseTask(hRoot, thm.file).blockedBy, "user, #42", "the token mixes with task refs and is kept verbatim");
const tq = createTask(hRoot, { name: "feat: held by a question", summary: "s", blockedBy: "question" });
assert.equal(parseTask(hRoot, tq.file).blockedBy, "question", "the question token round-trips");
const tqm = createTask(hRoot, { name: "feat: question with a ref", summary: "s", blockedBy: "question, #42" });
assert.equal(parseTask(hRoot, tqm.file).blockedBy, "question, #42", "the question token mixes with task refs");
// the shared predicate: any comma part that trims and lowercases to a hold token is a hold,
// and heldToken names the token that matched
for (const [refs, token] of [["user", "user"], ["USER", "user"], [" user ", "user"], ["user, #42", "user"], ["#42, User", "user"], ["question", "question"], [" Question , #42", "question"], ["#42, QUESTION", "question"]] as const) {
	assert.equal(heldToken(refs), token, `heldToken(${JSON.stringify(refs)}) is ${token}`);
	assert.equal(hasHold(refs), true, `hasHold(${JSON.stringify(refs)}) is true`);
}
for (const refs of ["#42", "", "   ", "users", "questions", "#42, #43"]) {
	assert.equal(heldToken(refs), "", `heldToken(${JSON.stringify(refs)}) is empty`);
	assert.equal(hasHold(refs), false, `hasHold(${JSON.stringify(refs)}) is false`);
}
// the auto-drop of a satisfied ref keeps the question token: it is no task ref at all
const doneH = createTask(hRoot, { name: "feat: done blocker", summary: "s" });
setState(hRoot, doneH, "done");
const tqs = createTask(hRoot, { name: "feat: question over a done ref", summary: "s", blockedBy: `question, #${taskNum(doneH.file)}` });
dropDoneBlockers(hRoot, listAll(hRoot));
assert.equal(parseTask(hRoot, tqs.file).blockedBy, "question", "the auto-drop keeps the question token and drops the done ref");
// the cycle guard ignores the token: a hold alone never trips it, and a real 2-cycle is still
// caught with the token beside the ref
const thn = createTask(hRoot, { name: "feat: cycle partner", summary: "s" });
const hnNum = taskNum(thn.file);
const hNum = taskNum(th.file);
updateTask(hRoot, thn, { blockedBy: `#${hNum}` });
assert.throws(
	() => updateTask(hRoot, th, { blockedBy: `user, #${hnNum}` }),
	new RegExp(`cannot set blockedBy: #${hnNum} is already blocked by #${hNum}`),
);
assert.equal(parseTask(hRoot, th.file).blockedBy, "user", "the rejected write changed nothing");
rmSync(hRoot, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
console.log("kanban: blockedBy tests passed");
