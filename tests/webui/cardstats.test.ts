// the lazy card-stats group split out of tests/webui/board.test.ts (#364): the sortStation,
// statsKey, applyCardStats, mergeCardStats and makeStatsQueue helpers over stubbed storage and a
// stubbed fetch. No hub and no DOM, so this group needs no page fixture.
import assert from "node:assert/strict";
import { applyCardStats, makeStatsQueue, mergeCardStats, sortStation, statsKey, STATIONS } from "../../src/webui/board.ts";
import { PAGE } from "../../src/webui/page.ts";

// over stubbed storage (no DOM, no hub; the endpoint is stubbed until #263 merges)

const csStorage = () => {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
		setItem: (k: string, v: string) => {
			map.set(k, String(v));
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
	};
};
const csAgents = [{ role: "developer", tokens: 42, duration: 3 }];

// per-project and per-task key: two checkouts with the same task number never share an entry
assert.equal(statsKey("/repo-a", "000001_probe.md"), "card-stats|/repo-a|000001_probe.md");
assert.notEqual(statsKey("/repo-a", "000001_probe.md"), statsKey("/repo-b", "000001_probe.md"));

// the station's rows in board order (#366): priority first, then newest update, a held task pinned
const csBacklog = [
	{ file: "000001_a.md", state: "backlog", priority: "medium", updated: 3 },
	{ file: "000002_b.md", state: "backlog", priority: "critical", updated: 1 },
	{ file: "000003_c.md", state: "backlog", priority: "high", updated: 5 },
];
assert.deepEqual(sortStation(csBacklog).map((t) => t.file), ["000002_b.md", "000003_c.md", "000001_a.md"]);
const csDoneCol = [
	{ file: "000001_a.md", state: "done", priority: "low", updated: 2 },
	{ file: "000002_b.md", state: "done", priority: "critical", updated: 9 },
];
assert.deepEqual(sortStation(csDoneCol).map((t) => t.file), ["000002_b.md", "000001_a.md"]);
assert.deepEqual(
	sortStation([
		{ file: "000003_c.md", state: "to-do", priority: "critical", updated: 1 },
		{ file: "000004_d.md", state: "to-do", priority: "low", updated: 9, blockedBy: "user" },
	]).map((t) => t.file),
	["000004_d.md", "000003_c.md"],
	"a held task pins above a higher priority sibling",
);

// an agent-less row takes the known stats, the payload's eager agents win over them
const csKnown = Object.create(null);
csKnown[statsKey("p", "000001_a.md")] = csAgents;
const csRows = [{ file: "000001_a.md", state: "to-do", updated: 1 }];
applyCardStats(csRows, csKnown, csStorage(), "p");
assert.deepEqual(csRows[0].agents, csAgents);
const csPayload = [{ role: "developer", tokens: 7, duration: 1 }];
const csCovered = [{ file: "000001_a.md", state: "to-do", updated: 1, agents: csPayload }];
applyCardStats(csCovered, csKnown, csStorage(), "p");
assert.equal(csCovered[0].agents, csPayload);

// a done task's cached stats serve without a fetch, and the read lands in the known stats too
const csStore = csStorage();
csStore.setItem(statsKey("p", "000002_b.md"), JSON.stringify(csAgents));
const csDoneRows = [{ file: "000002_b.md", state: "done", updated: 1 }];
applyCardStats(csDoneRows, csKnown, csStore, "p");
assert.deepEqual(csDoneRows[0].agents, csAgents);
assert.equal(csKnown[statsKey("p", "000002_b.md")], csDoneRows[0].agents);

// a done task's empty cached stats still count as served, the fetch never resumes for them
csStore.setItem(statsKey("p", "000006_f.md"), "[]");
const csEmptyRows = [{ file: "000006_f.md", state: "done", updated: 1 }];
applyCardStats(csEmptyRows, csKnown, csStore, "p");
assert.deepEqual(csEmptyRows[0].agents, []);

// a stored entry for a task that left done drops with its merged agents, a fresh fetch resumes
csStore.setItem(statsKey("p", "000003_c.md"), JSON.stringify(csAgents));
csKnown[statsKey("p", "000003_c.md")] = csAgents;
const csLeftRows = [{ file: "000003_c.md", state: "to-do", updated: 1 }];
applyCardStats(csLeftRows, csKnown, csStore, "p");
assert.equal(csStore.getItem(statsKey("p", "000003_c.md")), null);
assert.equal(csKnown[statsKey("p", "000003_c.md")], undefined);
assert.equal(csLeftRows[0].agents, undefined);

