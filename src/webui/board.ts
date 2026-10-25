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
// (payload run 0 reads "1"), unnumbered for a solo run, a legacy unsuffixed log (a.run == null) or
// a doctor entry (the run index is the analysed run's, so it never numbers a doctor card)
export function agentLabel(a, count) {
	return a.role[0].toUpperCase() + a.role.slice(1) + (a.role !== "doctor" && count[a.role] > 1 && a.run != null ? " " + (a.run + 1) : "");
}

// tokens on an agent card: raw below 1000, kilo (42k), mega with one decimal from a million (2.3M);
// empty when the log carries no usage
export function fmtTokens(total) {
	if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return "";
	if (total < 1000) return String(total);
	if (total >= 999500) return (total / 1e6).toFixed(1) + "M";
	return Math.round(total / 1000) + "k";
}

// duration on an agent card: integer seconds, then minutes, then hours from 3600s (000200)
export function fmtDur(ms) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
	const sec = Math.round(ms / 1000);
	if (sec < 60) return sec + "s";
	if (sec < 3600) return Math.floor(sec / 60) + "m" + (sec % 60 ? " " + (sec % 60) + "s" : "");
	const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
	return h + "h" + (m ? " " + m + "m" : "") + (s ? " " + s + "s" : "");
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

// one agent card's stats line moved in place: the span joins when stats arrive and drops when
// they vanish, matching agentCardHtml's markup; syncAgentStats and the doctor keep pass
// (syncDoctorCards) share it, so both render the same line. doc is injected so tests run this
// without a DOM
export function syncStatsLine(card, tokens, duration, doc) {
	const stats = agentStatsText(tokens, duration);
	if (card.__stats === stats) return;
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

// 000142: an unchanged agent row updates its cards' stats lines in place, so the live run's
// spinner animation survives the poll; a structure change (a run added or gone, live -> dead)
// returns false and the caller rebuilds, re-seeding the signature. The run row's cards sit in
// .agent-col wrappers, the run card first (the doctor cards slot below the sub boxes). doc is
// injected so tests run this without a DOM.
export function syncAgentStats(el, runs, doc) {
	if (el.__sig !== agentRowSig(runs) || el.children.length !== runs.length) return false;
	for (let i = 0; i < runs.length; i++) syncStatsLine(el.children[i].children[0], runs[i].tokens, runs[i].duration, doc);
	return true;
}

// 000230 the analysed run's column for a doctor card: a doctor entry's handle is the parent run's
// handle plus the .doctor suffix, so strip it and match the run card's data-handle (the run card
// is the column's first child); null when no column carries it (the run log rotated away) and the
// card falls back to the residual #m-doctor row
export function doctorCol(row, handle) {
	const parent = handle.replace(/\.doctor$/, "");
	for (const col of row.children) {
		const card = col.children[0];
		if (card && card.dataset.handle === parent) return col;
	}
	return null;
}

// 000230 the doctor keep pass: an unchanged set whose cards still sit in their slots moves only
// the stats lines in place, so the live doctor's spinner survives the poll; a structure change (a
// doctor added or gone, a slot change, a run-row rebuild that detached the slotted cards, live ->
// dead via the sig) returns false and renderDoctor rebuilds. residual is the #m-doctor fallback
// row for the cards whose run column is gone. doc is injected so tests run this without a DOM
export function syncDoctorCards(cards, docs, row, residual, doc) {
	if (residual.__sig !== agentRowSig(docs) || docs.length !== cards.length) return false;
	for (let i = 0; i < docs.length; i++) {
		if (!cards[i] || cards[i].dataset.handle !== docs[i].handle) return false;
		if (cards[i].parentElement !== (doctorCol(row, docs[i].handle) ?? residual)) return false;
	}
	for (let i = 0; i < docs.length; i++) syncStatsLine(cards[i], docs[i].tokens, docs[i].duration, doc);
	return true;
}

// board layout, left to right: a string is a single column, an array is a stacked group with the
// first state on top. backlog stays a single left column, the states after it pair two by two in
// pipeline order (to-do over doing, to-review over reviewing, ...) while more than TAIL_STATES
// remain, the remaining tail (the four non-blocking live-test and integration states) stacks as
// one group, and done closes the row as its own single column
const TAIL_STATES = 4;
export function pairLayout(states: readonly string[]): (string | string[])[] {
	const layout: (string | string[])[] = [states[0]];
	const tail = states.slice(1);
	let i = 0;
	while (tail.length - i > TAIL_STATES) {
		layout.push(tail.slice(i, i + 2));
		i += 2;
	}
	const rest = tail.slice(i);
	if (rest.length) layout.push(rest.length > 1 ? rest : rest[0]);
	return layout;
}

// interpolated into PAGE as JSON, so the client renders this exact layout; done is appended as a
// single column so the tail stack never absorbs it
export const LAYOUT = [...pairLayout(STATES.slice(0, -1)), STATES[STATES.length - 1]];

// the spinner marks a task the orchestrator is working on; a task that changes column changes this
// markup, so its animation starts or stops with the state, and prefers-reduced-motion turns the CSS
// animation off underneath
export function spinnerHtml(st: string) {
	return st === "doing" || st === "reviewing" || st === "live-testing" || st === "merging" || st === "integration-testing" ? '<span class="spin"></span>' : "";
}

// one card's markup without the trailing stats line: the card's structural identity across a
// refresh (syncBoard compares it), so a stats-only change can update the span in place and the
// run's spinner and entrance animations survive the poll. user-issued cards stay full contrast,
// task-issued ones (issuer "#<num>") dim the name and carry a small #<num> badge instead of the
// plain chip; the orchestrator's own "auto" issuer gets a plain chip labelled "auto", with no
// badge and no link, and the complexity chip renders quiet next to the priority chip
export function cardBaseHtml(t: Task, st: string) {
	const issued = !!t.issuer && /^#\d+$/.test(t.issuer);
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
		(issued ? esc(t.issuer) : esc(t.issuer || "user")) +
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
// towards the blocker: always out of the blocked card's right edge and into the blocker's left
// edge, whatever the column pair, so one uniform wrap shape serves every relation
export function curve(from, to) {
	const mid = (r) => r.y + r.h / 2;
	const bow = 40;
	// 000127: a fixed bow flattens into a near-straight diagonal over a long cross-column span, so
	// scale the offset with the span (capped so extreme widths stay sane) and the curve bends into
	// an S that hugs the cards at both ends and crosses in the middle; near spans keep the bow
	const sBend = (a, b) => Math.max(bow, Math.min(Math.abs(b - a) * 0.35, 480));
	const x1 = from.x + from.w;
	const y1 = mid(from);
	const x2 = to.x;
	const y2 = mid(to);
	// 000236: a same-row cubic is collinear, so clamp the offset inside the signed half-span (a
	// blocker left of the blocked card gets a negative offset) or the controls would retrace the
	// segment and the dashes would double back; the bow floor applies only when the span allows it
	let d = sBend(x1, x2);
	if (y1 === y2) d = Math.min(d, (x2 - x1) / 2);
	return "M " + x1 + " " + y1 + " C " + (x1 + d) + " " + y1 + ", " + (x2 - d) + " " + y2 + ", " + x2 + " " + y2;
}

// one curve per stored relation the board can draw: the blocked task's card to each blocking
// task's card, both currently rendered, carrying both endpoint files for the hover highlight
// (000127, 000144). A "#<num>" ref maps to its task via parseInt(file); a ref
// without a rendered card is skipped, and a done blocker draws nothing.
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
			out.push({ file: t.file, blocker: blocker.file, d: curve(from, to) });
		}
	}
	return out;
}

