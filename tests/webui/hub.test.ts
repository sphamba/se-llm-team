import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { createTask, parseTask, setState, taskSlug, updateAttrs } from "../../src/kanban.ts";
import { readCapped, startHub } from "../../src/hub.ts";
import { agentPidName, pidAlive, pidPath, writePid } from "../../src/pid.ts";
import { loadWebUiConfig, taskHistory, taskPayload } from "../../src/webui.ts";
// not re-exported by the webui barrel: import directly from the payload module
import { logStats, MAX_LOG_CACHES, statsCache, subagentLogs, subsCache } from "../../src/webui/payload.ts";
import { cardStatsPayload } from "../../src/webui/payload.ts";
import { compactFinishedLogs } from "../../src/orchestrator.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-merge", "merging", "to-live-test", "live-testing", "done"];


const root = mkdtempSync(join(tmpdir(), "webui-test-"));
const home = mkdtempSync(join(tmpdir(), "webui-home-"));
let daemon: ChildProcess | undefined;
const cleanup = () => {
	daemon?.kill("SIGKILL");
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, () => {
		cleanup();
		process.exit(sig === "SIGINT" ? 130 : 143);
	});
}

// absent or invalid config = off (HOME at the empty temp home, no project config yet)
const realHome = process.env.HOME;
process.env.HOME = home;
assert.equal(loadWebUiConfig(root).enabled, false);
process.env.HOME = realHome;


// the hub serves the dashboard endpoints; HOME at the temp home keeps the hub registry and
// lock out of the real global dir
const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
process.env.HOME = home;
const ui = await startHub({ name: "webui-test", root, host: "localhost", port: 0 });
assert.ok(ui, "hub starts on port 0");
const base = `http://localhost:${ui.port}`;

const tasksRes = await fetch(`${base}/api/tasks`);
assert.equal(tasksRes.status, 200);
const listed = await tasksRes.json();
assert.equal(listed.length, 1);
assert.equal(listed[0].file, task.file);
assert.equal(listed[0].name, task.name);
assert.equal(listed[0].priority, "medium");
assert.equal(listed[0].state, "backlog");
assert.equal(listed[0].worktree, "");
assert.equal(listed[0].issuer, "user", "absent issuer reads as user");
assert.equal(listed[0].blockedBy, "", "absent blockedBy reads as an empty string");
assert.equal(listed[0].complexity, "moderate");
assert.equal(listed[0].updated, statSync(join(root, ".kanban", task.file)).mtimeMs);
// 000242 the light list: rows carry identity + summary only, what the board renderer and the row
// click need; the heavy body, sections and agent history load per task through /api/task-detail.
// 000245: the visible cards' rows carry the agent stat data (this row is the column's first card),
// doctors stay detail-only
for (const k of ["body", "specs", "notes", "openQuestions", "agent", "doctors"])
	assert.ok(!(k in listed[0]), `light rows carry no ${k}`);
