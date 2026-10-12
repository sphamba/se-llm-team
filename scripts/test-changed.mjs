// Selective test runner: maps the current git modifications to the affected test
// files and runs only those; an unknown path falls back to running everything.
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALL = ["src/kanban.test.ts", "src/orchestrator.test.ts", "src/webui.test.ts", "src/extension.test.ts", "index.test.ts"];

const RULES = [
	[/^src\/orchestrator\.ts$/, ["src/orchestrator.test.ts"]],
	[/^src\/pid\.ts$/, ["src/orchestrator.test.ts"]],
	[/^agents\/.*\.md$/, ["src/orchestrator.test.ts"]],
	[/^src\/webui\.ts$/, ["src/webui.test.ts"]],
	[/^src\/kanban\.ts$/, ["src/kanban.test.ts", "src/orchestrator.test.ts", "src/webui.test.ts"]],
	[/^src\/hub\.ts$/, ["src/orchestrator.test.ts", "src/webui.test.ts"]],
	[/^index\.ts$/, ["index.test.ts", "src/extension.test.ts"]],
	[/^package\.json$/, ALL],
];

export const mapToTests = (paths) => {
	const hits = new Set();
	let unknown = false;
	for (const p of paths) {
		if (/\.test\.ts$/.test(p)) hits.add(p);
		else {
			const rule = RULES.find(([re]) => re.test(p));
			if (rule) rule[1].forEach((t) => hits.add(t));
			else unknown = true;
		}
	}
	return unknown ? ALL : ALL.filter((t) => hits.has(t));
};

// working tree (staged + unstaged), untracked files, and commits on this branch vs main
const changedPaths = () => {
	const files = new Set();
	const add = (cmd) => {
		for (const f of execSync(cmd, { encoding: "utf8" }).split("\n")) if (f) files.add(f);
	};
	try {
		add("git diff --name-only HEAD");
		add("git ls-files --others --exclude-standard");
		add(`git diff --name-only ${execSync("git merge-base main HEAD", { encoding: "utf8" }).trim()} HEAD`);
	} catch {
		/* not a git repo or no main branch: the working-tree commands above still apply */
	}
	return [...files];
};

const main = () => {
	try {
		process.chdir(execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim());
	} catch {
		/* not a git repo: run from the current directory */
	}
	const paths = changedPaths();
	if (paths.length === 0) {
		console.log("test-changed: no modifications, nothing to run");
		return;
	}
	const tests = mapToTests(paths).filter((t) => existsSync(t));
	if (tests.length === 0) {
		console.log("test-changed: no affected test file exists, nothing to run");
		return;
	}
	console.log(`test-changed: ${paths.length} changed file(s) -> ${tests.join(", ")}`);
	for (const t of tests) {
		const code = spawnSync(process.execPath, [t], { stdio: "inherit" }).status ?? 1;
		if (code !== 0) {
			console.error(`test-changed: ${t} failed`);
			process.exit(code);
		}
	}
	console.log(`test-changed: ${tests.length} suite(s) passed`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
