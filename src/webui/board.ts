import { PRIORITY_RANK, STATES, type Task } from "../kanban.ts";
import { esc } from "./logpane.ts";

// board chrome: the column layout, task cards, agent-card formatters, relation curves and the
// FLIP diff; PAGE interpolates these as client source so the page runs the tested code
// FLIP diff, interpolated into PAGE so the client ships this exact source: which files changed
// board-content position between renders; new files and unchanged positions get no transform
export function flipDiff(oldPos, newPos) {
	const diff = {};
	for (const file in newPos) {
		const from = oldPos[file];
		if (!from) continue;
		const dx = from.x - newPos[file].x, dy = from.y - newPos[file].y;
		if (dx || dy) diff[file] = { dx, dy };
	}
	return diff;
}

// a run label on the detail card: the role capitalized, 1-based when the role has several runs
// (payload run 0 reads "1"), unnumbered for a solo run or a legacy unsuffixed log (a.run == null)
export function agentLabel(a, count) {
	return a.role[0].toUpperCase() + a.role.slice(1) + (count[a.role] > 1 && a.run != null ? " " + (a.run + 1) : "");
}

// tokens on an agent card: raw below 1000, kilo (42k), mega with one decimal from a million (2.3M);
// empty when the log carries no usage
export function fmtTokens(total) {
	if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return "";
	if (total < 1000) return String(total);
	if (total >= 999500) return (total / 1e6).toFixed(1) + "M";
	return Math.round(total / 1000) + "k";
}

// duration on an agent card: integer seconds, then minutes
export function fmtDur(ms) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
	const sec = Math.round(ms / 1000);
	if (sec < 60) return sec + "s";
	return Math.floor(sec / 60) + "m" + (sec % 60 ? " " + (sec % 60) + "s" : "");
}

// the stats line under an agent card's label (42k · 42s): tokens then duration, empty when both
// are missing; agentCardHtml and the in-place stats pass share it, so both render the same string
export function agentStatsText(tokens, duration) {
	return [fmtTokens(tokens), fmtDur(duration)].filter(Boolean).join(" · ");
}

// the summary card's bare totals text (42k · 4s): totals across all agent entries, input + output
// tokens and durations summed per entry (#178), the same agentStatsText format the agent cards'
// stats lines use; empty when no entry carries a usage record (#183, usage-less logs and live
// runs before their first usage record), or the task has no entries, or both totals are 0/null
export function taskStats(t) {
	const agents = t.agents || [];
	if (!agents.some((a) => typeof a.tokens === "number" && Number.isFinite(a.tokens))) return "";
	const toks = agents.reduce((s, a) => s + (typeof a.tokens === "number" ? a.tokens : 0), 0);
	const dur = agents.reduce((s, a) => s + (typeof a.duration === "number" ? a.duration : 0), 0);
	if (!toks && !dur) return "";
	return agentStatsText(toks, dur);
}

// the summary card's stats line under the chips: taskStats wrapped in the span, empty when the
// stats are hidden; syncBoard's in-place pass assigns taskStats to the span's textContent
export function taskStatsText(t) {
	const stats = taskStats(t);
	return stats ? '<span class="card-stats">' + stats + "</span>" : "";
}

// the open detail card's poll cadence (000142): a live agent's tokens and duration advance with
// the run log, so while the open task has one the poll ticks at 1 s; otherwise the 5 s board poll
export function refreshMs(t) {
	return t && (t.agents || []).some((a) => a.alive) ? 1000 : 5000;
}

// the agent row's structure: role, run, aliveness, status and handle per run. A changed set
// rebuilds the row (sub boxes carry over by handle), an unchanged one moves only the stats lines
export function agentRowSig(runs) {
	return runs.map((a) => [a.role, a.run, a.alive ? "live" : a.status, a.handle].join("/")).join("|");
}

// 000142: an unchanged agent row updates its cards' stats lines in place, so the live run's
// spinner animation survives the poll; a structure change (a run added or gone, live -> dead)
// returns false and the caller rebuilds, re-seeding the signature. The stats span joins the card
// html only when the stats are non-empty, matching agentCardHtml's markup; doc is injected so
// tests run this without a DOM.
export function syncAgentStats(el, runs, doc) {
	if (el.__sig !== agentRowSig(runs) || el.children.length !== runs.length) return false;
	for (let i = 0; i < runs.length; i++) {
		const stats = agentStatsText(runs[i].tokens, runs[i].duration);
		const card = el.children[i].children[0];
		if (card.__stats === stats) continue;
		card.__stats = stats;
		const span = [...card.children].find((c) => c.className === "agent-stats");
		if (span) {
			if (stats) span.textContent = stats;
			else span.remove();
		} else if (stats) {
			const s = doc.createElement("span");
			s.className = "agent-stats";
			s.textContent = stats;
			card.appendChild(s);
		}
	}
	return true;
}