assert.deepEqual(listed[0].agents, [], "a visible card's row carries the agent stat data, empty without role logs");
assert.equal(listed[0].num, parseInt(task.file, 10), "light rows carry the task num");
assert.equal(listed[0].summary, "Dashboard smoke");
const detail = await (await fetch(`${base}/api/task-detail?num=${parseInt(task.file, 10)}`)).json();
assert.equal(detail.file, task.file);
assert.equal(detail.num, parseInt(task.file, 10));
assert.equal(detail.summary, "Dashboard smoke");
assert.equal(detail.specs, "Render the board");
assert.equal(detail.notes, "");
assert.equal(detail.openQuestions, "");
assert.match(detail.body, /# Summary\nDashboard smoke/);
// 000248: the light detail reads no logs, body, sections and attributes only; no agent data on
// the text payload, the heavy history loads in the follow-up fetch
for (const k of ["agents", "agent", "doctors"])
	assert.ok(!(k in detail), `the light detail carries no ${k}`);
// 000248: the follow-up history fetch carries the agent data the detail used to
const histPayload = await (await fetch(`${base}/api/task-history?num=${parseInt(task.file, 10)}`)).json();
assert.deepEqual(histPayload.agents, [], "the history carries the agent history, empty without role logs");
assert.equal(histPayload.agent, null);
assert.deepEqual(histPayload.doctors, []);
// unknown num: 404 with a JSON error body, on both endpoints
assert.equal((await fetch(`${base}/api/task-detail?num=999999`)).status, 404, "an unknown num is rejected");
assert.equal((await fetch(`${base}/api/task-detail?num=x`)).status, 404, "a non-numeric num is rejected");
assert.equal((await fetch(`${base}/api/task-detail`)).status, 404, "a missing num is rejected too");
assert.ok((await (await fetch(`${base}/api/task-detail?num=999999`)).json()).error, "the 404 carries a JSON error body");
for (const q of ["999999", "x", ""])
	assert.equal((await fetch(`${base}/api/task-history?num=${q}`)).status, 404, "an unknown task's history is rejected");
assert.ok((await (await fetch(`${base}/api/task-history?num=999999`)).json()).error, "the history 404 carries a JSON error body");

// issuer flows to /api/tasks: the creation value for task-issued tasks
const issued = createTask(root, { name: "feat: issued by 42", summary: "s", issuer: "#42" });
const issuedRow = (await (await fetch(`${base}/api/tasks`)).json()).find((t) => t.file === issued.file);
assert.equal(issuedRow.issuer, "#42");
assert.equal(issuedRow.complexity, "moderate");
rmSync(join(root, ".kanban", issued.file)); // the daemon section below expects a one-task board

// blockedBy flows to /api/tasks; the detail card and the relation lines read it from here
const held = createTask(root, { name: "fix: held by 1", summary: "s", blockedBy: `#${parseInt(task.file, 10)}` });
const heldRow = (await (await fetch(`${base}/api/tasks`)).json()).find((t) => t.file === held.file);
assert.equal(heldRow.blockedBy, `#${parseInt(task.file, 10)}`, "the blockedBy attribute serves with the payload");
rmSync(join(root, ".kanban", held.file)); // the daemon section below expects a one-task board

// 000245 the visible subset: the five cards each column renders before "show more" carry the stat
// data, a card behind it carries none; backlog sorts priority-first then newest-first, so with
// equal priorities the five newest are visible and the oldest sits behind the fold
const bulk = Array.from({ length: 6 }, (_, i) => createTask(root, { name: `feat: bulk ${i}`, summary: "s" }));
const bulkBase = Date.now() / 1000;
bulk.forEach((t, i) => utimesSync(join(root, ".kanban", t.file), bulkBase + i, bulkBase + i));
const bulkRows = (await (await fetch(`${base}/api/tasks`)).json()).filter((r: any) => r.name.startsWith("feat: bulk"));
assert.equal(bulkRows.length, 6);
for (const r of bulkRows)
	assert.equal("agents" in r, r.num !== parseInt(bulk[0].file, 10), "the five visible rows carry the stat data, a card behind show more carries none");
// 000263: the batched lazy-stats endpoint serves the cards behind "show more": every requested
// on-board file answers with its agent stats, a bogus file is omitted, and the eager /api/tasks
// response keeps carrying only the first five
mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const hiddenSlug = bulk[0].file.replace(/\.md$/, "");
const hiddenLog = join(root, ".kanban", ".logs", `${hiddenSlug}.developer.0.log`);
writeFileSync(hiddenLog, JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 20, output: 10 } }, timestamp: Date.now() }) + "\n");
const cardStats = await (await fetch(`${base}/api/card-stats?files=${bulk.map((t) => t.file).join(",")},bogus.md`)).json();
assert.deepEqual(cardStats[bulk[0].file].agents.map((a) => a.tokens), [30], "the endpoint serves the card behind show more, the eager response omits it");
assert.deepEqual(Object.keys(cardStats).sort(), bulk.map((t) => t.file).sort(), "the endpoint keys every on-board requested file and omits a bogus one");
assert.deepEqual(await (await fetch(`${base}/api/card-stats`)).json(), {}, "a missing files param answers an empty object");
assert.equal((await fetch(`${base}/api/card-stats?project=nope&files=x.md`)).status, 404, "an unknown project is rejected like /api/tasks");
rmSync(hiddenLog);
for (const t of bulk) rmSync(join(root, ".kanban", t.file)); // restore the one-task board

