import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, getTask, listTasks, parseTask, slugFile, slugWorktree, splitWorktreeRoot, taskFiles, taskNum, updateTask } from "../../src/kanban.ts";

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
console.log("kanban: naming tests passed");
