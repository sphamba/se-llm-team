// log pane rendering: the chunked JSONL renderer (renderLogChunk), the minimal Markdown renderer
// (md), the cross-chunk DOM fixups (logFixups) and the html escape both renderers share; the
// collapsed-line window constant and the role constants the payload builders read live here too
// 000158: init and back-fill load a fixed number of collapsed lines, not a byte chunk: a thinking
// block (thinking_start..thinking_end records) and a tool call block (tool_execution_start..end)
// each count as ONE line, so a window boundary always falls between blocks, never inside one, and
// no block is ever broken on load or back-fill; 000166: a thinking block still open at the live
// tail (no thinking_end yet) counts as ONE line too, so a live phase never splits across windows
export const LOG_LINES = 100;

// working state -> the agent role the orchestrator spawns for it (spawnAgent, src/orchestrator.ts);
// a to-do task's stage is the Splitter, so its card reads the splitter run live
export const AGENT_ROLE = { "to-do": "splitter", doing: "developer", reviewing: "reviewer", "live-testing": "live-tester", "integration-testing": "integration-tester", merging: "merger" };
// the roles the orchestrator writes per task log: the Splitter (on the to-do task, before the
// Developer), the state-mapped roles, then the doctor; the set drops the merger's duplicate, the
// merging state maps to it. The history orders each run by its first in-log record, so this
// enumeration order only breaks identical-timestamp ties. The doctor analysis writes no per-task
// run log: its stream output rides next to the analysed run's log as
// <slug>.<role>.<n>.doctor.log, enumerated by the payload builder's doctor history
export const LOG_ROLES = [...new Set(["splitter", ...Object.values(AGENT_ROLE), "doctor"])];

// html escape, shipped to the client and shared with the tab renderer
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// pi --mode json writes JSONL event records (docs/json.md); everything else in the log file is
// non-JSON: stderr diagnostics and legacy print-mode final text, passed through escaped. The
// chunk renders to the HTML fragments the detail card ingests (ingest, the PAGE script): text and
// prompts as escaped lines, thinking blocks and tool calls as collapsed <details> elements. One
// tool block per call: the streamed toolcall_end and the execution start both carry name + args,
// so dedupe by id within the chunk; a block stays open for its result across chunks (data-tc),
// and a result whose block lives in an earlier chunk renders the joinable span. An assistant
// message_end repeats its streamed text deltas, so only the user prompt (the run's opening
// message) renders from message_end. A subagent .output transcript is sidechain session records
// (user/assistant/toolResult): prompt and text render as lines, thinking and tool calls join the
// same blocks and dedupe.
// claude stream-json records render from the authoritative assistant/user records: message
// content blocks (text, thinking, tool_use) and tool_result blocks join the same UI. The
// stream_event deltas duplicate those records, so they skip; upgrade path: prefer the deltas
// when a claude spawn adds --include-partial-messages.
const ARG_KEYS = ["command", "path", "file_path", "pattern", "url", "query"];
const cap = (s: string, max = 160) => (s.length > max ? s.slice(0, max - 3) + "..." : s);

// the string argument a tool summary keys on: an ARG_KEYS match first, else the first string value
function argValue(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const rec = args as Record<string, unknown>;
	let value: unknown;
	for (const key of ARG_KEYS) {
		if (typeof rec[key] === "string" && rec[key]) {
			value = rec[key];
			break;
		}
	}
	value ??= Object.values(rec).find((v) => typeof v === "string" && v);
	return typeof value === "string" ? value : "";
}

// the one-liner under the tool name in the collapsed summary: the first line of the command/input
// or the file path, capped at 80 chars
function oneLiner(args: unknown): string {
	const value = argValue(args);
	return value ? cap(value.split("\n")[0].replace(/\s+/g, " ").trim(), 80) : "";
}