// board layout, left to right: a string is a single column, an array is a stacked group with the
// first state on top. backlog stays a single side column, the states after it pair two by two in
// pipeline order (to-do over doing, to-review over reviewing, ...) while more than three remain,
// and the remaining tail (here to-live-test, live-testing, done, all non-blocking for the backlog)
// stacks together as the last group
export function pairLayout(states: readonly string[]): (string | string[])[] {
	const layout: (string | string[])[] = [states[0]];
	const tail = states.slice(1);
	let i = 0;
	while (tail.length - i > 3) {
		layout.push(tail.slice(i, i + 2));
		i += 2;
	}
	const rest = tail.slice(i);
	if (rest.length) layout.push(rest.length > 1 ? rest : rest[0]);
	return layout;
}

// interpolated into PAGE as JSON, so the client renders this exact layout
export const LAYOUT = pairLayout(STATES);

// the spinner marks a task the orchestrator is working on; a task that changes column changes this
// markup, so its animation starts or stops with the state, and prefers-reduced-motion turns the CSS
// animation off underneath
export function spinnerHtml(st: string) {
	return st === "doing" || st === "reviewing" || st === "live-testing" || st === "merging" ? '<span class="spin"></span>' : "";
}

// one card's markup without the trailing stats line: the card's structural identity across a
// refresh (syncBoard compares it), so a stats-only change can update the span in place and the
// run's spinner and entrance animations survive the poll. user-issued cards stay full contrast,
// task-issued ones (issuer "#<num>") dim the name and carry a small #<num> badge instead of the
// plain user chip; the complexity chip renders quiet next to the priority chip
export function cardBaseHtml(t: Task, st: string) {
	const issued = !!t.issuer && t.issuer !== "user";
	return (
		'<div class="name' +
		(issued ? " issued" : "") +
		'">' +
		spinnerHtml(st) +
		numLinkHtml(t.file, "num") +
		esc(t.name) +
		'</div> <span class="chip p-' +
		esc(t.priority) +
		'">' +
		esc(t.priority) +
		'</span> <span class="chip cx cx-' +
		esc(t.complexity || "moderate") +
		'">' +
		esc(t.complexity || "moderate") +
		'</span> <span class="chip' +
		(issued ? " issuer" : "") +
		'">' +
		(issued ? esc(t.issuer) : "user") +
		"</span>"
	);
}

// one card's markup; this string is the card's identity across a refresh, see syncBoard
export function cardHtml(t: Task, st: string) {
	return cardBaseHtml(t, st) + taskStatsText(t);
}

// a task id as a link: clicking opens that task's card in place of the shown one; data-task carries
// the file for the post-render binding, never an inline onclick (file names can hold quotes); the
// card's own id opens its own card, a blockedBy ref opens the referenced task's card
export function numLinkHtml(file: string, cls = "") {
	return '<span class="num-link' + (cls ? " " + cls : "") + '" data-task="' + esc(file) + '">#' + parseInt(file, 10) + "</span>";
}

// the bezier between two rendered cards, running blocked -> blocker so the dash animation flows
// towards the blocker: a loop out of the right sides within one column, otherwise the side pair
// that minimizes the line (blocker left of blocked: blocked's left edge to the blocker's right
// edge, reversed when the blocker sits to the right)
export function curve(from, to, same) {
	const mid = (r) => r.y + r.h / 2;
	const bow = 40;
	// 000127: a fixed bow flattens into a near-straight diagonal over a long cross-column span, so
	// scale the offset with the span (capped so extreme widths stay sane) and the curve bends into
	// an S that hugs the cards at both ends and crosses in the middle; near spans keep the bow
	const sBend = (a, b) => Math.max(bow, Math.min(Math.abs(b - a) * 0.35, 480));
	let x1, y1, x2, y2, c1x, c2x;
	if (same) {
		x1 = from.x + from.w;
		y1 = mid(from);
		x2 = to.x + to.w;
		y2 = mid(to);
		c1x = x1 + bow;
		c2x = x2 + bow;
	} else if (to.x < from.x) {
		x1 = from.x;
		y1 = mid(from);
		x2 = to.x + to.w;
		y2 = mid(to);
		const d = sBend(x1, x2);
		c1x = x1 - d;
		c2x = x2 + d;
	} else {
		x1 = from.x + from.w;
		y1 = mid(from);
		x2 = to.x;
		y2 = mid(to);
		const d = sBend(x1, x2);
		c1x = x1 + d;
		c2x = x2 - d;
	}
	return "M " + x1 + " " + y1 + " C " + c1x + " " + y1 + ", " + c2x + " " + y2 + ", " + x2 + " " + y2;
}