// GET / mentions all 10 state names; other paths and methods are 404
const pageRes = await fetch(`${base}/`);
assert.equal(pageRes.headers.get("cache-control"), "no-cache", "the page serves with a no-cache header so a browser reload re-fetches");
const page = await pageRes.text();
assert.doesNotThrow(() => new Function(page.match(/<script>([\s\S]*?)<\/script>/)![1]), "the served client script parses");
assert.ok(page.includes("Software Engineering LLM Team"), "page shows the new title");
assert.ok(page.includes('id="theme"'), "page has the theme toggle");
assert.ok(!page.includes('id="notify"'), "the header has no browser-notification control (000249)");
assert.ok(!page.includes("Notification"), "the served client never touches the Notification API (000249)");
assert.ok(page.includes('id="hub"'), "page has the hub identity footer (000165)");
assert.ok(page.includes("/api/task-history"), "the client fetches the heavy history in a follow-up fetch (000248)");
// 000165: /api/hub reports the serving hub's identity (pid, code checkout, commit), so a
// stale-code hub or a failover is visible at a glance
const hubRes = await fetch(`${base}/api/hub`);
assert.equal(hubRes.status, 200);
const hub = await hubRes.json();
assert.equal(hub.pid, process.pid, "/api/hub reports the serving process");
assert.equal(hub.root, realpathSync(join(HERE, "..", "..")), "/api/hub names the code checkout hub.ts runs from");
assert.equal(hub.commit, execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(HERE, "..", "..") }).toString().trim(), "/api/hub reports the checkout's HEAD commit");
for (const st of STATE_NAMES) assert.ok(page.includes(st), `page mentions state ${st}`);
// 000383: the page follows the source, so a merged ui change lands on the next reload, no restart
const themeFile = join(HERE, "..", "..", "src", "webui", "theme.ts");
const themeSrc = readFileSync(themeFile, "utf8");
const cssEnd = themeSrc.lastIndexOf("`;");
try {
	writeFileSync(themeFile, `${themeSrc.slice(0, cssEnd)}.live-marker { color: #123456; }\n${themeSrc.slice(cssEnd)}`);
	assert.ok((await (await fetch(`${base}/`)).text()).includes(".live-marker"), "a stylesheet change serves on the next page load with no daemon restart");
} finally {
	writeFileSync(themeFile, themeSrc);
}
assert.ok(!(await (await fetch(`${base}/`)).text()).includes(".live-marker"), "a restored source is served back on the next load");
assert.equal((await fetch(`${base}/nope`)).status, 404);
assert.equal((await fetch(`${base}/api/tasks`, { method: "POST" })).status, 404);
// 000192: a page load renders in a child process and writes no temp copies under src/
assert.ok(!readdirSync(join(HERE, "..", "..", "src")).some((d) => d.startsWith(".webui-hot-")), "a page load writes no webui copy dirs under src/");


// a second hub on the taken port reports failure instead of throwing
assert.equal(await startHub({ name: "webui-test", root, host: "localhost", port: ui.port }), null);
ui.close();
process.env.HOME = realHome;

// daemon wiring: HOME at a config with webUi enabled and port 0 -> OS picks, URL logged
mkdirSync(join(home, ".se-llm-team"), { recursive: true });
writeFileSync(join(home, ".se-llm-team", "config.json"), JSON.stringify({ webUi: { enabled: true, port: 0 } }));
daemon = spawn(process.execPath, [join(HERE, "../../src/orchestrator.ts"), "--root", root], {
	stdio: ["ignore", "pipe", "pipe"],
	env: { ...process.env, HOME: home },
});
let out = "";
daemon.stdout.on("data", (d) => (out += d));
daemon.stderr.on("data", (d) => (out += d));
const exited = new Promise((r) => daemon!.on("exit", r));
const end = Date.now() + 10000;
let url = "";
while (Date.now() < end) {
	const m = out.match(/web ui on (http:\/\/\S+)/);
	if (m) {
		url = m[1];
		break;
	}
	await new Promise((r) => setTimeout(r, 250));
}
assert.ok(url, "daemon log shows the web ui url; got: " + out);
const served = await (await fetch(`${url}/`)).text();
for (const st of STATE_NAMES) assert.ok(served.includes(st), `daemon dashboard serves the ${st} column`);
const viaDaemon = await (await fetch(`${url}/api/tasks`)).json();
assert.equal(viaDaemon.length, 1);
assert.equal(viaDaemon[0].file, task.file);
daemon.kill("SIGTERM");
await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);

// the project root se-llm-team.json overrides the global ~/.se-llm-team/config.json for webUi
process.env.HOME = home;
const globalConfig = join(home, ".se-llm-team", "config.json");
writeFileSync(globalConfig, JSON.stringify({ webUi: { enabled: true, host: "global-host", port: 1234 } }));
writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: 4243 } }));
const overridden = loadWebUiConfig(root);
assert.equal(overridden.host, "127.0.0.1");
assert.equal(overridden.port, 4243);
// a project file without webUi leaves the global webUi block intact
writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ pollMinutes: 5 }));
assert.equal(loadWebUiConfig(root).host, "global-host");
assert.equal(loadWebUiConfig(root).port, 1234);
// nested keys deep-merge: one project key keeps its global siblings
writeFileSync(join(root, "se-llm-team.json"), JSON.stringify({ webUi: { host: "project-host" } }));
assert.equal(loadWebUiConfig(root).enabled, true, "the global webUi.enabled survives");
assert.equal(loadWebUiConfig(root).port, 1234, "the global webUi.port survives");
assert.equal(loadWebUiConfig(root).host, "project-host", "the project webUi.host wins");
// the old .kanban file and the legacy pi file are ignored
mkdirSync(join(root, ".kanban"), { recursive: true });
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ webUi: { host: "kanban-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the .kanban config is ignored");
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { host: "legacy-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the legacy config is ignored");
process.env.HOME = realHome;