// a corrupt entry and an unavailable storage fail soft, the row stays agent-less
csStore.setItem(statsKey("p", "000004_d.md"), "{oops");
const csBadRows = [{ file: "000004_d.md", state: "done", updated: 1 }];
applyCardStats(csBadRows, csKnown, csStore, "p");
assert.equal(csBadRows[0].agents, undefined);
const csDenied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
const csDeniedRows = [{ file: "000005_e.md", state: "done", updated: 1 }];
applyCardStats(csDeniedRows, csKnown, csDenied, "p");
assert.equal(csDeniedRows[0].agents, undefined);

// the card-stats response merges into the known stats; a done task's agents also cache to
// storage, a non-done task's never touch it
const csMergeStore = csStorage();
const csMergeKnown = Object.create(null);
const csMergeRows = [
	{ file: "000001_a.md", state: "done", updated: 1 },
	{ file: "000002_b.md", state: "to-do", updated: 2 },
];
mergeCardStats(
	{ "000001_a.md": { agents: [{ role: "developer", tokens: 5, duration: 1 }] }, "000002_b.md": { agents: [{ role: "developer", tokens: 6, duration: 2 }] } },
	csMergeRows,
	csMergeKnown,
	csMergeStore,
	"p",
);
assert.deepEqual(csMergeKnown[statsKey("p", "000001_a.md")], [{ role: "developer", tokens: 5, duration: 1 }]);
assert.deepEqual(csMergeKnown[statsKey("p", "000002_b.md")], [{ role: "developer", tokens: 6, duration: 2 }]);
assert.deepEqual(JSON.parse(csMergeStore.getItem(statsKey("p", "000001_a.md"))), [{ role: "developer", tokens: 5, duration: 1 }]);
assert.equal(csMergeStore.getItem(statsKey("p", "000002_b.md")), null);
mergeCardStats({ "000003_c.md": {} }, [], csMergeKnown, csMergeStore, "p");
assert.equal(csMergeKnown[statsKey("p", "000003_c.md")], undefined, "a response entry without agents is skipped");
mergeCardStats({ "000001_a.md": { agents: [] } }, csMergeRows, csMergeKnown, csDenied, "p");
assert.deepEqual(csMergeKnown[statsKey("p", "000001_a.md")], [], "a failing storage write still merges the known stats");
mergeCardStats({ "000009_z.md": { agents: [{ role: "developer", tokens: 1, duration: 1 }] } }, [], csMergeKnown, csMergeStore, "p");
assert.deepEqual(csMergeKnown[statsKey("p", "000009_z.md")], [{ role: "developer", tokens: 1, duration: 1 }]);
assert.equal(csMergeStore.getItem(statsKey("p", "000009_z.md")), null);

// 000271: the stats queue drains one file per request in board order, deferred off the caller's
// path; a successful file stays fetched, a failed one drops out so the next pass retries it
const csTimers = [];
const csSchedule = (fn) => { csTimers.push(fn); return csTimers.length; };
const csFlush = () => { const fn = csTimers.shift(); if (fn) fn(); };
const csSettle = () => new Promise((resolve) => setImmediate(resolve));
const csDeferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const csNewQueue = () => {
	const calls = [];
	const applied = [];
	const queue = makeStatsQueue(
		statsKey,
		(project, file) => { const d = csDeferred(); calls.push({ project, file, d }); return d.promise; },
		(project, stats) => applied.push({ project, stats }),
		csSchedule,
	);
	return { queue, calls, applied };
};

// one file per request, top to bottom, never in the caller's stack; the queue takes the station
// whose beyond-fold cards it fetches, so it shares the board's station order
const csWork = STATIONS.find((s) => s.id === "work");
const csSeq = csNewQueue();
const csCol7 = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => ({ file: `cs_${n}.md`, state: "doing", updated: 10 - i }));
csSeq.queue.enqueueStation("p", csCol7, csWork, 5);
assert.equal(csSeq.calls.length, 0, "the drain defers off the caller's path");
csFlush();
assert.deepEqual(csSeq.calls.map((c) => c.file), ["cs_f.md"], "one file per request, the top beyond-fold card first");
csSeq.calls[0].d.resolve({ "cs_f.md": { agents: csAgents } });
await csSettle();
assert.equal(csSeq.calls.length, 1, "no second request until the first settles");
csFlush();
assert.deepEqual(csSeq.calls.map((c) => c.file), ["cs_f.md", "cs_g.md"], "the next card drains after the first, top to bottom");
assert.deepEqual(csSeq.applied, [{ project: "p", stats: { "cs_f.md": { agents: csAgents } } }], "each response merges as it lands");
csSeq.calls[1].d.resolve({ "cs_g.md": { agents: csAgents } });
await csSettle();

