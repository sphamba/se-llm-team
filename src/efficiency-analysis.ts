// Efficiency analysis for one agent log. It parses the JSONL event stream, summarizes each
// assistant block with a headless analyser in pass 1, and turns the summaries plus simple
// stats into a markdown pain-point report in pass 2. No wall-clock durations: compacted logs
// carry almost no per-event timestamps, so slowness is inferred from content.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";

// One ordered assistant block from the log.
export interface AnalysisBlock {
	index: number; // 1-based, log order
	type: "text" | "thinking" | "toolCall";
	toolName?: string; // tool calls only
	text: string; // thinking text, assistant text, or JSON-stringified arguments for toolCall
	result?: string; // tool calls only: joined tool result text
	isError?: boolean; // tool calls only: the joined result was an error
}

export interface BlockReport {
	index: number;
	type: "text" | "thinking" | "toolCall";
	toolName?: string; // tool calls only
	summary: string; // 1 to 3 sentences, or the failure note when the analyser failed
	struggle: string; // struggle signals (confusion, errors, retries, repeated work) or ""
}

export interface AnalyseOptions {
	agent?: string; // default "pi"
	llmFlags?: string[]; // default []
	runAnalyser?: (argv: string[]) => Promise<string | null>; // returns the assistant answer text, null on failure
}

export interface AnalyseResult {
	reportPath: string; // where the report was written
	blockCount: number;
	analysis: string; // the pass 2 final analysis
	blocks: BlockReport[];
}

// Read a log file. A path that ends with .gz is gunzipped with node:zlib.
export function readLogFile(path: string): string {
	if (path.endsWith(".gz")) return gunzipSync(readFileSync(path)).toString("utf8");
	return readFileSync(path, "utf8");
}

interface ToolResultInfo {
	text: string;
	isError: boolean;
}

// The joined text of one tool result payload. A .content array joins the .text strings of
// its entries with newlines. A plain string is used as it is. Anything else is JSON text.
function resultText(payload: unknown): string {
	if (payload && typeof payload === "object" && Array.isArray((payload as { content?: unknown }).content)) {
		const texts: string[] = [];
		for (const part of (payload as { content: unknown[] }).content) {
			if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text);
		}
		return texts.join("\n");
	}
	if (typeof payload === "string") return payload;
	if (payload === undefined || payload === null) return "";
	return JSON.stringify(payload);
}

// Tool call arguments as JSON text.
function argsText(args: unknown): string {
	if (typeof args === "string") return args;
	return JSON.stringify(args ?? {});
}