// 000245 the visible subset and the done cache, in-process over taskPayload: the five cards each
// column renders before "show more" carry the same agent history the detail serves, a card behind
// it carries none; done tasks' stats come from the cache and invalidate when the state leaves done
const statsRoot = mkdtempSync(join(tmpdir(), "webui-stats-"));
mkdirSync(join(statsRoot, ".kanban", ".logs"), { recursive: true });
const statsTasks = Array.from({ length: 6 }, (_, i) => createTask(statsRoot, { name: `feat: stats ${i}`, summary: "s" }));
statsTasks.forEach((t) => setState(statsRoot, t, "reviewing"));
const statsBase = Date.now() / 1000;
statsTasks.forEach((t, i) => utimesSync(join(statsRoot, ".kanban", t.file), statsBase + i, statsBase + i));
const statsRows = (await taskPayload(statsRoot)).filter((r: any) => r.name.startsWith("feat: stats"));
assert.equal(statsRows.length, 6);
for (const r of statsRows)
	assert.equal("agents" in r, r.num !== parseInt(statsTasks[0].file, 10), "the five visible rows carry the stat data, a card behind show more carries none");
const loggedSlug = statsTasks[1].file.replace(/\.md$/, "");
writeFileSync(join(statsRoot, ".kanban", ".logs", `${loggedSlug}.developer.log`), [
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 200, output: 100 } }, timestamp: Date.now() - 2000 }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 300, output: 200 } }, timestamp: Date.now() - 1000 }),
].join("\n") + "\n");
const loggedRow = (await taskPayload(statsRoot)).find((r: any) => r.file === statsTasks[1].file)!;
assert.equal(loggedRow.agents[0].tokens, 800, "a visible card's row sums the run's usage like the detail's history");
assert.deepEqual(loggedRow.agents, (await taskHistory(statsRoot, loggedRow.num))!.agents, "the row carries the same agent history the detail's history serves");
// 000263: the batched stats payload answers the same per-file agents the visible rows carry,
// keyed by the requested files, with the off-board and missing cases empty
const batch = await cardStatsPayload(statsRoot, [statsTasks[1].file, "bogus.md"]);
assert.deepEqual(Object.keys(batch), [statsTasks[1].file], "the batched stats answer omits a requested file not on the board");
assert.deepEqual(batch[statsTasks[1].file].agents, loggedRow.agents, "the batched agents match the visible row's agent history");
assert.deepEqual(await cardStatsPayload(statsRoot, []), {}, "an empty files list answers an empty object");

// the done cache: a done task's stats serve from the cache (a rewritten plain log stays stale) and
// leaving done invalidates it, so a re-done task re-caches fresh
const doneRoot = mkdtempSync(join(tmpdir(), "webui-done-"));
mkdirSync(join(doneRoot, ".kanban", ".logs"), { recursive: true });
const doneTask = createTask(doneRoot, { name: "feat: done stats", summary: "s" });
const doneSlug = doneTask.file.replace(/\.md$/, "");
const doneLog = join(doneRoot, ".kanban", ".logs", `${doneSlug}.developer.log`);
const writeDoneLog = (tokens: number) =>
	writeFileSync(doneLog, JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: tokens, output: 0 } }, timestamp: new Date().toISOString() }) + "\n");
const doneRow = () => taskPayload(doneRoot).then((rows: any[]) => rows.find((r: any) => r.file === doneTask.file)!);
setState(doneRoot, doneTask, "done");
writeDoneLog(300);
assert.equal((await doneRow()).agents[0].tokens, 300, "a done card's row carries the run's stats");
writeDoneLog(1500);
assert.equal((await doneRow()).agents[0].tokens, 300, "a done card's stats come from the cache, a rewritten plain log stays stale");
setState(doneRoot, doneTask, "to-do");
assert.equal((await doneRow()).agents[0].tokens, 1500, "leaving done invalidates the cache, the fresh stats serve");
setState(doneRoot, doneTask, "done");
assert.equal((await doneRow()).agents[0].tokens, 1500, "a re-done task re-caches fresh, the pre-done entry never returns");
writeDoneLog(20000);
assert.equal((await doneRow()).agents[0].tokens, 1500, "the re-cached entry is stale again until the next leave-done");

