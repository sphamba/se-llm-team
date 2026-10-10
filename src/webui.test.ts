import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, getTask, setState } from "./kanban.ts";
import { loadWebUiConfig, startWebUi } from "./webui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_NAMES = ["backlog", "to-do", "doing", "to-review", "reviewing", "to-live-test", "live-testing", "done"];

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

// startWebUi on port 0 against a temp board with one task
const task = createTask(root, { name: "feat: webui smoke", summary: "Dashboard smoke", specs: "Render the board" });
const ui = await startWebUi(root, { port: 0 });
assert.ok(ui, "web ui starts on port 0");
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
assert.equal(listed[0].updated, statSync(join(root, ".kanban", task.file)).mtimeMs);
assert.match(listed[0].body, /# Summary\nDashboard smoke/);

// GET / mentions all 8 state names; other paths and methods are 404
const page = await (await fetch(`${base}/`)).text();
assert.ok(page.includes("Software Engineering LLM Team"), "page shows the new title");
assert.ok(page.includes('id="theme"'), "page has the theme toggle");
for (const st of STATE_NAMES) assert.ok(page.includes(st), `page mentions state ${st}`);
assert.equal((await fetch(`${base}/nope`)).status, 404);
assert.equal((await fetch(`${base}/api/tasks`, { method: "POST" })).status, 404);

// agent info: null for a backlog task; populated for a working task with a live pid
assert.equal(listed[0].agent, null);
assert.ok(page.includes('id="m-agent"'), "modal has the agent area");
assert.ok(page.includes("/api/agent-log"), "page uses the agent log endpoint");
setState(root, getTask(root, task.file)!, "doing");
const slug = task.file.replace(/\.md$/, "");
mkdirSync(join(root, ".kanban", ".pids"), { recursive: true });
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), String(process.pid));
mkdirSync(join(root, ".kanban", ".logs"), { recursive: true });
const logFile = join(root, ".kanban", ".logs", `${slug}.developer.log`);
const logText = "H".repeat(40000) + "\nEND\n";
writeFileSync(logFile, logText);
const working = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.deepEqual(working.agent, { role: "developer", alive: true, log: `${slug}.developer` });

// tail: no offset returns only the last chunk, with cursors for poll and history
const enc = encodeURIComponent(`${slug}.developer`);
const tail = await (await fetch(`${base}/api/agent-log?file=${enc}`)).json();
assert.equal(tail.tail, logText.length);
assert.equal(tail.head, logText.length - 16384);
assert.equal(tail.text, logText.slice(logText.length - 16384));
assert.equal(tail.atStart, false);

// poll from an offset returns only new content
const idle = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(idle.text, "");
writeFileSync(logFile, logText + "NEW\n");
const appended = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.tail}`)).json();
assert.equal(appended.text, "NEW\n");
assert.equal(appended.tail, logText.length + 4);

// history: chunks before an offset down to the start of the file
const h1 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${tail.head}&before=1`)).json();
assert.equal(h1.head, tail.head - 16384);
assert.equal(h1.text, logText.slice(h1.head, tail.head));
const h2 = await (await fetch(`${base}/api/agent-log?file=${enc}&offset=${h1.head}&before=1`)).json();
assert.equal(h2.head, 0);
assert.equal(h2.atStart, true);
assert.equal(h2.text + h1.text + tail.text, logText);

// unknown files and non-agent handles are rejected
assert.equal((await fetch(`${base}/api/agent-log?file=nope.developer`)).status, 404);
assert.equal((await fetch(`${base}/api/agent-log?file=${encodeURIComponent(slug + ".merger")}`)).status, 404);
assert.equal((await fetch(`${base}/api/agent-log`)).status, 404);

// a stale pid file reports the agent as not alive
writeFileSync(join(root, ".kanban", ".pids", `${slug}.pid`), "999999999");
const stale = (await (await fetch(`${base}/api/tasks`)).json())[0];
assert.equal(stale.agent.alive, false);

// leave the board as the daemon section expects it
rmSync(join(root, ".kanban", ".pids", `${slug}.pid`));
setState(root, getTask(root, task.file)!, "backlog");

// a second startWebUi on the taken port reports failure instead of throwing
assert.equal(await startWebUi(root, { port: ui.port }), null);
ui.close();

// daemon wiring: HOME at a config with webUi enabled and port 0 -> OS picks, URL logged
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(join(home, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, port: 0 } }));
daemon = spawn(process.execPath, [join(HERE, "orchestrator.ts"), "--root", root], {
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
process.env.HOME = realHome;

cleanup();
console.log("webui.test.ts: all assertions passed");
