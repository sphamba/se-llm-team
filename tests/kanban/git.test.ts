import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, gitWritableError, setState, setWorktree, updateTask } from "../../src/kanban.ts";

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

// the startup preflight accepts a writable main checkout and names the git dir when it is not
assert.equal(gitWritableError(gitRoot), null, "a writable git dir passes the preflight");
const gitDir = join(gitRoot, ".git");
try {
	chmodSync(gitDir, 0o555);
	const reason = gitWritableError(gitRoot);
	assert.ok(reason && reason.includes(gitDir) && reason.includes("EACCES"), `a read-only git dir is refused: ${reason}`);
} finally {
	chmodSync(gitDir, 0o755);
}

// a linked worktree's .git is a file and its write target is a per-worktree dir elsewhere:
// the probe must resolve that dir, not join(root, ".git")
const wtParent = mkdtempSync(join(tmpdir(), "kanban-git-wt-"));
const wtRoot = join(wtParent, "wt");
sh(`git worktree add -q -b probe ${wtRoot}`);
const wtGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: wtRoot, encoding: "utf8" }).trim();
assert.equal(gitWritableError(wtRoot), null, "a writable linked worktree passes the preflight");
try {
	chmodSync(wtGitDir, 0o555);
	const reason = gitWritableError(wtRoot);
	assert.ok(reason && reason.includes(wtGitDir) && reason.includes("EACCES"), `a read-only worktree git dir is refused: ${reason}`);
} finally {
	chmodSync(wtGitDir, 0o755);
}
rmSync(wtParent, { recursive: true, force: true });
rmSync(gitRoot, { recursive: true, force: true });
console.log("kanban: git mutation tests passed");
