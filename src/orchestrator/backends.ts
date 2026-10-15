// Per-backend argv builders for the agent CLIs the orchestrator and the efficiency analyser
// spawn: pi and claude. The pi argv stays byte-identical to the pre-backend construction
// (tests assert it). The claude flags are verified against the claude CLI docs: stream-json
// output in print mode requires --verbose, --effort knows no off/minimal, and
// --append-system-prompt-file does not repeat, so the system prompt travels as one file.
import type { LlmConfig } from "./config.ts";

export type Backend = "pi" | "claude";

export const BACKENDS: Backend[] = ["pi", "claude"];

// pi --thinking levels claude --effort also knows; claude has no off/minimal effort, both
// map to low (claude's minimum)
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function claudeEffort(thinking: string | undefined): string | undefined {
	if (!thinking) return undefined;
	return CLAUDE_EFFORTS.has(thinking) ? thinking : "low";
}

export function piLlmFlags(llm: LlmConfig): string[] {
	const flags: string[] = [];
	if (llm.provider) flags.push("--provider", llm.provider);
	if (llm.model) flags.push("--model", llm.model);
	if (llm.thinking) flags.push("--thinking", llm.thinking);
	return flags;
}

function claudeLlmFlags(llm: LlmConfig): string[] {
	const flags: string[] = [];
	// the provider field is pi-only: claude has no --provider
	if (llm.model) flags.push("--model", llm.model);
	const effort = claudeEffort(llm.thinking);
	if (effort) flags.push("--effort", effort);
	return flags;
}

// pi spawn argv: --approve trusts the project-local files so the headless session never
// waits for a trust prompt; --mode json streams the full JSONL event log instead of print
// mode's final text only; the project AGENTS.md rides inline as one argv element
export function piSpawnArgs(llm: LlmConfig, projectPrompt: string | null, prompt: string): string[] {
	return ["--approve", "--mode", "json", ...piLlmFlags(llm), ...(projectPrompt ? ["--append-system-prompt", projectPrompt] : []), "-p", prompt];
}

// claude spawn argv: bypassPermissions matches pi's --approve containment; stream-json
// output needs --verbose in print mode; the concatenated system prompt travels as one
// --append-system-prompt-file ref
export function claudeSpawnArgs(llm: LlmConfig, prompt: string, systemPromptFile: string | null): string[] {
	const flags = ["-p", prompt, "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", ...claudeLlmFlags(llm)];
	if (systemPromptFile) flags.push("--append-system-prompt-file", systemPromptFile);
	return flags;
}

// claude analyser argv: --bare skips the auto-discovery of hooks, skills, commands,
// subagents, plugins, MCP servers and memory, the isolated-run equivalent of pi's --no-*
// flags; --no-session-persistence keeps the one-shot call out of the session store
// claude analyst args: --bare isolates the analyst from the workspace, so it reads no files
export function claudeAnalystArgs(llm: LlmConfig, prompt: string): string[] {
	return ["--bare", ...claudeDoctorArgs(llm, prompt)];
}

// claude doctor args: the analyst args without --bare, so the doctor may edit the role file
export function claudeDoctorArgs(llm: LlmConfig, prompt: string): string[] {
	return ["--no-session-persistence", "-p", prompt, "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", ...claudeLlmFlags(llm)];
}
