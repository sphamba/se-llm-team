// #454 the seam between the two halves: a failed map pass keeps the previous attr, a reviewer
// pass recomputes it at the new head (so the served `since` resets), and the cleanup write that
// doneCleanup runs keeps the attr parseable for a done task.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateChangesMap } from "../../src/changes-map.ts";
import { createTask, getTask, setWorktree, splitFrontmatter, updateAttrs } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator/config.ts";

const root = mkdtempSync(join(tmpdir(), "changes-map-fresh-"));
process.on("exit", () => {
	rmSync(root, { recursive: true, force: true });
});

const gitIn = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitAt = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
gitIn("init", "-b", "main");
gitIn("config", "user.email", "t@example.com");
gitIn("config", "user.name", "t");
gitIn("config", "commit.gpgsign", "false");
writeFileSync(join(root, "e.txt"), "base\n");
gitIn("add", "e.txt");
gitIn("commit", "-m", "base");

const wt = join(root, ".worktrees", "feat/1-fresh");
gitIn("worktree", "add", ".worktrees/feat/1-fresh", "-b", "feat/1-fresh");
mkdirSync(join(wt, "src"), { recursive: true });
writeFileSync(join(wt, "src", "a.ts"), "export const a = 1;\n");
gitAt(wt, "add", "src/a.ts");
gitAt(wt, "commit", "-m", "feat: a");

const task = createTask(root, { name: "feat: fresh", summary: "the seam" });
updateAttrs(root, task, { worktree: "feat/1-fresh" });

const stub = join(root, "map-agent.cjs");
const writeStub = (text: string) => {
	writeFileSync(
		stub,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: ${JSON.stringify(text)} }] } }) + "\\n");
`,
	);
	chmodSync(stub, 0o755);
};
writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ agent: stub, roles: { map: { model: "stub-map" } } }));
const cfg = loadConfig(root);
const readMapAttr = () => splitFrontmatter(readFileSync(join(root, ".kanban", task.file), "utf8"))!.attrs.map;

const okAnswer = (symbol: string) =>
	JSON.stringify({ files: [{ path: "src/a.ts", symbols: [{ name: symbol, kind: "fn", ins: 1, del: 0, isNew: true }] }], transfers: [] });

writeStub(okAnswer("a"));
const first = await generateChangesMap({ root, cfg, task: getTask(root, task.file)!, role: "developer", run: 2 });
assert.ok(first, "the first map pass stores the map");
const firstAttr = readMapAttr();
assert.deepEqual(JSON.parse(firstAttr), JSON.parse(JSON.stringify(first)), "the stored attr is the map JSON the endpoint parses");

writeStub("no idea what changed");
const failed = await generateChangesMap({ root, cfg, task: getTask(root, task.file)!, role: "reviewer", run: 1 });
assert.equal(failed, null, "an unparseable answer fails the pass");
assert.equal(readMapAttr(), firstAttr, "a failed map pass keeps the previous attr byte for byte");

writeFileSync(join(wt, "src", "b.ts"), "export function b() {\n\treturn 2;\n}\n");
gitAt(wt, "add", "src/b.ts");
gitAt(wt, "commit", "-m", "feat: b");
const head = gitAt(wt, "rev-parse", "--short=7", "HEAD");
writeStub(okAnswer("b"));
const second = await generateChangesMap({ root, cfg, task: getTask(root, task.file)!, role: "reviewer", run: 1 });
assert.ok(second, "a completed reviewer pass recomputes the map");
const stored = getTask(root, task.file)!.map!;
assert.deepEqual([stored.role, stored.run, stored.head], ["reviewer", 1, head], "the new map names the reviewer run at the new branch head");
assert.notEqual(stored.head, first!.head, "the map head moved with the branch, so the served `since` count restarts at 0");

setWorktree(root, getTask(root, task.file)!, "");
assert.deepEqual(getTask(root, task.file)!.map, stored, "the done cleanup write keeps the map, the only record left after the branch is gone");
assert.deepEqual(JSON.parse(readMapAttr()), JSON.parse(JSON.stringify(stored)), "the attr still parses after cleanup");

console.log("changes-map: freshness tests passed");