// an enqueue during an in-flight fetch never starts a second concurrent request
const csOne = csNewQueue();
csOne.queue.enqueueStation("p", [{ file: "cs4_a.md", state: "doing", updated: 1 }], csWork, 0);
csFlush();
assert.deepEqual(csOne.calls.map((c) => c.file), ["cs4_a.md"], "the first card fetches");
csOne.queue.enqueueStation("p", [{ file: "cs4_z.md", state: "doing", updated: 0 }], csWork, 0);
csFlush();
assert.equal(csOne.calls.length, 1, "no second request while the first is in flight");
csOne.calls[0].d.resolve({ "cs4_a.md": { agents: csAgents } });
await csSettle();
csFlush();
assert.deepEqual(csOne.calls.map((c) => c.file), ["cs4_a.md", "cs4_z.md"], "the mid-flight enqueue drains after the first settles");
csOne.calls[1].d.resolve({ "cs4_z.md": { agents: csAgents } });
await csSettle();

// a task arriving at position 6 in an expanded column re-queues on the next pass; a fetched file never does
const csArr = csNewQueue();
const csFive = ["a", "b", "c", "d", "e"].map((n, i) => ({ file: `cs2_${n}.md`, state: "doing", updated: 10 - i }));
csArr.queue.enqueueStation("p", csFive, csWork, 5);
assert.equal(csArr.calls.length, 0, "the eager first five never fetch");
const csSix = [...csFive, { file: "cs2_f.md", state: "doing", updated: 0 }];
csArr.queue.enqueueStation("p", csSix, csWork, 5);
assert.equal(csArr.calls.length, 0, "the arrival queues deferred");
csFlush();
assert.deepEqual(csArr.calls.map((c) => c.file), ["cs2_f.md"], "a task arriving at position 6 fetches on the next pass");
csArr.calls[0].d.resolve({ "cs2_f.md": { agents: [] } });
await csSettle();
csArr.queue.enqueueStation("p", csSix, csWork, 5);
csFlush();
assert.equal(csArr.calls.length, 1, "a fetched file does not re-queue");

// a failed fetch drops out of the fetched-or-in-flight set, the next pass retries it
const csRetry = csNewQueue();
const csFailCol = ["a", "b", "c", "d", "e", "f"].map((n, i) => ({ file: `cs3_${n}.md`, state: "doing", updated: 10 - i }));
csRetry.queue.enqueueStation("p", csFailCol, csWork, 5);
csFlush();
assert.deepEqual(csRetry.calls.map((c) => c.file), ["cs3_f.md"], "the beyond-fold card fetches");
csRetry.calls[0].d.resolve(null);
await csSettle();
csRetry.queue.enqueueStation("p", csFailCol, csWork, 5);
assert.equal(csRetry.calls.length, 1, "the retry defers off the caller's path");
csFlush();
assert.deepEqual(csRetry.calls.map((c) => c.file), ["cs3_f.md", "cs3_f.md"], "a failed fetch retries on the next pass");
csRetry.calls[1].d.resolve({});
await csSettle();

// the poll's agent-less rows never wipe revealed stats: the merge fills, the poll's fresh rows re-apply
const csPollKnown = Object.create(null);
const csPollStore = csStorage();
const csPollRows = [{ file: "000001_a.md", state: "to-do", updated: 1 }];
mergeCardStats({ "000001_a.md": { agents: [{ role: "developer", tokens: 9, duration: 9 }] } }, csPollRows, csPollKnown, csPollStore, "p");
applyCardStats(csPollRows, csPollKnown, csPollStore, "p");
assert.equal(csPollRows[0].agents.length, 1);
const csPolled = [{ file: "000001_a.md", state: "to-do", updated: 2 }];
applyCardStats(csPolled, csPollKnown, csPollStore, "p");
assert.equal(csPolled[0].agents.length, 1, "the poll's agent-less rows take the known stats back");

// the served page wires the apply pass ahead of the board pass, the per-file queue, its poll
// re-enqueue and the stats entrance (reduced motion included)
assert.ok(PAGE.includes("function sortStation("), "sortStation interpolates into the page");
assert.ok(PAGE.includes("function statsKey("), "statsKey interpolates into the page");
assert.ok(PAGE.includes("function applyCardStats("), "applyCardStats interpolates into the page");
assert.ok(PAGE.includes("function mergeCardStats("), "mergeCardStats interpolates into the page");
assert.ok(PAGE.includes("function makeStatsQueue("), "makeStatsQueue interpolates into the page");
assert.ok(PAGE.indexOf("applyCardStats(tab.tasks") < PAGE.indexOf("syncBoard(stations, filterTasks(tab.tasks, filters)"), "the apply pass runs before the board pass");
assert.ok(PAGE.includes('"/api/card-stats?files=" + encodeURIComponent(file)'), "each queued file fetches the pinned endpoint");
assert.ok(PAGE.includes("statsQueue.enqueueStation(active, b.tasks, STATIONS.find(s => s.id === id), VISIBLE)"), "the unfold enqueues the station's beyond-fold cards");
assert.ok(PAGE.includes("queueExpanded()"), "each poll re-queues the already-expanded stations");
