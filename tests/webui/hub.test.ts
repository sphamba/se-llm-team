import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, setState } from "../../src/kanban.ts";
import { startHub } from "../../src/hub.ts";
import { loadWebUiConfig, taskHistory, taskPayload } from "../../src/webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-merge", "merging", "to-live-test", "live-testing", "done"];

// 000215: the neutral config dir resolves to $HOME/.config/se-llm-team when XDG_CONFIG_HOME
// is unset, so dropping it keeps every temp-HOME section off the real user config
delete process.env.XDG_CONFIG_HOME;

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

// absent or invalid config = off (HOME at the empty temp home, no board config yet)
const realHome = process.env.HOME;
process.env.HOME = home;
assert.equal(loadWebUiConfig(root).enabled, false);
process.env.HOME = realHome;


// the hub serves the dashboard endpoints; HOME at the temp home keeps the hub registry and
// lock out of the real pi agent dir
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
assert.equal((await fetch(`${base}/nope`)).status, 404);
assert.equal((await fetch(`${base}/api/tasks`, { method: "POST" })).status, 404);
// 000192: the hub serves the statically imported webui module, so a page load writes no
// temp copies under src/
assert.ok(!readdirSync(join(HERE, "..", "..", "src")).some((d) => d.startsWith(".webui-hot-")), "a page load writes no webui copy dirs under src/");


// a second hub on the taken port reports failure instead of throwing
assert.equal(await startHub({ name: "webui-test", root, host: "localhost", port: ui.port }), null);
ui.close();
process.env.HOME = realHome;

// daemon wiring: HOME at a config with webUi enabled and port 0 -> OS picks, URL logged
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, port: 0 } }));
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

// project .kanban/se-llm-team.json overrides the user file for webUi
process.env.HOME = home;
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: 4243 } }));
const overridden = loadWebUiConfig(root);
assert.equal(overridden.host, "127.0.0.1");
assert.equal(overridden.port, 4243);
// a project file without webUi falls back to the user file
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ pollMinutes: 5 }));
assert.equal(loadWebUiConfig(root).enabled, true);
// 000215: the neutral config dir wins over the legacy pi path; the project file overrides both
const neutralHome = join(home, ".config", "se-llm-team");
mkdirSync(neutralHome, { recursive: true });
writeFileSync(join(neutralHome, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "neutral-host" } }));
assert.equal(loadWebUiConfig(root).host, "neutral-host", "the neutral config is read when present");
rmSync(join(neutralHome, "se-llm-team.json"));
assert.equal(loadWebUiConfig(root).enabled, true, "the legacy config is read when the neutral file is absent");
writeFileSync(join(root, ".kanban", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "project-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the project file overrides the legacy global");
writeFileSync(join(neutralHome, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "neutral-host" } }));
assert.equal(loadWebUiConfig(root).host, "project-host", "the project file overrides the neutral global too");
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

cleanup();
rmSync(statsRoot, { recursive: true, force: true });
rmSync(doneRoot, { recursive: true, force: true });
console.log("hub.test.ts: all assertions passed");
