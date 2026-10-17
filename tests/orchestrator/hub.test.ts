import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readHubRegistry, startHub } from "../../src/hub.ts";
import { createTask, isLinkedWorktree } from "../../src/kanban.ts";
import { HERE, fixture, waitFor, waitForAsync, freePort, daemons, cleaned } from "../helpers.ts";

// --- part U: hub server unit smoke: health, register, heartbeat, registry, per-project reads ---
const rootU1 = fixture();
const rootU2 = fixture();
const homeU = mkdtempSync(join(tmpdir(), "orch-hub-home-"));
cleaned.push(rootU1, rootU2, homeU);
const taskU2 = createTask(rootU2, { name: "fix: hub board b", summary: "Hub smoke", specs: "n/a" });
const realHome = process.env.HOME;
process.env.HOME = homeU;
// a registry left by a previous hub, carrying one long-stale entry: the new hub drops it at seed
mkdirSync(join(homeU, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeU, ".pi", "agent", "se-llm-team-hub.json"), JSON.stringify([{ name: "stale", root: rootU1, start: Date.now() - 60000, lastHeartbeat: Date.now() - 60000 }]));
const hubU = await startHub({ name: "a", root: rootU1, host: "127.0.0.1", port: 0, staleMs: 400, healthMs: 150 });
assert.ok(hubU, "hub starts and returns a port");
// 000215: the legacy registry seeded above copied to the neutral path at hub start
assert.ok(existsSync(join(homeU, ".config", "se-llm-team", "se-llm-team-hub.json")), "the hub registry lives at the neutral path");
assert.ok(existsSync(join(homeU, ".pi", "agent", "se-llm-team-hub.json")), "the legacy registry file is never removed");
const hubBase = `http://127.0.0.1:${hubU.port}`;
assert.equal(await (await fetch(`${hubBase}/health`)).text(), "ok");
const regRes = await fetch(`${hubBase}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "b", root: rootU2, branch: "feat/x" }) });
assert.equal(regRes.status, 200);
const regEntry = await regRes.json();
assert.deepEqual(Object.keys(regEntry).sort(), ["branch", "lastHeartbeat", "name", "root", "start"], "register answers the entry shape");
assert.equal(regEntry.branch, "feat/x", "register stores the checkout's branch");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 400, "register without root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "", root: rootU2 }) })).status, 400, "register with empty name rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "/nonexistent/dir" }) })).status, 400, "register with nonexistent root rejected");
assert.equal((await fetch(`${hubBase}/register`, { method: "POST", body: JSON.stringify({ name: "b", root: "relative/dir" }) })).status, 400, "register with relative root rejected");
const beforeBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "b" }) })).status, 200, "a name-only heartbeat (old daemon) still finds the entry");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "nope" }) })).status, 404, "heartbeat of an unknown project 404s");
assert.equal((await fetch(`${hubBase}/heartbeat`, { method: "POST", body: JSON.stringify({ name: "b", root: rootU2, branch: "main" }) })).status, 200);
const afterBeat = (await (await fetch(`${hubBase}/api/projects`)).json()).find((e: any) => e.name === "b");
assert.ok(afterBeat.lastHeartbeat >= beforeBeat.lastHeartbeat, "heartbeat refreshes lastHeartbeat");
assert.equal(afterBeat.branch, "main", "heartbeat re-resolves the branch, so the label tracks the checkout");
const registryU = readHubRegistry();
assert.deepEqual(registryU.map((e) => e.name).sort(), ["a", "b"], "stale seed entry dropped, one entry per project");
assert.equal(registryU.find((e) => e.name === "a")!.root, rootU1);
assert.equal(registryU.find((e) => e.name === "b")!.root, rootU2);
assert.deepEqual(readdirSync(join(homeU, ".config", "se-llm-team")).filter((f) => f.includes(".tmp")), [], "no atomic-rename temp litter in the neutral registry dir");
const viaProject = await (await fetch(`${hubBase}/api/tasks?project=b`)).json();
assert.equal(viaProject.length, 1);
assert.equal(viaProject[0].file, taskU2.file);
assert.equal(viaProject[0].name, "fix: hub board b");
// 000103: root is the identity - a second checkout of the same repo registers its own entry
const rootU3 = fixture();
cleaned.push(rootU3);
const taskU3 = createTask(rootU3, { name: "fix: hub board b2", summary: "Hub smoke", specs: "n/a" });
const reg3 = await fetch(`${hubBase}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "b", root: rootU3, branch: "feat" }) });
assert.equal(reg3.status, 200);
const sameNamed = (await (await fetch(`${hubBase}/api/projects`)).json()).filter((e: any) => e.name === "b");
assert.equal(sameNamed.length, 2, "two same-named checkouts keep their own entries");
assert.deepEqual((await (await fetch(`${hubBase}/api/tasks?project=${encodeURIComponent(rootU2)}`)).json()).map((t: any) => t.file), [taskU2.file], "root selects the first checkout's board");
assert.deepEqual((await (await fetch(`${hubBase}/api/tasks?project=${encodeURIComponent(rootU3)}`)).json()).map((t: any) => t.file), [taskU3.file], "root selects the second checkout's board");
assert.equal((await fetch(`${hubBase}/api/tasks?project=nope`)).status, 404, "unknown project rejected");
assert.equal((await (await fetch(`${hubBase}/api/tasks`)).json()).length, 0, "no project param serves the hub's own board");
assert.equal((await (await fetch(`${hubBase}/api/projects`)).json()).length, 3);
assert.ok((await (await fetch(`${hubBase}/`)).text()).includes("Software Engineering LLM Team"), "the hub serves the ui page");
assert.equal((await fetch(`${hubBase}/api/tasks`, { method: "POST" })).status, 404);
// b stops heartbeating: the running hub ages the silent entry out of the registry
await waitFor(() => readHubRegistry().map((e) => e.name).join() === "a", 5000, "running hub ages out silent entries", () => "");
assert.equal((await fetch(`${hubBase}/api/tasks?project=b`)).status, 404, "aged-out project no longer served");
hubU.close();
assert.deepEqual(readHubRegistry(), [], "close removes the hub's own entry from the registry");
process.env.HOME = realHome;
console.log("orchestrator.test.ts: ... + hub server unit smoke passed");