function textOf(result: unknown, max = 200): string {
	const content = (result as { content?: { type?: string; text?: string }[] | string } | undefined)?.content;
	if (typeof content === "string") return cap(content.replace(/\s+/g, " ").trim(), max);
	const text = Array.isArray(content) ? content.find((c) => c?.type === "text")?.text : undefined;
	return typeof text === "string" ? cap(text.replace(/\s+/g, " ").trim(), max) : "";
}

interface ToolBlock {
	idx: number;
	id: string;
	name: string;
	args: string;
	one: string;
	result: string;
	fail: string | null;
}

// minimal Markdown renderer for the board subset (headings, lists, code fences, GFM pipe tables,
// inline code, bold, links, paragraphs), shared by task-card bodies and the agent log text; esc()
// runs before markup applies, so rendered text can never inject tags; ceiling: swap for a full
// renderer when the subset grows
export const inline = (s) => s
	.replace(/`([^`]+)`/g, "<code>$1</code>")
	.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
	.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

// 000299: the text a record adds to a chunk's pending markdown run, null when it adds none; every
// content block must be text, so a record that also carries a tool call or a thinking block is
// never swept into a held-back line
export function runText(line: string): string | null {
	let rec: Record<string, any>;
	try {
		rec = JSON.parse(line);
	} catch {
		return null;
	}
	if (!rec || typeof rec !== "object") return null;
	if (rec.type === "message_update") {
		const ev = rec.assistantMessageEvent;
		return ev?.type === "text_delta" ? String(ev.delta ?? "") : null;
	}
	const msg = rec.message;
	const blocks = rec.type === "assistant" || (rec.isSidechain === true && msg?.role === "assistant") ? msg?.content : [];
	let text = "";
	for (const b of Array.isArray(blocks) ? blocks : []) {
		if (b?.type !== "text" || typeof b.text !== "string") return null;
		text += b.text;
	}
	return text || null;
}

// 000299: the records at the end of a window whose line has not closed yet, so the line continues
// in a record the window does not hold: init and poll hold them back (payload) while the run is
// alive, a history chunk or a finished run renders them as one paragraph (renderLogChunk). 0 when
// the last text record closes its line, and 0 when a record carries a complete line before the open
// one: holding that record would repeat a line already rendered
export function openRun(lines: string[]): number {
	let n = 0;
	for (let i = lines.length - 1; i >= 0; i--) {
		const t = runText(lines[i]);
		if (t === null || t.endsWith("\n")) return n;
		if (t.includes("\n")) return 0; // the line starts inside this record: hold nothing, no duplicate
		n++;
	}
	return n;
}

// GFM pipe-table branch: a header row plus a separator row of dashes/colons opens a table; cells
// split on unescaped pipes (a \| escape stays in its cell), the separator colons set the
// alignment, a ragged row normalizes to the header count, and each cell renders through inline().
// The helpers live inside md so the page's injected function source carries every name it reads.
export function md(src) {
	const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
	const tableCells = (line) => {
		const cells = line.replace(/\\\|/g, "\u0001").split("|").map((c) => c.trim().replace(/\u0001/g, "|"));
		// a leading or trailing pipe delimits the row, it never opens an empty cell
		if (cells.length > 1 && cells[0] === "") cells.shift();
		if (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
		return cells;
	};
	const tableAlign = (c) => (c.startsWith(":") && c.endsWith(":") ? ' style="text-align:center"' : c.endsWith(":") ? ' style="text-align:right"' : "");
	let html = "", list = false, fence = false, quote = false;
	const closeList = () => { if (list) { html += "</ul>"; list = false; } };
	const closeQuote = () => { if (quote) { html += "</blockquote>"; quote = false; } };
	const lines = esc(src).split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().slice(0, 3) === "```") { closeList(); closeQuote(); fence = !fence; html += fence ? "<pre><code>" : "</code></pre>"; continue; }
		if (fence) { html += line + "\n"; continue; }
		// #310: consecutive `> ` lines form one blockquote, a lone `>` is the paragraph break inside
		// it (no empty p), and any line that is not a quote line closes it
		const q = line.match(/^&gt;(?: (.*))?$/);
		if (q) {
			closeList();
			if (!quote) { html += "<blockquote>"; quote = true; }
			if (q[1] && q[1].trim()) html += "<p>" + inline(q[1]) + "</p>";
			continue;
		}
		closeQuote();
		const h = line.match(/^(#{1,6}) (.+)$/);
		if (h) { closeList(); html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; continue; }
		const li = line.match(/^[-*] (.+)$/);
		if (li) { if (!list) { html += "<ul>"; list = true; } html += "<li>" + inline(li[1]) + "</li>"; continue; }
		closeList();
		const sep = lines[i + 1];
		if (line.includes("|") && sep !== undefined && TABLE_SEP.test(sep)) {
			const head = tableCells(line), align = tableCells(sep).map(tableAlign);
			const cell = (tag, text, k) => "<" + tag + (k ? "" : ' class="md-pin"') + (align[k] ?? "") + ">" + inline(text) + "</" + tag + ">";
			let tbl = "<table><thead><tr>";
			head.forEach((c, k) => (tbl += cell("th", c, k)));
			tbl += "</tr></thead><tbody>";
			for (i += 2; i < lines.length && lines[i].includes("|"); i++) {
				const row = tableCells(lines[i]);
				tbl += "<tr>";
				for (let k = 0; k < head.length; k++) tbl += cell("td", row[k] ?? "", k);
				tbl += "</tr>";
			}
			tbl += "</tbody></table>";
			// 000299: a row run that reaches the end of the input leaves the table open, so the client
			// absorbs the rows a later chunk appends to it; the dialog renders md with no following
			// siblings, so the marker is inert there
			const open = lines.slice(i).every((l) => !l.trim());
			html += '<div class="md-table-wrap"' + (open ? ' data-open="tbl"' : "") + ">" + tbl + "</div>";
			i--; // the loop step lands on the first line after the table
			continue;
		}
		if (line.trim()) html += "<p>" + inline(line) + "</p>";
	}
	closeList();
	closeQuote();
	if (fence) html += "</code></pre>";
	return html;
}