// the board shell, built once: a single column per layout string, one .pair wrapper per stacked
// group; returns each column's parts, keyed by state
export function buildShell(parent, doc) {
	const cols = {};
	const column = (st: string) => {
		const col = doc.createElement("section");
		col.className = "col c-" + st;
		// #364: the state hook, so a reader or a test finds a column by data-state, not by class
		col.dataset.state = st;
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

// the columns each stage toggle fades; only a waiting integration card dims with its column, so
// an in-flight run keeps full opacity when the flag turns off
export function applyStages(cols, stages) {
	const states = {
		reviews: ["to-review", "reviewing"],
		liveTesting: ["to-live-test", "live-testing"],
		integrationTesting: ["to-integration-test", "integration-testing"],
	};
	for (const [flag, list] of Object.entries(states)) {
		const off = stages?.[flag] === false;
		for (const st of list) cols[st].col.classList.toggle("off", off);
	}
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

// 000264 the localStorage key of a done task's cached stats: per project (boards are per-project
// tabs) and per task, so two checkouts with the same task number never share an entry
export function statsKey(project: string, file: string) {
	return "card-stats|" + project + "|" + file;
}

// 000264 the lazily-known stats applied onto the payload rows before the board pass (the page's
// render calls it ahead of syncBoard): the payload's eager first-5 agents win over the client
// cache, an agent-less row takes the known stats (an unfold fetch, or the localStorage cache for
// a done task), and a stored entry for a task that left done drops with its merged agents so a
// fresh fetch resumes. Every polled row is swept, folded cards included, so a done card's cache
// fills at page load and a folded task that left done drops its entry at the next poll. storage
// is injected so tests run this without a DOM
export function applyCardStats(rows, known, storage, project) {
	for (const t of rows) {
		const key = statsKey(project, t.file);
		let raw = null;
		try {
			raw = storage.getItem(key);
		} catch {
			// storage unavailable (privacy mode)
		}
		if (t.state !== "done" && raw != null) {
			// a done cache entry for a task that left done is stale
			try {
				storage.removeItem(key);
			} catch {
				// storage unavailable
			}
			delete known[key];
		}
		if (t.agents) continue;
		if (known[key]) {
			t.agents = known[key];
			continue;
		}
		if (t.state !== "done" || raw == null) continue;
		try {
			const agents = JSON.parse(raw);
			known[key] = agents;
			t.agents = agents;
		} catch {
			// corrupt entry, ignored
		}
	}
}

// 000264 the card-stats response merged into the lazily-known stats, keyed per project and task;
// a done task's agents also land in the localStorage cache, so the next page load and unfold
// serve them without a fetch, a non-done task's agents never touch storage. rows is the board's
// current rows: a file's row state decides the cache write. storage is injected so tests run this
// without a DOM
export function mergeCardStats(stats, rows, known, storage, project) {
	for (const file in stats) {
		const agents = stats[file] && stats[file].agents;
		if (!agents) continue;
		const key = statsKey(project, file);
		known[key] = agents;
		const t = rows.find((r) => r.file === file);
		if (!t || t.state !== "done") continue;
		try {
			storage.setItem(key, JSON.stringify(agents));
		} catch {
			// quota exceeded or storage unavailable
		}
	}
}

// 000271 the lazy card-stats queue: each file enqueues once and the queue drains one request at
// a time, in enqueue order, deferred off the caller's path. requested is the fetched-or-in-flight
// key set: a successful file stays (fetched once per page load), a failed response drops its key
// so the next enqueue retries. fetchStats(project, file) resolves the response or null;
// applyStats(project, stats) merges a success. setTimer is injected so tests drive the drain
// without sleeps
export function makeStatsQueue(key, fetchStats, applyStats, setTimer = setTimeout) {
	const pending = [];
	const requested = new Set();
	let timer = null;
	let busy = false;
	const drain = () => {
		timer = null;
		const item = pending.shift();
		if (!item) return;
		busy = true;
		requested.add(item.key);
		fetchStats(item.project, item.file).then(
			(stats) => { if (stats) applyStats(item.project, stats); else requested.delete(item.key); },
			() => requested.delete(item.key),
		).finally(() => { busy = false; if (pending.length) timer = setTimer(drain, 0); });
	};
	const enqueue = (project, file) => {
		const k = key(project, file);
		if (requested.has(k) || pending.some((p) => p.key === k)) return;
		pending.push({ project, file, key: k });
		if (!timer && !busy) timer = setTimer(drain, 0);
	};
	// the column's beyond-fold cards, in board order, skipping done cards with known stats
	const enqueueCol = (project, tasks, st, visible) => {
		for (const t of sortedCol(tasks, st).slice(visible)) {
			if (t.state === "done" && t.agents) continue;
			enqueue(project, t.file);
		}
	};
	return { enqueueCol };
}

// the column's rows in board order: backlog priority-first (critical above high above medium above
// low), every other column newest-first only; the sort is stable and the payload arrives in
// task-number order, so equal keys keep that order. syncBoard and the lazy stats fetch share it
export function sortedCol(tasks: Task[], st: string): Task[] {
	return tasks
		.filter((t) => t.state === st)
		.sort((a, b) => (st === "backlog" ? (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4) : 0) || b.updated - a.updated);
}

// one refresh pass: place every task's card in its column and update counts and the fold toggle. A
// card is rewritten only when its markup changed, so an unchanged card keeps its DOM node and with
// it its running spinner animation and in-flight FLIP transform; a stats-only change updates the
// .card-stats span in place (syncCardStats), and orders are fixed by moving nodes, so a card
// entering a column never rebuilds the cards already in it. A genuinely new card gains the
// "enter" class for the page's one-shot entrance animation. The caller measures card positions
// before and after this pass to animate the moves
export function syncBoard(cols, tasks, expanded, els, make, visible, doc) {
	const live = new Set();
	for (const st of Object.keys(cols)) {
		const inState = sortedCol(tasks, st);
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
			// #364: the card's own hooks, refreshed every pass, so a reader finds it by data-num and data-state
			el.dataset.num = String(parseInt(t.file, 10));
			el.dataset.state = st;
			// 000320: the `user` blockedBy token holds the task, so the toggle runs every pass: a poll adds
			// and removes the dashed outline live, and the one-shot "enter" class stays untouched
			el.classList.toggle("user-hold", String(t.blockedBy || "").split(",").some((r) => r.trim().toLowerCase() === "user"));
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