// one curve per stored relation the board can draw: the blocked task's card to each blocking
// task's card, both currently rendered, carrying both endpoint files for the hover highlight
// (000127, 000144). A "#<num>" ref maps to its task via parseInt(file); a ref
// without a rendered card is skipped, and a done blocker draws nothing. Stacked pair columns
// share one x, which counts as the same column (the right-side loop, never a line through the cards).
export function relationPaths(tasks, rectOf) {
	const out = [];
	for (const t of tasks) {
		const from = rectOf(t.file);
		if (!from) continue;
		for (const raw of String(t.blockedBy || "").split(",")) {
			const ref = raw.trim();
			if (!ref) continue;
			const blocker = tasks.find((x) => parseInt(x.file, 10) === parseInt(ref.replace(/^#/, ""), 10));
			if (!blocker || blocker.state === "done") continue;
			const to = rectOf(blocker.file);
			if (!to) continue;
			out.push({ file: t.file, blocker: blocker.file, d: curve(from, to, t.state === blocker.state || Math.abs(to.x - from.x) < 1) });
		}
	}
	return out;
}

// the board shell, built once: a single column per layout string, one .pair wrapper per stacked
// pair; returns each column's parts, keyed by state
export function buildShell(parent, doc) {
	const cols = {};
	const column = (st: string) => {
		const col = doc.createElement("section");
		col.className = "col c-" + st;
		const h2 = doc.createElement("h2");
		h2.textContent = st + " ";
		const count = doc.createElement("span");
		count.className = "count";
		h2.appendChild(count);
		const cards = doc.createElement("div");
		cards.className = "cards";
		const empty = doc.createElement("div");
		empty.className = "empty";
		empty.textContent = "\u2014";
		cards.appendChild(empty);
		const toggle = doc.createElement("button");
		toggle.className = "toggle";
		toggle.style.display = "none";
		col.appendChild(h2);
		col.appendChild(cards);
		col.appendChild(toggle);
		cols[st] = { col, count, cards, empty, toggle };
		return col;
	};
	for (const part of LAYOUT) {
		if (typeof part === "string") {
			parent.appendChild(column(part));
			continue;
		}
		const pair = doc.createElement("div");
		pair.className = "pair";
		for (const st of part) pair.appendChild(column(st));
		parent.appendChild(pair);
	}
	return cols;
}

// 000191: a stats-only change updates the summary card's .card-stats span in place, so the live
// run's spinner and entrance animations survive the poll (supersedes the accepted #178 restart);
// the span joins when stats arrive and drops when they vanish, matching taskStatsText's markup.
// doc is injected so tests run this without a DOM
export function syncCardStats(el, t, doc) {
	const stats = taskStats(t);
	const span = [...el.children].find((c) => c.className === "card-stats");
	if (span) {
		if (stats) span.textContent = stats;
		else span.remove();
	} else if (stats) {
		const s = doc.createElement("span");
		s.className = "card-stats";
		s.textContent = stats;
		el.appendChild(s);
	}
}

// one refresh pass: place every task's card in its column and update counts and the fold toggle. A
// card is rewritten only when its markup changed, so an unchanged card keeps its DOM node and with
// it its running spinner animation and in-flight FLIP transform; a stats-only change updates the
// .card-stats span in place (syncCardStats), and orders are fixed by moving nodes, so a card
// entering a column never rebuilds the cards already in it. A genuinely new card gains the
// "enter" class for the page's one-shot entrance animation. The caller measures card positions
// before and after this pass to animate the moves
export function syncBoard(cols, tasks, expanded, els, make, visible, doc) {
	// backlog is priority-first (critical above high above medium above low), every other column is
	// newest-first only; the sort is stable and the payload arrives in task-number order, so equal
	// keys keep that order
	const live = new Set();
	for (const st of Object.keys(cols)) {
		const inState = tasks
			.filter((t) => t.state === st)
			.sort((a, b) => (st === "backlog" ? (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) : 0) || b.updated - a.updated);
		const shown = expanded.has(st) ? inState : inState.slice(0, visible);
		const part = cols[st];
		part.count.textContent = inState.length;
		part.empty.style.display = shown.length ? "none" : "";
		part.toggle.style.display = inState.length > visible ? "" : "none";
		part.toggle.textContent = expanded.has(st) ? "show less" : "show all (" + inState.length + ")";
		let prev = null;
		for (const t of shown) {
			live.add(t.file);
			let el = els.get(t.file);
			if (!el) {
				el = make(t.file);
				// 000191: one-shot entrance on a genuinely new card; the page drops the class on
				// animationend, so a later poll or reorder never replays it
				el.className += " enter";
				els.set(t.file, el);
			}
			const html = cardHtml(t, st);
			if (el.__html !== html) {
				const base = cardBaseHtml(t, st);
				// 000191: matching base markup means only the stats line changed, so the span updates
				// in place and the spinner node keeps its animation; a brand-new card has no base yet
				if (el.__base === base) syncCardStats(el, t, doc);
				else el.innerHTML = html;
				el.__html = html;
				el.__base = base;
			}
			const next = prev ? prev.nextSibling : part.cards.firstChild;
			if (next !== el) part.cards.insertBefore(el, next);
			prev = el;
		}
	}
	for (const [file, el] of els) {
		if (live.has(file)) continue;
		el.remove();
		els.delete(file);
	}
}
