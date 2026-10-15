// Efficiency analysis for one agent log. It parses the JSONL event stream, summarizes each
// assistant block with a headless analyst in pass 1, and turns the summaries plus simple
// stats into a markdown pain-point report in pass 2 with the doctor, which with a roleFile
// also revises the analysed role's guidance file. No wall-clock durations: compacted logs
// carry almost no per-event timestamps, so slowness is inferred from content.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
import { claudeAnalystArgs, claudeDoctorArgs, piLlmFlags, type Backend } from "./orchestrator/backends.ts";
import type { LlmConfig } from "./orchestrator/config.ts";

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
	summary: string; // 1 to 3 sentences, or the failure note when the analyst failed
	struggle: string; // struggle signals (confusion, errors, retries, repeated work) or ""
}

export interface AnalyseOptions {
	agent?: string; // default "pi"
	backend?: Backend; // default "pi"
	llm?: LlmConfig; // resolved provider/model/thinking for the backend llm flags, default {}
	concurrency?: number; // max in-flight block analysts, default 8
	mergeThreshold?: number; // chars: a text or thinking block shorter than this folds into the next block as lead-in context, default 250
	root?: string; // repo root whose agents/ holds the analyst and doctor prompt templates; default the package's own agents dir
	delay?: (ms: number) => Promise<void>; // wait before a retry attempt, default a real setTimeout, tests pass a no-op
	runAnalyst?: (argv: string[]) => Promise<string | null>; // returns the assistant answer text, null on failure
	runDoctor?: (argv: string[]) => Promise<string | null>; // defaults to the analyst runner with stream output persisted to doctorLogPath
	role?: string; // the analysed run's kanban role, named in the doctor prompt with roleFile
	roleFile?: string; // absolute path of the role file the doctor may revise; unset keeps the doctor report-only
	doctorLlm?: LlmConfig; // the doctor pass's resolved llm flags, default the analyst llm
	doctorLogPath?: string; // where the doctor pass's stream output persists; unset keeps it in memory
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
// its entries with newlines. A plain string content (claude tool_result) or a plain string
// payload is used as it is. Anything else is JSON text.
function resultText(payload: unknown): string {
	if (payload && typeof payload === "object") {
		const content = (payload as { content?: unknown }).content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const texts: string[] = [];
			for (const part of content) {
				if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text);
			}
			return texts.join("\n");
		}
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
// authoritative, and so are claude assistant records (stream-json). tool_execution_start
// records are a fallback for tool calls with no message_end block. Deltas are a fallback
// for a message with no message_end at all. Non-JSON lines group into one text block.
// claude records: parent_tool_use_id set marks subagent activity and skips like pi's
// isSidechain; stream_event deltas and the result record duplicate the assistant records.
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
		// plain text seen before this record flushes first, so the block order matches the log order
		pushPlain();
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
		if (rec.parent_tool_use_id != null) continue; // claude subagent activity in a parent log
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
		} else if (rec.type === "assistant") {
			// claude stream-json: the authoritative content blocks, one record per content slice
			const msg = rec.message;
			if (!msg || typeof msg !== "object" || msg.role !== "assistant") continue;
			open = null;
			pushPlain();
			const parts = Array.isArray(msg.content) ? msg.content : [];
			for (const part of parts) {
				if (!part || typeof part !== "object") continue;
				if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim()) {
					blocks.push({ index: 0, type: "thinking", text: part.thinking });
				} else if (part.type === "tool_use" && part.id) {
					addCall(part.id, typeof part.name === "string" ? part.name : undefined, argsText(part.input));
				} else if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
					blocks.push({ index: 0, type: "text", text: part.text });
				}
			}
		} else if (rec.type === "user") {
			// claude tool results; prompt echoes contribute no blocks
			const msg = rec.message;
			const parts = Array.isArray(msg?.content) ? msg.content : [];
			for (const part of parts) {
				if (part && typeof part === "object" && part.type === "tool_result" && part.tool_use_id && !results.has(part.tool_use_id)) {
					results.set(part.tool_use_id, { text: resultText(part), isError: part.is_error === true });
				}
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

// The pure analyst argv: the executable, the headless flags, then the prompt with -p.
export function buildAnalystCommand(agent: string, llmFlags: string[], prompt: string): string[] {
	return [agent, "--approve", "--no-session", "--no-extensions", "--no-skills", "--no-mcp", "--no-tools", "--mode", "json", ...llmFlags, "-p", prompt];
}

// The doctor argv: the analyst argv without --no-mcp and --no-tools, so the doctor may edit
// files (the role file rewrite).
export function buildDoctorCommand(agent: string, llmFlags: string[], prompt: string): string[] {
	return [agent, "--approve", "--no-session", "--no-extensions", "--no-skills", "--mode", "json", ...llmFlags, "-p", prompt];
}

function typeLabel(type: AnalysisBlock["type"], toolName?: string): string {
	return type === "toolCall" ? `toolCall ${toolName ?? "?"}` : type;
}

// One block content cap in the analyst prompt, in characters.
const BLOCK_CAP = 8000;

function blockContent(block: AnalysisBlock): string {
	if (block.type !== "toolCall") return block.text;
	let content = `Tool call ${block.toolName ?? "?"}. Arguments:\n${block.text}`;
	if (block.result !== undefined) content += `\n\nResult${block.isError ? " (error)" : ""}:\n${block.result}`;
	return content;
}

// The block content with the analyst cap: an over-cap block text is cut with a marker.
function cappedBlockContent(block: AnalysisBlock): string {
	const content = blockContent(block);
	if (content.length <= BLOCK_CAP) return content;
	return content.slice(0, BLOCK_CAP) + "\n[Truncated at 8000 characters. The rest of this block text is cut.]";
}

// Plain replacement of the known placeholders in one pass. An unknown placeholder stays
// literal text, and substitution values are never re-scanned.
function renderTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (token, name: string) => (name in values ? values[name] : token));
}

