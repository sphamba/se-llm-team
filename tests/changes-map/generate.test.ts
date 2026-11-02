// #455 the map pass end to end through the real runner: node src/analysis-run.ts against a
// fixture root with a task worktree and a stub map agent. The stored attr must carry the branch
// head, the triggering run and the resolved model, and the prompt must carry the branch diff.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, taskSlug, updateAttrs } from "../../src/kanban.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "changes-map-gen-"));
const home = mkdtempSync(join(tmpdir(), "changes-map-home-"));
process.on("exit", () => {
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

const stdio = ["ignore", "pipe", "pipe"] as const;
const gitIn = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio }).trim();
const gitAt = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio }).trim();
gitIn("init", "-b", "main");
// a scratch repo never inherits the global git config, and the fixture must not sign commits
gitIn("config", "user.email", "t@example.com");
gitIn("config", "user.name", "t");
gitIn("config", "commit.gpgsign", "false");
writeFileSync(join(root, "e.txt"), "base\n");
gitIn("add", "e.txt");
gitIn("commit", "-m", "base");

const wt = join(root, ".worktrees", "feat/1-map");
gitIn("worktree", "add", ".worktrees/feat/1-map", "-b", "feat/1-map");
mkdirSync(join(wt, "src"), { recursive: true });
writeFileSync(join(wt, "src", "a.ts"), "export function add(a: number, b: number) {\n\treturn a + b;\n}\n");
gitAt(wt, "add", "src/a.ts");
gitAt(wt, "commit", "-m", "feat: add");
const head = gitAt(wt, "rev-parse", "--short=7", "HEAD");

const task = createTask(root, { name: "feat: map", summary: "the map" });
updateAttrs(root, task, { worktree: "feat/1-map" });
const slug = taskSlug(task.file);

// the stub answers the map JSON to every call: the analyst and doctor passes accept any text
const answer = JSON.stringify({ files: [{ path: "src/a.ts", symbols: [{ name: "add", kind: "fn", ins: 3, del: 0, isNew: true }] }], transfers: [] });
const stub = join(root, "map-agent.cjs");
writeFileSync(
	stub,
	`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(join(root, "stub.argv.log"))}, JSON.stringify(process.argv) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: ${JSON.stringify(answer)} }] } }) + "\\n");
`,
);
chmodSync(stub, 0o755);
// the map role resolves its own model, so the stored attr names the run that wrote it
writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ agent: stub, roles: { mapper: { model: "stub-map-model" } } }));

mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const logPath = join(root, ".kanban", ".logs", `${slug}.developer.2.log`);
writeFileSync(logPath, JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "did the work" }] } }) + "\n");
execFileSync(process.execPath, [join(HERE, "../../src/analysis-run.ts"), root, logPath, "developer"], {
	env: { ...process.env, HOME: home },
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
	timeout: 120000,
});

const stored = getTask(root, task.file)!.map;
assert.ok(stored, "the map pass wrote the map attr");
assert.deepEqual(stored.files, [{ path: "src/a.ts", symbols: [{ name: "add", kind: "fn", ins: 3, del: 0, isNew: true }] }], "the parsed files land in the attr");
assert.deepEqual(
	[stored.role, stored.run, stored.model, stored.head],
	["developer", 2, "stub-map-model", head],
	"the attr records the role, the run index from the log name, the resolved map model and the branch head",
);
assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stored.at), "at is an ISO 8601 UTC time");

const prompts = readFileSync(join(root, "stub.argv.log"), "utf8")
	.trim()
	.split("\n")
	.map((l) => JSON.parse(l) as string[])
	.map((argv) => argv[argv.indexOf("-p") + 1] ?? "");
const mapPrompt = prompts.find((p) => p.includes("changes map"))!;
assert.ok(mapPrompt, "the map pass spawned the map role");
assert.ok(mapPrompt.includes("diff --git a/src/a.ts b/src/a.ts"), "the prompt carries the branch diff");
assert.ok(mapPrompt.includes("3\t0\tsrc/a.ts"), "the prompt carries the per-file numstat");

console.log("changes-map: generate tests passed");