// --- part V: election race: two daemons on one port elect exactly one hub, the loser joins ---
const rootV1 = fixture();
const rootV2 = fixture();
const homeV = mkdtempSync(join(tmpdir(), "orch-hub-race-home-"));
cleaned.push(rootV1, rootV2, homeV);
const taskV2 = createTask(rootV2, { name: "fix: raced board", summary: "Election smoke", specs: "n/a" });
const portV = await freePort();
mkdirSync(join(homeV, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeV, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portV }, backlogIdleMinutes: 0 }));
const hubEnv = { ...process.env, HOME: homeV, SE_LLM_TEAM_HUB_HEALTH_MS: "500" };
delete hubEnv.SE_LLM_TEAM_NO_WEBUI; // the election needs the webui enabled; the temp HOME config picks a free port
const dV1 = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootV1, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnv });
const dV2 = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootV2, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnv });
daemons.push({ daemon: dV1, root: rootV1 }, { daemon: dV2, root: rootV2 });
let outV1 = "", outV2 = "";
dV1.stdout.on("data", (d) => (outV1 += d));
dV1.stderr.on("data", (d) => (outV1 += d));
dV2.stdout.on("data", (d) => (outV2 += d));
dV2.stderr.on("data", (d) => (outV2 += d));
const nameV1 = basename(rootV1), nameV2 = basename(rootV2);
await waitFor(() => outV1.includes("web ui on") || outV2.includes("web ui on"), 15000, "one daemon won the election", () => outV1 + outV2);
const winnerIs1 = outV1.includes("web ui on");
assert.ok(!(winnerIs1 ? outV2 : outV1).includes("web ui on"), "the loser never served the ui");
await waitFor(() => (winnerIs1 ? outV2 : outV1).includes(`registered ${winnerIs1 ? nameV2 : nameV1} with the hub`), 15000, "loser registered with the hub", () => outV1 + outV2);
const baseV = `http://127.0.0.1:${portV}`;
await waitForAsync(async () => {
	try {
		return (await (await fetch(`${baseV}/api/projects`)).json()).length === 2;
	} catch {
		return false;
	}
}, 15000, "both projects registered in the hub");
assert.deepEqual((await (await fetch(`${baseV}/api/projects`)).json()).map((e: any) => e.name).sort(), [nameV1, nameV2].sort());
const tasksV = await (await fetch(`${baseV}/api/tasks?project=${nameV2}`)).json();
assert.equal(tasksV.length, 1);
assert.equal(tasksV[0].file, taskV2.file);
assert.equal((await (await fetch(`${baseV}/api/tasks?project=${nameV1}`)).json()).length, 0);
assert.equal((await fetch(`${baseV}/api/tasks?project=nope`)).status, 404);
const registryV = JSON.parse(readFileSync(join(homeV, ".config", "se-llm-team", "se-llm-team-hub.json"), "utf8"));
assert.deepEqual(registryV.map((e: any) => e.name).sort(), [nameV1, nameV2].sort(), "registry file carries both entries");
assert.ok(registryV.every((e: any) => typeof e.branch === "string" && e.branch.length > 0), "registry entries carry the root checkout's branch");
dV1.kill("SIGTERM");
dV2.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + election race smoke passed");

