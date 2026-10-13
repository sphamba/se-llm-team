// Selective test runner: maps the current git modifications to the affected test
// files and runs only those; an unknown path falls back to running everything.
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALL = ["tests/kanban.test.ts", "tests/orchestrator.test.ts", "tests/webui.test.ts", "tests/extension.test.ts", "index.test.ts"];

const RULES = [
	[/^src\/orchestrator\.ts$/, ["tests/orchestrator.test.ts"]],
	[/^src\/pid\.ts$/, ["tests/orchestrator.test.ts"]],
	[/^agents\/.*\.md$/, ["tests/orchestrator.test.ts"]],
	[/^src\/webui\.ts$/, ["tests/webui.test.ts"]],
	[/^src\/kanban\.ts$/, ["tests/kanban.test.ts", "tests/orchestrator.test.ts", "tests/webui.test.ts"]],
	[/^src\/hub\.ts$/, ["tests/orchestrator.test.ts", "tests/webui.test.ts"]],
	[/^index\.ts$/, ["index.test.ts", "tests/extension.test.ts"]],
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
		for (const f of execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n")) if (f) files.add(f);
	};
	const tryAdd = (cmd) => {
		try {
			add(cmd);
		} catch {
			/* not a git repo, no commits, or no main branch: the other commands still apply */
		}
	};
	tryAdd("git ls-files --others --exclude-standard");
	tryAdd("git diff --name-only HEAD");
	tryAdd("git merge-base main HEAD >/dev/null && git diff --name-only $(git merge-base main HEAD) HEAD");
	return [...files];
};

const main = () => {
	try {
		process.chdir(execSync("git rev-parse --show-toplevel", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
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