// One folded short block that travels in the next block's prompt.
interface LeadIn {
	type: AnalysisBlock["type"];
	text: string;
}

// One analysed block with its lead-in context.
interface MergedUnit {
	block: AnalysisBlock;
	leadIns: LeadIn[];
}

// Chars below which a text or thinking block folds into the next block as lead-in context.
const DEFAULT_MERGE_THRESHOLD = 250;

// One forward pass over the ordered blocks. A text or thinking block shorter than the
// threshold joins the next block as lead-in context, so no standalone meaningless fragment
// gets an analyst call. Consecutive short lead-ins accumulate in order. A short block with
// no following block stays standalone. A block at or above the threshold stays standalone.
function mergeLeadIns(blocks: AnalysisBlock[], threshold: number): { units: MergedUnit[]; mergedCount: number } {
	const units: MergedUnit[] = [];
	const pending: AnalysisBlock[] = [];
	let mergedCount = 0;
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const short = (block.type === "text" || block.type === "thinking") && block.text.length < threshold;
		if (short && i < blocks.length - 1) {
			pending.push(block);
			mergedCount++;
			continue;
		}
		units.push({ block, leadIns: pending.map((lead) => ({ type: lead.type, text: lead.text })) });
		pending.length = 0;
	}
	return { units, mergedCount };
}

// The joined lead-in lines with the same 8000-char cap as the block content. The lead-ins
// closest to the block are the direct context, so the cap keeps them and cuts the rest.
function cappedLeadIns(leadIns: LeadIn[]): string {
	const joined = leadIns.map((lead) => `lead-in [${lead.type}]: "${lead.text}"`).join("\n");
	if (joined.length <= BLOCK_CAP) return joined;
	// The tail keeps the lead-ins closest to the block. A half line at the start goes too.
	const tail = joined.slice(joined.length - BLOCK_CAP);
	const firstLine = tail.indexOf("\n");
	const kept = firstLine === -1 ? tail : tail.slice(firstLine + 1);
	return "[Truncated: the oldest lead-ins were cut.]\n" + kept;
}

// The pass-1 prompt: agents/analyst.md with the block's dynamic parts substituted. The
// toolName value carries a leading space so it joins the raw type into the header label
// ("toolCall read", "text").
function analystPrompt(template: string, block: AnalysisBlock, leadIns: LeadIn[]): string {
	const leadBlock = cappedLeadIns(leadIns);
	return renderTemplate(template, {
		blockIndex: String(block.index),
		blockType: block.type,
		toolName: block.type === "toolCall" ? ` ${block.toolName ?? "?"}` : "",
		blockContent: cappedBlockContent(block),
		leadIns: leadBlock ? leadBlock + "\n" : "",
	});
}

// Split an analyst answer into summary and struggle at the two labels. Without labels the
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