// --- part W: failover: killing the hub re-elects a survivor, the new hub ages out the dead entry ---
const rootW1 = fixture();
const rootW2 = fixture();
const homeW = mkdtempSync(join(tmpdir(), "orch-hub-fail-home-"));
cleaned.push(rootW1, rootW2, homeW);
const portW = await freePort();
mkdirSync(join(homeW, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeW, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portW }, backlogIdleMinutes: 0 }));
const hubEnvW = { ...process.env, HOME: homeW, SE_LLM_TEAM_HUB_HEALTH_MS: "500", SE_LLM_TEAM_HUB_STALE_MS: "1500" };
delete hubEnvW.SE_LLM_TEAM_NO_WEBUI;
const dW1 = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootW1, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnvW });
const dW2 = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", rootW2, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: hubEnvW });
daemons.push({ daemon: dW1, root: rootW1 }, { daemon: dW2, root: rootW2 });
let outW1 = "", outW2 = "";
dW1.stdout.on("data", (d) => (outW1 += d));
dW1.stderr.on("data", (d) => (outW1 += d));
dW2.stdout.on("data", (d) => (outW2 += d));
dW2.stderr.on("data", (d) => (outW2 += d));
const nameW1 = basename(rootW1), nameW2 = basename(rootW2);
await waitFor(() => outW1.includes("web ui on") || outW2.includes("web ui on"), 15000, "hub elected", () => outW1 + outW2);
const hubIs1 = outW1.includes("web ui on");
const hubProc = hubIs1 ? dW1 : dW2;
const survProc = hubIs1 ? dW2 : dW1;
const survName = hubIs1 ? nameW2 : nameW1;
const deadName = hubIs1 ? nameW1 : nameW2;
await waitForAsync(async () => {
	try {
		return (await (await fetch(`http://127.0.0.1:${portW}/api/projects`)).json()).length === 2;
	} catch {
		return false;
	}
}, 15000, "both registered before the kill");
hubProc.kill("SIGKILL");
await waitFor(() => (hubIs1 ? outW2 : outW1).includes("web ui on"), 20000, "survivor re-elected as hub after hub death", () => outW1 + outW2);
await waitForAsync(async () => {
	try {
		const projects = await (await fetch(`http://127.0.0.1:${portW}/api/projects`)).json();
		return projects.length === 1 && projects[0].name === survName;
	} catch {
		return false;
	}
}, 15000, "new hub serves only the survivor (dead entry aged out)");
assert.equal((await fetch(`http://127.0.0.1:${portW}/api/tasks?project=${deadName}`)).status, 404, "dead project rejected by the new hub");
assert.equal(parseInt(readFileSync(join(homeW, ".config", "se-llm-team", "se-llm-team-hub.lock"), "utf8").trim(), 10), survProc.pid, "the stale hub lock was stolen by the survivor");
assert.ok(!existsSync(join(homeW, ".pi", "agent", "se-llm-team-hub.lock")), "the hub lock is never taken at the legacy path");
survProc.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + hub failover smoke passed");