export function renderLogChunk(text: string): string {
	const out: string[] = [];
	let pending = "";
	// each chunk renders standalone, so a construct split across a chunk boundary renders as two
	// pieces: md auto-closes an open fence at the end of its input and the continuation chunk
	// re-opens its own; upgrade path: carry per-slug render state across polls
	const flush = () => {
		if (pending) {
			out.push(md(pending));
			pending = "";
		}
	};
	const lines = text.split("\n");
	lines.pop(); // split's last element is the trailing-newline sentinel or a byte-split partial record, not content
	// 000299: a run of records whose text carries no newline yet ends mid-line, so it cannot be a
	// table row: it leaves md()'s input and renders as one paragraph, and the table before it ends at
	// its last complete row. 000360 leaves the page boundaries to the server, which snaps every head
	// to a block start, so a window never begins inside a line or inside a table.
	const hold = openRun(lines);
	const held = hold ? lines.splice(lines.length - hold, hold) : [];
	const seenTools = new Set<string>();
	// tool blocks opened in this chunk, keyed by toolCallId: a tool_execution_end for an id here
	// fills the block, an id from an earlier chunk renders the joinable span the client resolves
	const tools = new Map<string, ToolBlock>();
	const toolHtml = (t: ToolBlock) =>
		'<details class="lg-tool" data-tc="' +
		esc(t.id) +
		'"><summary>' +
		esc(t.fail !== null ? t.name + " failed" + (t.fail ? ": " + t.fail : "") : t.name + (t.one ? ": " + t.one : "")) +
		'</summary><pre class="lg-args">' +
		esc(t.args) +
		"</pre>" +
		(t.result ? '<pre class="lg-out">' + esc(t.result) + "</pre>" : "") +
		"</details>";
	let think: string | null = null; // the open thinking block's deltas, filled at thinking_end or chunk end
	let thinkIdx = -1;
	const thinkHtml = (open: boolean) =>
		'<details class="lg-think"' + (open ? ' data-open="think"' : "") + "><summary>Thinking</summary><pre>" + md(think ?? "") + "</pre></details>";
	let cont: string | null = null; // thinking deltas continuing the previous chunk's block, one span per chunk
	let contIdx = -1;
	const openTool = (id: unknown, name: unknown, args: unknown) => {
		if (typeof id !== "string" || !id || seenTools.has(id)) return;
		seenTools.add(id);
		flush();
		out.push("");
		tools.set(id, {
			idx: out.length - 1,
			id,
			name: typeof name === "string" && name ? name : "?",
			args: JSON.stringify(args ?? {}, null, 2),
			one: oneLiner(args),
			result: "",
			fail: null,
		});
	};
	const joinTool = (id: unknown, name: unknown, isError: boolean, result: unknown) => {
		const t = typeof id === "string" ? tools.get(id) : undefined;
		if (t) {
			t.result = textOf(result, 2000);
			if (isError) t.fail = textOf(result);
			return;
		}
		// the block lives in an earlier chunk: the span joins it client-side, or shows the text as a
		// line (errors as their failed summary) when the walk-back left the block unloaded
		if (typeof id !== "string" || !id) return;
		const err = isError ? textOf(result) : null;
		const text = textOf(result, 2000);
		if (!text && err === null) return;
		flush();
		out.push(
			'<span class="lg-tres" data-tc="' +
				esc(id) +
				'"' +
				(err !== null ? ' data-sum="' + esc((typeof name === "string" && name ? name : "?") + " failed" + (err ? ": " + err : "")) + '"' : "") +
				">" +
				esc(text) +
				"</span>",
		);
	};
	for (const line of lines) {
		let rec: Record<string, any>;
		try {
			rec = JSON.parse(line);
		} catch {
			flush();
			out.push(esc(line) + "\n");
			continue;
		}
		if (!rec || typeof rec !== "object") {
			flush();
			out.push(esc(line) + "\n");
			continue;
		}
		if (rec.type === "message_update") {
			const ev = rec.assistantMessageEvent;
			if (!ev || typeof ev !== "object") continue;
			if (ev.type === "thinking_start") {
				if (think === null) {
					flush();
					out.push("");
					thinkIdx = out.length - 1;
					think = "";
				}
			} else if (ev.type === "thinking_delta") {
				if (think !== null) {
					think += ev.delta ?? "";
				} else {
					// deltas with no thinking_start in this chunk continue the previous chunk's block
					if (cont === null) {
						flush();
						out.push("");
						contIdx = out.length - 1;
						cont = "";
					}
					cont += ev.delta ?? "";
				}
			} else if (ev.type === "thinking_end") {
				// the authoritative content replaces the reconstructed deltas (docs/json.md)
				if (think !== null) {
					if (typeof ev.content === "string") think = ev.content;
					out[thinkIdx] = thinkHtml(false);
					think = null;
					thinkIdx = -1;
				} else if (typeof ev.content === "string") {
					// the start lived in an earlier chunk: the final span closes the client's open
					// block and replaces its reconstructed deltas with the authoritative text
					flush();
					out.push('<span class="lg-cont" data-final="1">' + esc(ev.content) + "</span>");
				}
			} else if (ev.type === "text_delta") {
				pending += ev.delta ?? "";
			} else if (ev.type === "text_start") {
				flush();
			} else if (ev.type === "toolcall_end") {
				openTool(ev.toolCall?.id, ev.toolCall?.name, ev.toolCall?.arguments);
			}
		} else if (rec.type === "tool_execution_start") {
			openTool(rec.toolCallId, rec.toolName, rec.args);
		} else if (rec.type === "tool_execution_end") {
			joinTool(rec.toolCallId, rec.toolName, rec.isError === true, rec.result);
		} else if (rec.type === "message_end") {
			const msg = rec.message;
			if (msg?.role === "user" && typeof msg.content === "string" && msg.content.trim()) {
				flush();
				out.push("[prompt] " + esc(cap(msg.content.replace(/\s+/g, " ").trim())) + "\n");
			}
		} else if (rec.isSidechain === true && rec.message && typeof rec.message === "object") {
			// pi sidechain records key on isSidechain, so they check before the claude branches
			const msg = rec.message;
			if (msg.role === "user") {
				const text = typeof msg.content === "string" ? msg.content : "";
				if (text.trim()) {
					flush();
					out.push("[prompt] " + esc(cap(text.replace(/\s+/g, " ").trim())) + "\n");
				}
			} else if (msg.role === "assistant") {
				const blocks = Array.isArray(msg.content) ? msg.content : [];
				for (const block of blocks) {
					if (block?.type === "toolCall") {
						openTool(block.id, block.name, block.arguments);
					} else if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
						flush();
						out.push('<details class="lg-think"><summary>Thinking</summary><pre>' + md(block.thinking) + "</pre></details>");
					} else if (block?.type === "text" && typeof block.text === "string" && block.text) {
						pending += block.text;
					}
				}
			} else if (msg.role === "toolResult") {
				joinTool(msg.toolCallId, msg.toolName, msg.isError === true, msg);
			}
		} else if (rec.type === "assistant") {
			// claude stream-json: the authoritative message content blocks (no deltas needed)
			const blocks = Array.isArray(rec.message?.content) ? rec.message.content : [];
			for (const block of blocks) {
				if (block?.type === "tool_use") {
					openTool(block.id, block.name, block.input);
				} else if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
					flush();
					out.push('<details class="lg-think"><summary>Thinking</summary><pre>' + md(block.thinking) + "</pre></details>");
				} else if (block?.type === "text" && typeof block.text === "string" && block.text) {
					pending += block.text;
				}
			}
		} else if (rec.type === "user") {
			const msg = rec.message;
			if (typeof msg?.content === "string" && msg.content.trim()) {
				flush();
				out.push("[prompt] " + esc(cap(msg.content.replace(/\s+/g, " ").trim())) + "\n");
			}
			const blocks = Array.isArray(msg?.content) ? msg.content : [];
			for (const block of blocks) {
				if (block?.type === "tool_result") {
					joinTool(block.tool_use_id, block.toolName, block.is_error === true, block);
				} else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
					flush();
					out.push("[prompt] " + esc(cap(block.text.replace(/\s+/g, " ").trim())) + "\n");
				}
			}
		} else if (rec.type === "stream_event") {
			// claude partial-message deltas duplicate the assistant/user records that follow
		}
	}
	if (held.length) {
		// the run left md()'s input, so the table ends at its last complete row: its open marker goes,
		// else the client would absorb the partial line as a row
		const rest = md(pending).replace(' data-open="tbl"', "");
		pending = "";
		if (rest) out.push(rest);
		out.push(md(held.map((l) => runText(l) ?? "").join("")));
	} else flush();
	if (cont) out[contIdx] = '<span class="lg-cont">' + esc(cont) + "</span>";
	if (think !== null) out[thinkIdx] = thinkHtml(true); // the block continues into the next chunk
	for (const t of tools.values()) out[t.idx] = toolHtml(t);
	return out.join("");
}