// Whole-prompt cap: the prompt travels as one argv element and the kernel rejects one over
// 131072 bytes, so the block summary list is budgeted under it and truncated with a marker
const PROMPT_CAP = 131_000;

// The pass-2 prompt: agents/doctor.md with the run's dynamic parts substituted. Without a
// roleFile the role file substitutes to the literal "none" and the template tells the
// doctor not to write any file.
function doctorPrompt(template: string, blocks: AnalysisBlock[], reports: BlockReport[], failedCount: number, mergedCount: number, roleFile?: string, role?: string): string {
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
	const values = {
		stats: `Blocks: ${blocks.length} total (text ${byType.text}, thinking ${byType.thinking}, toolCall ${byType.toolCall}).\nTool calls per tool: ${tools}.`,
		mergedCount: String(mergedCount),
		// the errors line counts tool results with errors plus failed block analyses, as before
		failedCount: String(toolErrors + failedCount),
		roleFile: roleFile ?? "none",
		// the role is named only with a role file, as before
		role: roleFile ? (role ?? "") : "none",
	};
	// render everything but the list, then budget the list so the whole prompt stays one
	// argv element under the kernel cap
	const shell = renderTemplate(template, values);
	const at = shell.indexOf("{{reports}}");
	if (at === -1) return shell;
	const marker = "[Truncated: the block summary list was cut here. The blocks after this point are missing.]";
	const entries = reports.map((report, i) => `${i + 1}. [${typeLabel(report.type, report.toolName)}] ${report.summary}\n   Struggle: ${report.struggle || "none"}`);
	const prefix = shell.slice(0, at);
	const suffix = shell.slice(at + "{{reports}}".length);
	const budget = PROMPT_CAP - Buffer.byteLength(prefix) - Buffer.byteLength(suffix) - Buffer.byteLength(marker) - 1;
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
	return prefix + list + suffix;
}

// The default runner spawns the analyst and reads its JSONL stdout. The cwd is the
// directory of the log. The analyst runs with no tools and reads no files, so any stable
// cwd works, and the log directory keeps the child away from the caller's cwd. logPath
// appends every stdout chunk there, so the doctor step's stream output persists next to
// the run log; the analyst pass passes none and keeps its stdout in memory.
function spawnAnalyst(argv: string[], cwd: string, logPath?: string): Promise<string | null> {
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
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
			if (logPath) {
				try {
					appendFileSync(logPath, chunk);
				} catch {
					// best-effort: the doctor stream persistence never fails the pass
				}
			}
		});
		child.on("error", () => (spawnFailed = true));
		child.on("close", () => done(spawnFailed ? null : analystAnswer(stdout)));
	});
}

// The final answer in the analyst stdout: pi's last assistant message_end, or claude's
// result record (the result field) with the assistant records as a fallback. Non-JSON lines
// are ignored.
export function analystAnswer(stdout: string): string | null {
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
		if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
		if (rec.type !== "message_end") {
			// claude stream-json stdout: the result record carries the final answer, an error run
			// has none; assistant records with no result record still carry the text
			if (rec.type === "result") {
				answer = rec.is_error === true || typeof rec.result !== "string" || !rec.result.trim() ? null : rec.result;
			} else if (rec.type === "assistant" && rec.message?.role === "assistant") {
				const parts = Array.isArray(rec.message.content) ? rec.message.content : [];
				const text = parts
					.filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
					.map((part) => (part as { text: string }).text)
					.join("\n");
				answer = text.trim() ? text : answer;
			}
			continue;
		}
		const msg = rec.message;
		if (!msg || typeof msg !== "object" || msg.role !== "assistant") continue;
		const parts = Array.isArray(msg.content) ? msg.content : [];
		const text = parts
			.filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
			.map((part) => (part as { text: string }).text)
			.join("\n");
		answer = text.trim() ? text : null;
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

// 3 attempts per analyst call, with this fixed wait before attempts 2 and 3.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

// One analyst call with 3 attempts and a fixed 5000 ms wait between attempts. The reason
// feeds the failure notes.
async function callWithRetry(run: (argv: string[]) => Promise<string | null>, argv: string[], delay: (ms: number) => Promise<void>): Promise<{ answer: string | null; reason: string }> {
	let reason = "the analyst returned no answer";
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
		if (attempt > 0) await delay(RETRY_DELAY_MS);
		try {
			const answer = await run(argv);
			if (answer !== null) return { answer, reason: "" };
		} catch (err) {
			reason = err instanceof Error ? err.message : String(err);
		}
	}
	return { answer: null, reason };
}

