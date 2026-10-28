import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, listTasks, parseTask, setState, updateTask } from "../../src/kanban.ts";

const root = mkdtempSync(join(tmpdir(), "kanban-attrs-"));
const t1 = createTask(root, { name: "feat: nice thing", summary: "s" });
const t4 = createTask(root, { name: "feat: quoted values", summary: "s" });
setState(root, t4, "to-do");
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
// issuer "auto" marks a task the orchestrator issued itself
const tai = createTask(root, { name: "chore: auto issued", summary: "s", issuer: "auto" });
assert.equal(tai.issuer, "auto");
assert.match(readFileSync(join(root, ".kanban", tai.file), "utf8"), /^issuer: "auto"$/m);
assert.equal(parseTask(root, tai.file).issuer, "auto");
assert.equal(createTask(root, { name: "feat: bad issuer 2", summary: "s", issuer: "Auto" }).issuer, "user", "an unknown issuer still falls back to user");
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
// live-testing counts as in-progress too
setState(root, tai, "live-testing");
assert.ok(listTasks(root, "in-progress").some((t) => t.file === tai.file), "a live-testing task is in progress");
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
rmSync(root, { recursive: true, force: true });
console.log("kanban: attribute tests passed");