// Parse JSONL log content into ordered assistant blocks. message_end records are
// authoritative. tool_execution_start records are a fallback for tool calls with no
// message_end block. Deltas are a fallback for a message with no message_end at all.
// Non-JSON lines group into one text block.
export function parseLogBlocks(content: string): AnalysisBlock[] {
	const blocks: AnalysisBlock[] = [];
	const results = new Map<string, ToolResultInfo>();
	const calls = new Map<string, AnalysisBlock>();
	let plain = "";
	let hasPlain = false;
	// delta accumulator for an open assistant message with no end yet
	let open: { thinking: string; text: string } | null = null;

	const pushPlain = () => {
		if (!hasPlain) return;
		blocks.push({ index: 0, type: "text", text: plain });
		plain = "";
		hasPlain = false;
	};
	// Ceiling: the deltas are not authoritative. A message with no message_end may be cut
	// mid-stream, so this fallback can hold partial text.
	const pushOpen = () => {
		if (!open) return;
		if (open.thinking.trim()) blocks.push({ index: 0, type: "thinking", text: open.thinking });
		if (open.text.trim()) blocks.push({ index: 0, type: "text", text: open.text });
		open = null;
	};
	const flushPending = () => {
		pushPlain();
		pushOpen();
	};
	const addCall = (id: string, toolName: string | undefined, text: string) => {
		const existing = calls.get(id);
		if (existing) {
			// the authoritative message_end arguments replace a fallback start record
			existing.text = text;
			if (toolName) existing.toolName = toolName;
			return;
		}
		const block: AnalysisBlock = { index: 0, type: "toolCall", toolName, text };
		blocks.push(block);
		calls.set(id, block);
	};

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let rec: Record<string, any>;
		try {
			rec = JSON.parse(trimmed);
		} catch {
			plain += (hasPlain ? "\n" : "") + line;
			hasPlain = true;
			continue;
		}
		if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
			plain += (hasPlain ? "\n" : "") + line;
			hasPlain = true;
			continue;
		}
		if (rec.isSidechain === true) continue; // nested subagent runs are not analysed
		if (rec.type === "message_end") {
			const msg = rec.message;
			if (!msg || typeof msg !== "object") continue;
			if (msg.role === "assistant") {
				// the authoritative end supersedes any deltas of this message
				open = null;
				pushPlain();
				const parts = Array.isArray(msg.content) ? msg.content : [];
				for (const part of parts) {
					if (!part || typeof part !== "object") continue;
					if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) {
						blocks.push({ index: 0, type: "thinking", text: part.thinking });
					} else if (part.type === "toolCall" && part.id) {
						addCall(part.id, typeof part.name === "string" ? part.name : undefined, argsText(part.arguments));
					} else if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
						blocks.push({ index: 0, type: "text", text: part.text });
					}
				}
			} else {
				// any other message_end closes a message that never got an end of its own
				flushPending();
				if (msg.role === "toolResult" && msg.toolCallId && !results.has(msg.toolCallId)) {
					results.set(msg.toolCallId, { text: resultText(msg), isError: msg.isError === true });
				}
			}
		} else if (rec.type === "tool_execution_end") {
			if (rec.toolCallId && !results.has(rec.toolCallId)) {
				results.set(rec.toolCallId, { text: resultText(rec.result), isError: rec.isError === true });
			}
		} else if (rec.type === "tool_execution_start") {
			// fallback: a tool call with no message_end block still shows up through its start record
			if (rec.toolCallId && !calls.has(rec.toolCallId)) {
				addCall(rec.toolCallId, typeof rec.toolName === "string" ? rec.toolName : undefined, argsText(rec.args));
			}
		} else if (rec.type === "message_update") {
			const ev = rec.assistantMessageEvent;
			if (open && ev && typeof ev === "object") {
				if (ev.type === "thinking_delta" && typeof ev.delta === "string") open.thinking += ev.delta;
				else if (ev.type === "text_delta" && typeof ev.delta === "string") open.text += ev.delta;
			}
		} else if (rec.type === "message_start") {
			flushPending();
			const msg = rec.message;
			if (msg && typeof msg === "object" && msg.role === "assistant") open = { thinking: "", text: "" };
		}
	}
	pushOpen();
	pushPlain();
	// attach the collected tool results to their tool call blocks
	for (const [id, block] of calls) {
		const info = results.get(id);
		if (info) {
			block.result = info.text;
			block.isError = info.isError;
		}
	}
	blocks.forEach((block, i) => {
		block.index = i + 1;
	});
	// a log with no structured blocks becomes one text block with the whole content
	if (blocks.length === 0) return [{ index: 1, type: "text", text: content }];
	return blocks;
}

// The pure analyser argv: the executable, the headless flags, then the prompt with -p.
export function buildAnalyserCommand(agent: string, llmFlags: string[], prompt: string): string[] {
	return [agent, "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", ...llmFlags, "-p", prompt];
}

function typeLabel(type: AnalysisBlock["type"], toolName?: string): string {
	return type === "toolCall" ? `toolCall ${toolName ?? "?"}` : type;
}

// One block content cap in the analyser prompt, in characters.
const BLOCK_CAP = 8000;

function blockContent(block: AnalysisBlock): string {
	if (block.type !== "toolCall") return block.text;
	let content = `Tool call ${block.toolName ?? "?"}. Arguments:\n${block.text}`;
	if (block.result !== undefined) content += `\n\nResult${block.isError ? " (error)" : ""}:\n${block.result}`;
	return content;
}

function pass1Prompt(block: AnalysisBlock): string {
	const instruction = "Summarize in 1 to 3 sentences what the agent did and whether it struggled (confusion, errors, retries, repeated work).";
	const format = 'Answer with two lines: "Summary: <your summary>" then "Struggle: <struggle signals, or none>".';
	let content = blockContent(block);
	if (content.length > BLOCK_CAP) content = content.slice(0, BLOCK_CAP) + "\n[Truncated at 8000 characters. The rest of this block text is cut.]";
	return `Block ${block.index} of type ${typeLabel(block.type, block.toolName)}.\n${instruction}\n${format}\n\n${content}`;
}