// 000250 the RAM ratchet: the stats and subs parses are incremental (byte-offset bookkeeping,
// a live log's re-poll reads only the new bytes), the sweep's rename evicts the plain-path
// cache entries, and the caches stay bounded
const incRoot = mkdtempSync(join(tmpdir(), "webui-inc-"));
mkdirSync(join(incRoot, ".kanban", ".logs"), { recursive: true });
const incLog = join(incRoot, ".kanban", ".logs", "inc.developer.0.log");
const incRec = (input: number, ts: number) =>
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input, output: 0 } }, timestamp: ts });
writeFileSync(incLog, [incRec(10, 1000), incRec(20, 2000)].join("\n") + "\n");
const inc1 = await logStats(incLog);
assert.equal(inc1.tokens, 30, "the cold parse sums the whole log");
assert.equal(statsCache.get(incLog)?.offset, statSync(incLog).size, "the bookkeeping sits past the last complete line, so the next poll reads only the new bytes");
appendFileSync(incLog, incRec(30, 3000) + "\n" + incRec(40, 4000) + "\n");
const inc2 = await logStats(incLog);
assert.equal(inc2.tokens, 100, "the growth parses only the new records and the sum is whole-log correct");
assert.equal(inc2.duration, 3000, "the duration spans first to last across the incremental scans");
assert.equal(statsCache.get(incLog)?.offset, statSync(incLog).size, "the bookkeeping advanced with the growth, it never restarts from zero");
appendFileSync(incLog, incRec(50, 5000));
const inc3 = await logStats(incLog);
assert.equal(inc3.tokens, 100, "an unterminated tail record is not a line yet, it stays unparsed");
assert.equal(statsCache.get(incLog)?.offset, statSync(incLog).size - incRec(50, 5000).length, "the bookkeeping stops before the partial line");
appendFileSync(incLog, "\n");
assert.equal((await logStats(incLog)).tokens, 150, "the completed tail record parses once");
writeFileSync(incLog, incRec(5, 500) + "\n");
assert.equal((await logStats(incLog)).tokens, 5, "a replaced shorter log resets the bookkeeping and parses fresh");

const incParent = join(incRoot, ".kanban", ".logs", "inc.reviewer.0.log");
const incSubRec = (id: string, file: string) =>
	JSON.stringify({ type: "tool_execution_end", toolCallId: id, result: { content: [{ type: "text", text: `Agent ID: ${id}\nOutput file: ${file}` }] } });
writeFileSync(incParent, incSubRec("s1", "/tmp/pi-subagents-1000/inc-one.output") + "\n");
assert.deepEqual((await subagentLogs(incParent)).map((s) => s.id), ["s1"], "the parent parse enumerates its subs");
assert.equal(subsCache.get(incParent)?.offset, statSync(incParent).size, "the parent bookkeeping sits past the last complete line");
appendFileSync(incParent, incSubRec("s2", "/tmp/pi-subagents-1000/inc-two.output") + "\n");
assert.deepEqual((await subagentLogs(incParent)).map((s) => s.id), ["s1", "s2"], "the parent growth appends only the new sub");

// the sweep's rename evicts the plain-path cache entries
const evRoot = mkdtempSync(join(tmpdir(), "webui-evict-"));
mkdirSync(join(evRoot, ".kanban", ".logs"), { recursive: true });
const evPlain = join(evRoot, ".kanban", ".logs", "ev.developer.0.log");
writeFileSync(evPlain, incRec(10, 1000) + "\n");
await logStats(evPlain);
assert.ok(statsCache.has(evPlain), "the plain log's entry caches");
compactFinishedLogs(evRoot);
assert.ok(!existsSync(evPlain), "the sweep gzipped the plain log");
assert.ok(!statsCache.has(evPlain), "the sweep's rename evicted the orphaned plain-path entry");

// a swept doctor log stays in the doctor history: the read path decompresses transparently
const gzDocRoot = mkdtempSync(join(tmpdir(), "webui-docgz-"));
const gzDocTask = createTask(gzDocRoot, { name: "feat: docgz", summary: "s", specs: "s" });
const gzDocSlug = gzDocTask.file.replace(/\.md$/, "");
mkdirSync(join(gzDocRoot, ".kanban", ".logs"), { recursive: true });
const gzDocLog = join(gzDocRoot, ".kanban", ".logs", `${gzDocSlug}.developer.0.doctor.log`);
writeFileSync(gzDocLog, [
	JSON.stringify({ type: "session", id: "s", timestamp: "2026-10-16T10:00:00.000Z" }),
	JSON.stringify({ type: "turn_end", message: { role: "assistant", usage: { input: 7, output: 3 } }, timestamp: "2026-10-16T10:00:02.000Z" }),
].join("\n") + "\n");
writeFileSync(`${gzDocLog}.gz`, gzipSync(readFileSync(gzDocLog)));
rmSync(gzDocLog);
const gzDoc = (await taskHistory(gzDocRoot, parseInt(gzDocTask.file, 10)))!.doctors;
assert.equal(gzDoc.length, 1, "a swept doctor log stays in the doctor history");
assert.equal(gzDoc[0].tokens, 10, "its stats parse from the decompressed stream");

