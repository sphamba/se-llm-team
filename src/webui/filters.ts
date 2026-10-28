// the filter bar, the command palette and the done archive: the filter codec, the matcher, the
// palette search and the archive paging. PAGE interpolates this source as client code.

import { COMPLEXITIES, PRIORITY_RANK, type Task } from "../kanban.ts";
import { holdsToken } from "./board.ts";

export const FILTERS_KEY = "boardFilters";
export const FILTER_DEBOUNCE = 120;
export const PALETTE_MAX = 12;
export const ARCHIVE_PAGE = 50;
export const FILTER_PRIORITIES: string[] = Object.keys(PRIORITY_RANK).sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a]);
export const FILTER_COMPLEXITIES: string[] = [...COMPLEXITIES];

export interface FilterState {
	q: string;
	priorities: string[];
	complexities: string[];
	issuer: string;
	held: boolean;
	question: boolean;
	live: boolean;
}

export function emptyFilters(): FilterState {
	return { q: "", priorities: [], complexities: [], issuer: "", held: false, question: false, live: false };
}

// the URL's ?f= value: one compact JSON object, utf-8 safe because a query can carry any character,
// never a name or a summary, so a link stays short
export function encodeFilters(f: FilterState): string {
	const bytes = new TextEncoder().encode(JSON.stringify({ q: f.q, pr: f.priorities, cx: f.complexities, i: f.issuer, h: f.held, qn: f.question, l: f.live }));
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

// a hand-edited or truncated value keeps only the well-typed fields of a known enum, so a corrupt
// link lands on a filtered board or none, never on a thrown error; #378 an old link's retired phase
// key is ignored and the keys beside it still decode
export function decodeFilters(raw: unknown): FilterState {
	const f = emptyFilters();
	let obj: any = null;
	if (typeof raw !== "string" || !raw) return f;
	try {
		const bin = atob(raw);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		obj = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return f;
	}
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return f;
	const pick = (v: unknown, keep: (s: string) => boolean) => (Array.isArray(v) ? v.filter((s: any) => typeof s === "string" && keep(s)) : []);
	if (typeof obj.q === "string") f.q = obj.q;
	if (obj.i === "user") f.issuer = obj.i;
	f.priorities = pick(obj.pr, (s) => FILTER_PRIORITIES.includes(s));
	f.complexities = pick(obj.cx, (s) => FILTER_COMPLEXITIES.includes(s));
	f.held = obj.h === true;
	f.question = obj.qn === true;
	f.live = obj.l === true;
	return f;
}

export function filtersActive(f: FilterState): boolean {
	return !!(f.q || f.priorities.length || f.complexities.length || f.issuer || f.held || f.question || f.live);
}

// #370 the phone filter button's badge: one count per active dimension, the empty set at 0
export function filtersCount(f: FilterState): number {
	return (f.q ? 1 : 0) + f.priorities.length + f.complexities.length + (f.issuer ? 1 : 0) + (f.held ? 1 : 0) + (f.question ? 1 : 0) + (f.live ? 1 : 0);
}

// the membership test: the query reads the name, the summary and the number (a leading # is
// optional), every other field is a set membership or a flag, and every set field must agree
export function matchesFilters(t: Task, f: FilterState): boolean {
	if (f.priorities.length && !f.priorities.includes(t.priority)) return false;
	if (f.complexities.length && !f.complexities.includes(t.complexity)) return false;
	if (f.issuer && (t.issuer || "user") !== f.issuer) return false;
	if (f.held && !holdsToken(t, "user")) return false;
	if (f.question && !holdsToken(t, "question")) return false;
	if (f.live && !(t.agents || []).some((a) => a.alive)) return false;
	const q = f.q.trim().toLowerCase();
	if (!q) return true;
	const needle = q[0] === "#" ? q.slice(1) : q;
	return ((t.name || "") + " " + (t.summary || "") + " #" + String(parseInt(t.file, 10))).toLowerCase().includes(needle);
}

export function filterTasks(tasks: Task[], f: FilterState): Task[] {
	return filtersActive(f) ? tasks.filter((t) => matchesFilters(t, f)) : tasks;
}

// the empty station's replacement line: the active filters, so a reader knows the station is empty
// because of the bar and not because the project has no task there
export function filterReason(f: FilterState): string {
	const parts: string[] = [];
	if (f.q) parts.push('"' + f.q + '"');
	if (f.priorities.length) parts.push(f.priorities.join("|"));
	if (f.complexities.length) parts.push(f.complexities.join("|"));
	if (f.issuer) parts.push(f.issuer);
	if (f.held) parts.push("held");
	if (f.question) parts.push("question");
	if (f.live) parts.push("live");
	return parts.length ? "no task matches: " + parts.join(", ") : "";
}

// the palette's rows for a query: an exact number first, then a substring of the name or the
// summary, then the name as a subsequence; equal scores fall back to the newest update, the cap
// leaves a count for the dim line
export function paletteResults(tasks: Task[], query: string): { hits: Task[]; more: number } {
	const q = query.trim().toLowerCase();
	const needle = q[0] === "#" ? q.slice(1) : q;
	const scored: [number, Task][] = [];
	for (const t of tasks) {
		const name = (t.name || "").toLowerCase();
		const hay = name + " " + (t.summary || "").toLowerCase();
		let score = -1;
		if (!q) score = 3;
		else if (String(parseInt(t.file, 10)) === needle) score = 0;
		else if (hay.includes(needle)) score = 1;
		else {
			let at = 0;
			for (const ch of name) if (ch === needle[at]) at++;
			if (needle.length <= 32 && at === needle.length) score = 2;
		}
		if (score >= 0) scored.push([score, t]);
	}
	scored.sort((a, b) => a[0] - b[0] || b[1].updated - a[1].updated);
	return { hits: scored.slice(0, PALETTE_MAX).map((r) => r[1]), more: Math.max(0, scored.length - PALETTE_MAX) };
}

// the archive's rows: done tasks through the same filter, newest update first
export function archiveTasks(tasks: Task[], f: FilterState): Task[] {
	return tasks.filter((t) => t.state === "done" && matchesFilters(t, f)).sort((a, b) => b.updated - a.updated);
}

// one page of the archive: a fixed window of ARCHIVE_PAGE rows, the page number clamped to the last
// page so a stale page never shows an empty list
export function archivePage(rows: Task[], page: number) {
	const pages = Math.max(1, Math.ceil(rows.length / ARCHIVE_PAGE));
	const at = Math.max(0, Math.min(Math.floor(page) || 0, pages - 1));
	const start = at * ARCHIVE_PAGE;
	return { page: at, pages, start, end: Math.min(rows.length, start + ARCHIVE_PAGE), rows: rows.slice(start, start + ARCHIVE_PAGE) };
}