// Split an analyser answer into summary and struggle at the two labels. Without labels the
// whole answer is the summary.
function splitAnswer(answer: string): { summary: string; struggle: string } {
	const lines = answer.trim().split("\n");
	const struggleAt = lines.findIndex((line) => /^struggle:/i.test(line));
	const summaryAt = lines.findIndex((line) => /^summary:/i.test(line));
	let summary: string;
	if (summaryAt === -1 && struggleAt === -1) summary = answer.trim();
	else if (summaryAt === -1) summary = lines.slice(0, struggleAt).join(" ");
	else {
		const end = struggleAt > summaryAt ? struggleAt : lines.length;
		summary = [lines[summaryAt].replace(/^summary:\s*/i, ""), ...lines.slice(summaryAt + 1, end)].join(" ");
	}
	const flat = (text: string) => text.replace(/\s+/g, " ").trim();
	return { summary: flat(summary), struggle: flat(struggleAt === -1 ? "" : lines[struggleAt].replace(/^struggle:\s*/i, "")) };
}

function pass2Prompt(blocks: AnalysisBlock[], reports: BlockReport[], failedCount: number): string {
	const byType = { text: 0, thinking: 0, toolCall: 0 };
	const perTool = new Map<string, number>();
	for (const block of blocks) {
		byType[block.type]++;
		if (block.type === "toolCall") {
			const name = block.toolName ?? "?";
			perTool.set(name, (perTool.get(name) ?? 0) + 1);
		}
	}
	const toolErrors = blocks.filter((block) => block.type === "toolCall" && block.isError === true).length;
	const tools = perTool.size === 0 ? "none" : [...perTool].map(([name, count]) => `${name} ${count}`).join(", ");
	const stats = `Blocks: ${blocks.length} total (text ${byType.text}, thinking ${byType.thinking}, toolCall ${byType.toolCall}).\nTool calls per tool: ${tools}.\nErrors: ${toolErrors + failedCount} (tool results with errors plus failed block analyses).`;
	const instruction = "Produce a markdown analysis report of pain points (struggle, wasted time, inefficiency) with block number references.";
	// the prompt travels as one argv element. The kernel cap is 131072 bytes, so the prompt
	// stays below it. An over-cap block summary list is truncated with a marker
	const cap = 131_000;
	const marker = "[Truncated: the block summary list was cut here. The blocks after this point are missing.]";
	const entries = reports.map((report, i) => `${i + 1}. [${typeLabel(report.type, report.toolName)}] ${report.summary}\n   Struggle: ${report.struggle || "none"}`);
	const head = `${stats}\n\nBlock summaries:\n`;
	const tail = `\n\n${instruction}`;
	const budget = cap - Buffer.byteLength(head) - Buffer.byteLength(tail) - Buffer.byteLength(marker) - 1;
	const kept: string[] = [];
	let used = 0;
	for (const entry of entries) {
		const size = Buffer.byteLength(entry) + 1;
		if (used + size > budget) break;
		kept.push(entry);
		used += size;
	}
	let list = kept.join("\n");
	if (kept.length < entries.length) list += "\n" + marker;
	return head + list + tail;
}

// The default runner spawns the analyser and reads its JSONL stdout. The cwd is the
// directory of the log. The analyser runs with no tools and reads no files, so any stable
// cwd works, and the log directory keeps the child away from the caller's cwd.
function spawnAnalyser(argv: string[], cwd: string): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		let spawnFailed = false;
		let stdout = "";
		const done = (value: string | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => (stdout += chunk));
		child.on("error", () => (spawnFailed = true));
		child.on("close", () => done(spawnFailed ? null : analyserAnswer(stdout)));
	});
}