// Full pipeline: read the log, parse the blocks, merge short lead-in blocks forward, then
// summarize each kept block in pass 1 with at most concurrency analysts in flight
// (default 8), then produce the final analysis in pass 2 with the doctor, which with a
// roleFile option also revises that file. The report is written next to the log as the
// name minus the .log or .log.gz suffix plus .analysis.md.
export async function analyseLog(logPath: string, opts: AnalyseOptions = {}): Promise<AnalyseResult> {
	// the prompt files are the only prompt source, read once per run before any LLM call: a
	// missing or unreadable file fails the analysis with the path named, no inline fallback
	const promptDir = opts.root ? join(opts.root, "agents") : join(HERE, "..", "agents");
	const analystTemplate = readFileSync(join(promptDir, "analyst.md"), "utf8").trimEnd();
	const doctorTemplate = readFileSync(join(promptDir, "doctor.md"), "utf8").trimEnd();
	const agent = opts.agent ?? "pi";
	const backend = opts.backend ?? "pi";
	const llm = opts.llm ?? {};
	const doctorLlm = opts.doctorLlm ?? llm;
	const concurrency = opts.concurrency ?? 8;
	const mergeThreshold = opts.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD;
	const delay = opts.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const run = opts.runAnalyst ?? ((argv: string[]) => spawnAnalyst(argv, dirname(logPath)));
	const runDoctor = opts.runDoctor ?? ((argv: string[]) => spawnAnalyst(argv, dirname(logPath), opts.doctorLogPath));
	// per-backend argv: claude swaps pi's isolation flags for --bare and stream-json output
	const buildArgs = (prompt: string): string[] =>
		backend === "claude" ? [agent, ...claudeAnalystArgs(llm, prompt)] : buildAnalystCommand(agent, piLlmFlags(llm), prompt);
	// the doctor keeps the headless shape but drops the tool isolation, so it may edit files
	const buildDoctorArgs = (prompt: string): string[] =>
		backend === "claude" ? [agent, ...claudeDoctorArgs(doctorLlm, prompt)] : buildDoctorCommand(agent, piLlmFlags(doctorLlm), prompt);
	const content = readLogFile(logPath);
	const blocks = parseLogBlocks(content);
	// merge pass: short text and thinking blocks fold into the next block as lead-in context
	const { units, mergedCount } = mergeLeadIns(blocks, mergeThreshold);
	// pass 1: one analyst call per kept block, in log order
	const outcomes = await pool(units, concurrency, async (unit): Promise<{ report: BlockReport; failed: boolean }> => {
		const { answer, reason } = await callWithRetry(run, buildArgs(analystPrompt(analystTemplate, unit.block, unit.leadIns)), delay);
		if (answer === null) {
			return {
				failed: true,
				report: { index: unit.block.index, type: unit.block.type, toolName: unit.block.toolName, summary: `Block analysis failed after ${RETRY_ATTEMPTS} attempts: ${reason}`, struggle: "" },
			};
		}
		const { summary, struggle } = splitAnswer(answer);
		return {
			failed: false,
			report: { index: unit.block.index, type: unit.block.type, toolName: unit.block.toolName, summary: summary || "the analyst returned no summary", struggle },
		};
	});
	const reports = outcomes.map((outcome) => outcome.report);
	const failedCount = outcomes.filter((outcome) => outcome.failed).length;
	// the doctor log exists from the first moment: its presence marks the run analysed, so a
	// crash before the doctor pass never re-fires the orchestrator's spawn
	if (opts.doctorLogPath) writeFileSync(opts.doctorLogPath, "");
	// pass 2: one doctor call for the whole report, with a roleFile also revising it
	const second = await callWithRetry(runDoctor, buildDoctorArgs(doctorPrompt(doctorTemplate, units.map((unit) => unit.block), reports, failedCount, mergedCount, opts.roleFile, opts.role)), delay);
	const analysis = second.answer === null ? `Analysis failed after ${RETRY_ATTEMPTS} attempts: ${second.reason}` : second.answer.trim();
	const reportPath = reportPathFor(logPath);
	writeFileSync(reportPath, renderReport(logPath, reports, analysis));
	return { reportPath, blockCount: units.length, analysis, blocks: reports };
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