// the caches stay bounded: one entry past the cap evicts the oldest
const bndRoot = mkdtempSync(join(tmpdir(), "webui-bnd-"));
mkdirSync(join(bndRoot, ".kanban", ".logs"), { recursive: true });
for (let b = 0; b <= MAX_LOG_CACHES; b++) {
	const p = join(bndRoot, ".kanban", ".logs", `bnd.${b}.log`);
	writeFileSync(p, incRec(1, 1000) + "\n");
	await logStats(p);
}
assert.ok(statsCache.size <= MAX_LOG_CACHES, "one entry past the cap evicts the oldest, the map never grows unbounded");
rmSync(incRoot, { recursive: true, force: true });
rmSync(evRoot, { recursive: true, force: true });
rmSync(gzDocRoot, { recursive: true, force: true });
rmSync(bndRoot, { recursive: true, force: true });
cleanup();
rmSync(statsRoot, { recursive: true, force: true });
rmSync(doneRoot, { recursive: true, force: true });

// --- part: POST /api/task-block adds and removes the user hold, requeues the task and stops
// its agent: the single task write lands before the kill ---
const blockRoot = mkdtempSync(join(tmpdir(), "webui-block-"));
// the file's first hub closed at ui.close(); the block part serves its own board
const blockUi = await startHub({ name: "block-test", root: blockRoot, host: "localhost", port: 0 });
assert.ok(blockUi, "the block fixture hub starts on port 0");
const blockBase = `http://localhost:${blockUi.port}`;
const blockUrl = (num: number) => `${blockBase}/api/task-block?num=${num}`;
const blockReq = (num: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
	fetch(blockUrl(num), { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const numOf = (file: string) => parseInt(file, 10);
const seeded = (name: string, state: string) => {
	const t = createTask(blockRoot, { name, summary: "Block smoke", specs: "n/a" });
	setState(blockRoot, t, state as any);
	return t.file;
};
const gone = async (pid: number) => {
	for (let i = 0; i < 60 && pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 50));
	return !pidAlive(pid);
};
const doneFile = seeded("fix: done block", "done");
const mergeFile = seeded("fix: merging block", "merging");
const doingFile = seeded("fix: doing block", "doing");
const todoFile = seeded("fix: to-do block", "to-do");
const refsFile = seeded("fix: refs block", "to-review");
updateAttrs(blockRoot, parseTask(blockRoot, refsFile), { blockedBy: "#42, #43" });
const holdFile = seeded("fix: held block", "to-review");
updateAttrs(blockRoot, parseTask(blockRoot, holdFile), { blockedBy: "#42, user" });

assert.equal((await blockReq(9999, { action: "block" })).status, 404, "an unknown task number answers 404");
assert.equal((await blockReq(numOf(doingFile), { action: "nope" })).status, 400, "an unknown action answers 400");
assert.equal(
	(await blockReq(numOf(doingFile), { action: "block" }, { "content-type": "application/json", origin: "http://evil.example" })).status,
	403,
	"a foreign Origin is rejected",
);
assert.equal((await blockReq(numOf(doingFile), "block", { "content-type": "text/plain" })).status, 415, "a non-JSON body is rejected");
assert.equal((await blockReq(numOf(doingFile), { action: "block", pad: "x".repeat(2000) })).status, 413, "a body over 1 KiB is rejected");
assert.equal((await blockReq(numOf(doneFile), { action: "block" })).status, 409, "a done task refuses a block");
assert.equal((await blockReq(numOf(mergeFile), { action: "block" })).status, 409, "a merging task refuses a block");

const refsBlock = await blockReq(numOf(refsFile), { action: "block" });
assert.equal(refsBlock.status, 200, "a block on a to-review task answers 200");
assert.equal((await refsBlock.json()).ok, true, "the block response carries ok");
assert.equal(parseTask(blockRoot, refsFile).blockedBy, "#42, #43, user", "the block keeps every ref and appends the user token");
assert.equal(parseTask(blockRoot, refsFile).state, "to-review", "a to-review block keeps the state");
const refsUnblock = await blockReq(numOf(refsFile), { action: "unblock" });
assert.equal(refsUnblock.status, 200, "an unblock answers 200");
assert.equal(parseTask(blockRoot, refsFile).blockedBy, "#42, #43", "the unblock removes only the user token and keeps every other ref");
assert.equal(parseTask(blockRoot, refsFile).state, "to-review", "the unblock keeps the state");
assert.equal((await blockReq(numOf(holdFile), { action: "unblock" })).status, 200, "an unblock on a held task answers 200");
assert.equal(parseTask(blockRoot, holdFile).blockedBy, "#42", "an unblock leaves the remaining ref");
assert.equal(parseTask(blockRoot, holdFile).state, "to-review", "the held task keeps its state on unblock");
assert.ok(existsSync(join(blockRoot, ".kanban", ".poke")), "the unblock pokes the daemon");

const doingName = agentPidName("developer", taskSlug(doingFile));
const devChild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
devChild.unref();
writePid(blockRoot, doingName, devChild.pid!);
try {
	assert.equal((await blockReq(numOf(doingFile), { action: "block" })).status, 200, "a block on a doing task answers 200");
	assert.equal(parseTask(blockRoot, doingFile).state, "to-do", "the block moves doing back to its to-do queue state");
	assert.equal(parseTask(blockRoot, doingFile).blockedBy.trim().toLowerCase(), "user", "the block adds the user hold");
	assert.ok(!existsSync(pidPath(blockRoot, doingName)), "the block clears the developer pid file");
	assert.ok(await gone(devChild.pid!), "the block kills the developer process");
} finally {
	try {
		devChild.kill("SIGKILL");
	} catch {
		/* already gone */
	}
}

const todoName = agentPidName("splitter", taskSlug(todoFile));
const splitChild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
splitChild.unref();
writePid(blockRoot, todoName, splitChild.pid!);
try {
	assert.equal((await blockReq(numOf(todoFile), { action: "block" })).status, 200, "a block on a to-do task answers 200");
	assert.equal(parseTask(blockRoot, todoFile).state, "to-do", "a to-do block keeps the state");
	assert.ok(!existsSync(pidPath(blockRoot, todoName)), "the block clears the splitter pid file");
	assert.ok(await gone(splitChild.pid!), "the block kills the splitter process");
} finally {
	try {
		splitChild.kill("SIGKILL");
	} catch {
		/* already gone */
	}
}
// a dead pid on a doing task: the block clears the stale file and kills nothing
const staleFile = seeded("fix: stale block", "doing");
const staleName = agentPidName("developer", taskSlug(staleFile));
const dead = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
await new Promise((r) => dead.on("exit", r));
assert.ok(!pidAlive(dead.pid!), "the stale pid names a dead process");
writePid(blockRoot, staleName, dead.pid!);
assert.equal((await blockReq(numOf(staleFile), { action: "block" })).status, 200, "a block with a stale agent pid answers 200");
assert.equal(parseTask(blockRoot, staleFile).state, "to-do", "the stale-pid block moves the task to its to-do queue state");
assert.ok(!existsSync(pidPath(blockRoot, staleName)), "the block clears the stale pid file");

// the reader stops converting chunks the moment the next one would pass the cap
const stringified: number[] = [];
const fakeChunk = (n: number) => ({
	length: 600,
	toString: () => {
		stringified.push(n);
		return "x".repeat(600);
	},
});
const chunkStream = new Readable({ objectMode: true, read() {} });
const capRead = readCapped(chunkStream as any);
for (const n of [1, 2, 3, 4]) chunkStream.push(fakeChunk(n));
chunkStream.push(null);
assert.equal(await capRead, null, "a body over the cap reads as null");
assert.deepEqual(stringified, [1], "the reader stops at the cap and stores no later chunk");

// no content-length, so the chunked encoding is the only length on the wire
const chunkedStatus = await new Promise<number>((resolve, reject) => {
	let status = 0;
	const req = httpRequest(
		{ host: "localhost", port: blockUi.port, path: `/api/task-block?num=${numOf(staleFile)}`, method: "POST", headers: { "content-type": "application/json" } },
		(res) => {
			status = res.statusCode ?? 0;
			res.resume();
			res.on("end", () => resolve(status));
			res.on("error", () => resolve(status));
		},
	);
	req.on("error", (err) => (status ? resolve(status) : reject(err)));
	req.write('{"action":"block","pad":"');
	req.write("x".repeat(2000));
	req.end();
});
assert.equal(chunkedStatus, 413, "a chunked body over 1 KiB answers 413");
cleanup();
blockUi.close();
rmSync(blockRoot, { recursive: true, force: true });

// --- part: POST /api/task-priority rewrites the priority line of one task's frontmatter and
// nothing else; project and num arrive in the JSON body, and a GET on the path is a 405 ---
const prioRoot = mkdtempSync(join(tmpdir(), "webui-prior-"));
const prioHome = mkdtempSync(join(tmpdir(), "webui-prior-home-"));
const prioRealHome = process.env.HOME;
// the file's first hub closed at ui.close(), the block part closed its own: this part serves its
// own board, and HOME at its own temp home keeps the hub registry and lock out of the real dir
process.env.HOME = prioHome;
const prioUi = await startHub({ name: "priority-test", root: prioRoot, host: "localhost", port: 0 });
assert.ok(prioUi, "the priority fixture hub starts on port 0");
const prioBase = `http://localhost:${prioUi.port}`;
// the client shape: POST, JSON body, no query string (the acceptance curl carries none either)
const prioReq = (body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) =>
	fetch(`${prioBase}/api/task-priority`, {
		method: init.method ?? "POST",
		headers: init.headers ?? { "content-type": "application/json" },
		body: init.method && init.method !== "POST" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
	});
const prioText = (file: string) => readFileSync(join(prioRoot, ".kanban", file), "utf8");
const prioTask = (name: string, priority = "medium") => createTask(prioRoot, { name, summary: "Priority smoke", specs: "n/a", priority }).file;

const raised = prioTask("feat: priority raise");
const raisedBefore = prioText(raised);
const raisedRes = await prioReq({ num: numOf(raised), priority: "high" });
assert.equal(raisedRes.status, 200, "a valid priority write answers 200");
const raisedBody = await raisedRes.json();
assert.equal(raisedBody.num, numOf(raised), "the response is the updated per-task detail payload");
assert.equal(raisedBody.priority, "high", "the payload carries the new priority");
assert.equal(raisedBody.file, raised, "the payload names the same task file");
const raisedAfter = prioText(raised);
assert.notEqual(raisedAfter, raisedBefore, "the write lands on disk");
const beforeLines = raisedBefore.split("\n");
const afterLines = raisedAfter.split("\n");
assert.equal(afterLines.length, beforeLines.length, "the write changes no line count");
const changedAt = beforeLines.map((line, i) => (line === afterLines[i] ? -1 : i)).filter((i) => i >= 0);
assert.equal(changedAt.length, 1, `exactly one line changes, got ${JSON.stringify(changedAt.map((i) => beforeLines[i]))}`);
assert.equal(beforeLines[changedAt[0]], 'priority: "medium"', "the changed line is the priority line");
assert.equal(afterLines[changedAt[0]], 'priority: "high"', "and it now carries the requested priority");
assert.equal(parseTask(prioRoot, raised).priority, "high", "a re-read agrees with the response, so the next poll cannot disagree");

// a no-op write must not rewrite the file at all (updateAttrs skips an unchanged key)
const sameFile = prioTask("feat: priority same", "low");
const sameBefore = prioText(sameFile);
const sameRes = await prioReq({ num: numOf(sameFile), priority: "low" });
assert.equal(sameRes.status, 200, "a task already at the requested priority answers 200");
assert.equal((await sameRes.json()).priority, "low", "and the payload carries the unchanged priority");
assert.equal(prioText(sameFile), sameBefore, "the unchanged priority leaves the file byte-identical");

// the project is read from the body; an unknown one is a client error, not a missing task
const projFile = prioTask("feat: priority project");
const projRes = await prioReq({ project: prioRoot, num: numOf(projFile), priority: "critical" });
assert.equal(projRes.status, 200, "the body's project names the entry");
assert.equal(parseTask(prioRoot, projFile).priority, "critical", "the root-project write lands");
for (const [body, status, message] of [
	[{ num: numOf(projFile), priority: "urgent" }, 400, "a priority outside the allowlist answers 400"],
	[{ num: numOf(projFile), priority: "HIGH" }, 400, "the allowlist is case-sensitive"],
	[{ num: numOf(projFile) }, 400, "a missing priority answers 400"],
	[{ num: String(numOf(projFile)), priority: "high" }, 400, "a string num answers 400"],
	[{ num: 1.5, priority: "high" }, 400, "a fractional num answers 400"],
	[{ num: 999999, priority: "high" }, 404, "an unknown task number answers 404"],
	[{ project: "/no/such/project", num: numOf(projFile), priority: "high" }, 400, "an unknown project answers 400"],
] as const)
	assert.equal((await prioReq(body)).status, status, message);
assert.ok((await (await prioReq({ num: numOf(projFile), priority: "urgent" })).json()).error, "a rejection carries a JSON error body");
assert.equal((await prioReq("{not json")).status, 400, "a malformed JSON body answers 400");
// any other verb on this path is 405, never the default 404
const prioGet = await prioReq({}, { method: "GET" });
assert.equal(prioGet.status, 405, "a GET on the path answers 405");
assert.ok((await prioGet.json()).error, "the 405 carries a JSON error body");
// the acceptance command `curl -XPOST ... -d '{...}'` sends the form default content-type
assert.equal(
	(await prioReq({ num: numOf(projFile), priority: "low" }, { headers: { "content-type": "application/x-www-form-urlencoded" } })).status,
	200,
	"the bare curl content-type is accepted",
);
assert.equal(parseTask(prioRoot, projFile).priority, "low", "and that write lands too");
assert.equal((await prioReq({ num: numOf(projFile), priority: "high" }, { headers: { "content-type": "text/plain" } })).status, 415, "a non-JSON content-type is refused");
assert.equal(parseTask(prioRoot, projFile).priority, "low", "a refused request writes nothing");

prioUi.close();
process.env.HOME = prioRealHome;
cleanup();
rmSync(prioRoot, { recursive: true, force: true });
rmSync(prioHome, { recursive: true, force: true });
console.log("hub.test.ts: all assertions passed");
