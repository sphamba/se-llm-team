import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, setState, setWorktree, updateTask } from "../../src/kanban.ts";

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
console.log("kanban: git mutation tests passed");