// The last assistant message_end in the analyser stdout. Non-JSON lines are ignored.
function analyserAnswer(stdout: string): string | null {
	let answer: string | null = null;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let rec: Record<string, any>;
		try {
			rec = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.type !== "message_end") continue;
		const msg = rec.message;
		if (!msg || typeof msg !== "object" || msg.role !== "assistant") continue;
		const parts = Array.isArray(msg.content) ? msg.content : [];
		answer = parts
			.filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
			.map((part) => (part as { text: string }).text)
			.join("\n");
	}
	return answer;
}

// Run one call per item with at most limit calls in flight.
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const workers: Promise<void>[] = [];
	for (let w = 0; w < Math.min(limit, items.length); w++) {
		workers.push(
			(async () => {
				for (;;) {
					const i = next++;
					if (i >= items.length) return;
					out[i] = await fn(items[i]);
				}
			})(),
		);
	}
	await Promise.all(workers);
	return out;
}

// One analyser call with a single retry. The reason feeds the failure notes.
async function callWithRetry(run: (argv: string[]) => Promise<string | null>, argv: string[]): Promise<{ answer: string | null; reason: string }> {
	let reason = "the analyser returned no answer";
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const answer = await run(argv);
			if (answer !== null) return { answer, reason: "" };
		} catch (err) {
			reason = err instanceof Error ? err.message : String(err);
		}
	}
	return { answer: null, reason };
}

// Full pipeline: read the log, parse the blocks, summarize each block in pass 1 with at
// most 8 analysers in flight, then produce the final analysis in pass 2. The report is
// written next to the log as the name minus the .log or .log.gz suffix plus .analysis.md.
export async function analyseLog(logPath: string, opts: AnalyseOptions = {}): Promise<AnalyseResult> {
	const agent = opts.agent ?? "pi";
	const flags = opts.llmFlags ?? [];
	const run = opts.runAnalyser ?? ((argv: string[]) => spawnAnalyser(argv, dirname(logPath)));
	const content = readLogFile(logPath);
	const blocks = parseLogBlocks(content);
	// pass 1: one analyser per block, in log order
	const outcomes = await pool(blocks, 8, async (block): Promise<{ report: BlockReport; failed: boolean }> => {
		const { answer, reason } = await callWithRetry(run, buildAnalyserCommand(agent, flags, pass1Prompt(block)));
		if (answer === null) {
			return {
				failed: true,
				report: { index: block.index, type: block.type, toolName: block.toolName, summary: `Block analysis failed after one retry: ${reason}`, struggle: "" },
			};
		}
		const { summary, struggle } = splitAnswer(answer);
		return {
			failed: false,
			report: { index: block.index, type: block.type, toolName: block.toolName, summary: summary || "the analyser returned no summary", struggle },
		};
	});
	const reports = outcomes.map((outcome) => outcome.report);
	const failedCount = outcomes.filter((outcome) => outcome.failed).length;
	// pass 2: one analyser for the whole report
	const second = await callWithRetry(run, buildAnalyserCommand(agent, flags, pass2Prompt(blocks, reports, failedCount)));
	const analysis = second.answer === null ? `Analysis failed after one retry: ${second.reason}` : second.answer.trim();
	const reportPath = reportPathFor(logPath);
	writeFileSync(reportPath, renderReport(logPath, reports, analysis));
	return { reportPath, blockCount: blocks.length, analysis, blocks: reports };
}

// The report sits next to the log. foo.log and foo.log.gz both become foo.analysis.md.
function reportPathFor(logPath: string): string {
	if (logPath.endsWith(".log.gz")) return logPath.slice(0, -".log.gz".length) + ".analysis.md";
	if (logPath.endsWith(".log")) return logPath.slice(0, -".log".length) + ".analysis.md";
	return logPath + ".analysis.md";
}

function renderReport(sourcePath: string, reports: BlockReport[], analysis: string): string {
	const lines: string[] = ["# Efficiency analysis", "", `Source log: ${sourcePath}`, `Date: ${new Date().toISOString()}`, "", "## Block summaries", ""];
	for (let i = 0; i < reports.length; i++) {
		const report = reports[i];
		lines.push(`${i + 1}. [${typeLabel(report.type, report.toolName)}] ${report.summary}`);
		lines.push(`   Struggle: ${report.struggle || "none"}`);
	}
	lines.push("", "## Analysis", "", analysis);
	return lines.join("\n") + "\n";
}