// the cross-chunk fixups over the whole pane, run after every chunk insert: duplicate tool blocks
// (a record split across poll windows re-serves the start) drop keeping the first; a later tool
// result joins its block by toolCallId, an orphan one promotes to a collapsible details (the
// data-sum one-liner as the summary, a generic "result" without one, the result text as the body);
// thinking deltas continuing the previous chunk's block append into the marked open block, an
// unjoined one promotes to a collapsible details too (marked open so later delta polls join it);
// a final close span (data-final, a cross-window thinking_end) replaces the marked block's body
// with the authoritative text and unmarks it, or promotes to a closed block of its own; doc is
// injected so tests run this without a DOM
export function logFixups(el, doc) {
	const seen = new Set();
	for (const d of el.querySelectorAll("details.lg-tool[data-tc]")) {
		if (seen.has(d.dataset.tc)) d.remove(); else seen.add(d.dataset.tc);
	}
	for (const s of el.querySelectorAll(".lg-tres")) {
		const b = el.querySelector('details.lg-tool[data-tc="' + CSS.escape(s.dataset.tc) + '"]');
		if (b) {
			if (s.dataset.sum) b.querySelector("summary").textContent = s.dataset.sum;
			const out = doc.createElement("pre");
			out.className = "lg-out";
			out.textContent = s.textContent;
			b.appendChild(out);
			s.remove();
			continue;
		}
		const d = doc.createElement("details");
		d.className = "lg-tool";
		const sum = doc.createElement("summary");
		sum.textContent = s.dataset.sum || "result";
		const out = doc.createElement("pre");
		out.className = "lg-out";
		out.textContent = s.textContent;
		d.append(sum, out);
		s.replaceWith(d);
	}
	for (const s of el.querySelectorAll(".lg-cont")) {
		const final = !!s.dataset.final;
		let b = s.previousElementSibling;
		while (b && !(b.classList.contains("lg-think") && b.dataset.open === "think")) b = b.previousElementSibling;
		if (b) {
			if (final) {
				b.querySelector("pre").textContent = s.textContent;
				delete b.dataset.open;
			} else {
				b.querySelector("pre").append(s.textContent);
			}
			s.remove();
			continue;
		}
		const d = doc.createElement("details");
		d.className = "lg-think";
		if (!final) d.dataset.open = "think"; // later delta polls walk back to this block and join it
		const sum = doc.createElement("summary");
		sum.textContent = "Thinking";
		const pre = doc.createElement("pre");
		pre.textContent = s.textContent;
		d.append(sum, pre);
		s.replaceWith(d);
	}
	// 000299: a table still open at the end of its chunk (data-open=tbl) absorbs the row paragraphs
	// that follow it in another chunk: a row streamed in a later poll, or the older chunk's body rows
	// after a scroll-up prepends it above rows already in the pane. A pipe paragraph becomes a row on
	// the head's column count and alignment, its html inserted as rendered; the first other sibling
	// stops the absorb and closes the table, while a run that ends the pane leaves it open for the
	// next poll. Every name here is local: the page ships this function as source.
	for (const w of el.querySelectorAll(".md-table-wrap")) {
		if (w.dataset.open !== "tbl") continue;
		const table = w.querySelector("table");
		const tbody = table.querySelector("tbody");
		const align = [];
		for (const th of table.querySelectorAll("th")) align.push(th.style.textAlign ? ' style="text-align:' + th.style.textAlign + '"' : "");
		// the row a paragraph becomes: split on unescaped pipes (a \| escape stays inside its cell,
		// like md's tableCells), pad or clip to the head's count, pin the first column as md does.
		// Ceiling: the split runs on the rendered html, so a cell whose own markup carries a pipe
		// cannot be told from a cell delimiter; upgrade path: carry the row's raw line
		const rowHtml = (html) => {
			const cells = html.replace(/\\\|/g, "\u0001").split("|").map((c) => c.trim().replace(/\u0001/g, "|"));
			if (cells.length > 1 && cells[0] === "") cells.shift();
			if (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
			let row = "<tr>";
			for (let k = 0; k < align.length; k++) row += "<td" + (k ? "" : ' class="md-pin"') + (align[k] ?? "") + ">" + (cells[k] ?? "") + "</td>";
			return row + "</tr>";
		};
		let sib = w.nextElementSibling;
		while (sib && sib.tagName === "P" && sib.textContent.includes("|")) {
			const next = sib.nextElementSibling;
			const tr = doc.createElement("tr");
			tr.innerHTML = rowHtml(sib.innerHTML);
			tbody.appendChild(tr);
			sib.remove();
			sib = next;
		}
		if (sib) delete w.dataset.open; // a non-row sibling closes the table
	}
}