// --- part Y2: 000168 hub candidacy is git topology: a linked worktree outside .worktrees
// stands down like a task worktree; a main checkout, a subdir of one and a non-git root stay
// hub-eligible ---
const repoT = fixture();
const wtT = join(mkdtempSync(join(tmpdir(), "orch-hub-wt-out-")), "wt");
cleaned.push(repoT, dirname(wtT));
execSync(`git worktree add -q ${wtT} -b wt-out`, { cwd: repoT, shell: "/bin/bash" });
assert.equal(isLinkedWorktree(repoT), false, "a main checkout is hub-eligible");
mkdirSync(join(repoT, "sub"));
assert.equal(isLinkedWorktree(join(repoT, "sub")), false, "a subdir of a main checkout is hub-eligible");
assert.equal(isLinkedWorktree(wtT), true, "a linked worktree outside .worktrees is not hub-eligible");
mkdirSync(join(wtT, "sub"));
assert.equal(isLinkedWorktree(join(wtT, "sub")), true, "a subdir of a linked worktree is not hub-eligible");
const nogitT = mkdtempSync(join(tmpdir(), "orch-hub-nogit-"));
cleaned.push(nogitT);
assert.equal(isLinkedWorktree(nogitT), false, "a non-git root is hub-eligible");
const homeT = mkdtempSync(join(tmpdir(), "orch-hub-wt-out-home-"));
cleaned.push(homeT);
const portT = await freePort();
mkdirSync(join(homeT, ".pi", "agent"), { recursive: true });
writeFileSync(join(homeT, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: portT }, backlogIdleMinutes: 0 }));
const envT = { ...process.env, HOME: homeT, SE_LLM_TEAM_HUB_HEALTH_MS: "300" };
delete envT.SE_LLM_TEAM_NO_WEBUI;
const dT = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", wtT, "--rescan-seconds", "1", "--poll-minutes", "0.05"], { stdio: ["ignore", "pipe", "pipe"], env: envT });
daemons.push({ daemon: dT, root: wtT });
let outT = "";
dT.stdout.on("data", (d) => (outT += d));
dT.stderr.on("data", (d) => (outT += d));
const exitT = new Promise<string>((r) => dT.on("exit", (code) => r(String(code))));
await waitFor(() => outT.includes("stands down"), 15000, "worktree-outside-.worktrees daemon stands down with no hub", () => outT);
assert.ok(!outT.includes("web ui on"), "a worktree outside .worktrees never races for the port");
assert.ok(!existsSync(join(homeT, ".config", "se-llm-team", "se-llm-team-hub.lock")), "a worktree outside .worktrees never races for the hub lock");
await new Promise((r) => setTimeout(r, 1200)); // several hub ticks: still never served
assert.ok(!outT.includes("web ui on"), "a worktree outside .worktrees never serves the ui");
assert.equal(await Promise.race([exitT, Promise.resolve("alive")]), "alive", "a daemon rooted outside .worktrees is not reaped as a task worktree");
dT.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + worktree-outside-.worktrees hub candidacy smoke passed");
