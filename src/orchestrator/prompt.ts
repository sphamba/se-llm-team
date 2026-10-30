import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export function renderPrompt(root: string, role: string, logStallMinutes: number, taskFile?: string, rootCwd?: boolean, testCommand = "npm test"): string {
	// the agents dir sits two levels up from src/orchestrator/
	let prompt = readFileSync(join(HERE, "..", "..", "agents", `${role}.md`), "utf8");
	// a root-cwd run (the splitter) shares one root SPECS.md link that a
	// later root-cwd spawn re-points mid-run: name the literal task path instead (#313)
	if (rootCwd && taskFile) prompt = `Task file: \`.kanban/${taskFile}\` in this checkout. The root \`SPECS.md\` is a shared link that another root-cwd spawn can re-point at any time. Read and write the task file only through \`.kanban/${taskFile}\`, and pass \`${taskFile}\` as the \`file\` argument of every kanban_* call.\n\n${prompt}`;
	// the reviewer's base-branch resolution is the one remaining {{ROOT}} use: it diffs against
	// the branch the project root checkout has checked out. The other roles carry no absolute
	// path: the cwd SPECS.md and AGENTS.md symlinks give them the task and the role notes
	if (role === "reviewer") prompt = prompt.replaceAll("{{ROOT}}", root);
	// the merger rebases onto the branch the project root checkout has checked out, and the
	// daemon resolved it already: the prompt names a literal branch, so the agent detects none
	if (role === "merger") prompt = prompt.replaceAll("{{baseBranch}}", git(root, ["branch", "--show-current"], true) ?? "");
	// every role that names the stall window carries the daemon's configured minutes
	prompt = prompt.replaceAll("{{logStallMinutes}}", String(logStallMinutes));
	// the project's own test command (config testCommand), or npm test
	prompt = prompt.replaceAll("{{testCommand}}", testCommand);
	return prompt;
}
