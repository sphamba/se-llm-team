import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHubRegistry, startHub } from "../../src/hub.ts";
import { createTask, kanbanDir, setState } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator.ts";
import { HERE, fixture, argvStub, llmArgs, runDaemon, waitFor, freePort, daemons, cleaned } from "../helpers.ts";

// --- part Z: 000215 global shared paths: the fixed ~/.se-llm-team dir, the ignored XDG
// and legacy paths, the project root se-llm-team.json with a deep merge, and the renamed
// hub files ---
const nspRoot = fixture();
const nspHome = mkdtempSync(join(tmpdir(), "orch-global-home-"));
cleaned.push(nspRoot, nspHome);
const nspGlobalDir = join(nspHome, ".se-llm-team");
const nspXdgDir = join(nspHome, "xdg-config", "se-llm-team");
const nspLegacyDir = join(nspHome, ".pi", "agent");
const nspSavedHome = process.env.HOME;
const nspSavedXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = nspHome;
process.env.XDG_CONFIG_HOME = join(nspHome, "xdg-config");
// assigning undefined would set the env to the string "undefined", so delete instead
const nspRestoreEnv = () => {
	if (nspSavedHome === undefined) delete process.env.HOME;
	else process.env.HOME = nspSavedHome;
	if (nspSavedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = nspSavedXdg;
};
try {
	// the global config is read from ~/.se-llm-team/config.json
	mkdirSync(nspGlobalDir, { recursive: true });
	writeFileSync(
		join(nspGlobalDir, "config.json"),
		JSON.stringify({ agent: "global-agent", pollMinutes: 7, roles: { developer: { model: "global-model", concurrency: 2 } } }),
	);
	const nspCfg = loadConfig(nspRoot);
	assert.equal(nspCfg.agent, "global-agent", "the global config is read from ~/.se-llm-team");
	assert.equal(nspCfg.pollMinutes, 7, "the global config's keys apply");

	// XDG_CONFIG_HOME and the old ~/.pi/agent file are ignored
	mkdirSync(nspXdgDir, { recursive: true });
	writeFileSync(join(nspXdgDir, "config.json"), JSON.stringify({ agent: "xdg-agent" }));
	mkdirSync(nspLegacyDir, { recursive: true });
	writeFileSync(join(nspLegacyDir, "se-llm-team.json"), JSON.stringify({ agent: "legacy-agent" }));
	assert.equal(loadConfig(nspRoot).agent, "global-agent", "XDG and legacy configs are ignored");

	// the project root file overrides the global file and deep-merges nested objects
	writeFileSync(join(nspRoot, "se-llm-team.json"), JSON.stringify({ agent: "project-agent", roles: { developer: { model: "project-model" } } }));
	const nspProject = loadConfig(nspRoot);
	assert.equal(nspProject.agent, "project-agent", "the project root config overrides the global config");
	assert.equal(nspProject.roles.developer?.model, "project-model", "the project root config overrides one nested key");
	assert.equal(nspProject.roles.developer?.concurrency, 2, "the global nested sibling survives the deep merge");
	assert.equal(nspProject.pollMinutes, 7, "the global top-level keys survive a project override");

	// the old .kanban/se-llm-team.json is ignored silently
	mkdirSync(kanbanDir(nspRoot), { recursive: true });
	writeFileSync(join(nspRoot, ".kanban", "se-llm-team.json"), JSON.stringify({ agent: "kanban-agent", pollMinutes: 99 }));
	assert.equal(loadConfig(nspRoot).agent, "project-agent", "the .kanban config is ignored");
	assert.equal(loadConfig(nspRoot).pollMinutes, 7, "the ignored .kanban config changes no key");

	// the hub registry lives at ~/.se-llm-team/hub.json; a legacy ~/.pi registry is not migrated
	const nspLegacyProject = join(nspHome, "legacy-project");
	writeFileSync(join(nspLegacyDir, "hub.json"), JSON.stringify([{ name: "legacy", root: nspLegacyProject, start: Date.now(), lastHeartbeat: Date.now() }]));
	const nspHub = await startHub({ name: "x", root: nspRoot, host: "127.0.0.1", port: 0 });
	assert.ok(nspHub, "the hub starts");
	assert.ok(existsSync(join(nspGlobalDir, "hub.json")), "the hub registry lives at ~/.se-llm-team/hub.json");
	assert.deepEqual(readHubRegistry().map((e) => e.name), ["x"], "the legacy registry is not migrated");
	nspHub.close();

	// the daemon takes the hub lock at the new path; a legacy lock is ignored and left alone
	const nspPort = await freePort();
	writeFileSync(join(nspGlobalDir, "config.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: nspPort } }));
	writeFileSync(join(nspLegacyDir, "hub.lock"), String(process.pid));
	const nspDaemon = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", nspRoot, "--rescan-seconds", "1", "--poll-minutes", "0.05"], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, HOME: nspHome, XDG_CONFIG_HOME: join(nspHome, "xdg-config") },
	});
	daemons.push({ daemon: nspDaemon, root: nspRoot });
	let nspOut = "";
	nspDaemon.stdout.on("data", (d) => (nspOut += d));
	nspDaemon.stderr.on("data", (d) => (nspOut += d));
	await waitFor(() => nspOut.includes("web ui on"), 15000, "the daemon serves the hub beside a legacy lock", () => nspOut);
	assert.ok(!nspOut.includes("legacy hub lock"), "a legacy lock is ignored silently");
	assert.equal(readFileSync(join(nspGlobalDir, "hub.lock"), "utf8").trim(), String(nspDaemon.pid), "the hub lock is taken at the new path");
	assert.equal(readFileSync(join(nspLegacyDir, "hub.lock"), "utf8").trim(), String(process.pid), "the legacy lock file is left alone");
	nspDaemon.kill("SIGTERM");
} finally {
	nspRestoreEnv();
}
console.log("orchestrator.test.ts: ... + global shared paths smoke passed");

// --- part Z2 (#220): an unwritable global config dir must not kill the daemon, and the
// election log must name the write failure instead of a rival daemon. Two states of the same
// failure: the dir cannot be created (mkdir EACCES) and the dir exists but cannot be written
// (lock EACCES) ---
const unwritableHubProbe = async (precreate: boolean) => {
	const probeRoot = fixture();
	const probeHome = mkdtempSync(join(tmpdir(), "orch-ro-home-"));
	cleaned.push(probeRoot, probeHome);
	const globalDir = join(probeHome, ".se-llm-team");
	const lockFile = join(globalDir, "hub.lock");
	// the project root config enables the webui, so the global dir can stay unwritable
	writeFileSync(join(probeRoot, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: await freePort() } }));
	if (precreate) mkdirSync(globalDir);
	chmodSync(precreate ? globalDir : probeHome, 0o555);
	try {
		const probe = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", probeRoot, "--rescan-seconds", "1", "--poll-minutes", "0.05"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, HOME: probeHome },
		});
		daemons.push({ daemon: probe, root: probeRoot });
		let out = "";
		probe.stdout.on("data", (d) => (out += d));
		probe.stderr.on("data", (d) => (out += d));
		await waitFor(() => out.includes("hub lock write failed"), 15000, "the election names the write failure", () => out);
		assert.ok(out.includes("EACCES"), "the failure log names the error code");
		assert.ok(out.includes(precreate ? lockFile : globalDir), "the failure log names the failing path");
		assert.ok(!out.includes("another daemon"), "a write failure is not misreported as a rival daemon");
		await new Promise((r) => setTimeout(r, 1200)); // several hub ticks: the failure still never kills the daemon
		assert.equal(probe.exitCode, null, "the daemon keeps running without the hub");
		probe.kill("SIGTERM");
		await new Promise((r) => probe.on("exit", r));
	} finally {
		chmodSync(precreate ? globalDir : probeHome, 0o755); // cleanup needs the dir writable again
	}
};
await unwritableHubProbe(false);
await unwritableHubProbe(true);
console.log("orchestrator.test.ts: ... + unwritable hub config smoke passed");

// --- part Y: bad llm config values warn and are dropped, the daemon keeps running ---
const rootY = fixture();
cleaned.push(rootY);
const homeY = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeY);
mkdirSync(kanbanDir(rootY), { recursive: true });
writeFileSync(
	join(rootY, "se-llm-team.json"),
	JSON.stringify({ agent: argvStub(rootY), pollMinutes: 0.01, backlogIdleMinutes: 0, provider: "lonely-provider", thinking: "banana", roles: { developer: "not-an-object", reviewer: { thinking: "wild", complex: "not-an-object" } } }),
);
const taskY = createTask(rootY, { name: "fix: bad llm config", summary: "Bad llm config smoke", specs: "n/a" });
setState(rootY, taskY, "to-do");
const y = await runDaemon(rootY, join(HERE, "../src/orchestrator.ts"), homeY);
// wait for the stub's own record, not just the spawn log: the child may not have written argv.log yet
await waitFor(() => {
	try {
		return readFileSync(join(rootY, "argv.log"), "utf8").includes('"developer"');
	} catch {
		return false;
	}
}, 30000, "developer spawned despite bad llm config", y.output);
assert.ok(y.output().includes('unknown thinking level "banana" (global)'), "global thinking typo warned about");
assert.ok(y.output().includes('unknown thinking level "wild" for role "reviewer"'), "role thinking typo warned about");
assert.ok(y.output().includes('provider "lonely-provider" for role developer ignored'), "provider without model warned about");
assert.ok(y.output().includes('non-object complexity override "not-an-object" for role "reviewer" complex, ignored'), "non-object complexity override warned about");
const yDev = JSON.parse(readFileSync(join(rootY, "argv.log"), "utf8").trim().split("\n").find((l) => l.includes('"developer"'))!) as { role: string; argv: string[] };
assert.deepEqual(llmArgs(yDev.argv), [], "bad config values add no flags");
y.daemon.kill("SIGTERM");
console.log("orchestrator.test.ts: ... + bad llm config smoke passed");

// --- part AP: the logStallMinutes config: a missing key keeps the default 60, a configured
// value applies, an invalid value warns and keeps 10. loadConfig runs directly; the empty
// temp HOME keeps the ambient user-level config out ---
const rootAP = fixture();
cleaned.push(rootAP);
const homeAP = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAP);
mkdirSync(kanbanDir(rootAP), { recursive: true });
const savedHomeAP = process.env.HOME;
process.env.HOME = homeAP;
try {
	assert.equal(loadConfig(rootAP).logStallMinutes, 60, "a missing logStallMinutes key keeps the default 60");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0.05, backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 0.05, "a configured logStallMinutes applies");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ logStallMinutes: "banana", backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 60, "a non-number logStallMinutes keeps 60");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0, backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 60, "logStallMinutes <= 0 keeps 60");
	// roles.analyst.concurrency: a valid positive integer applies, an invalid value warns
	// and stays unset, so the module default of 8 applies
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 4 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, 4, "a valid roles.analyst.concurrency applies");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 0 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, undefined, "a non-positive roles.analyst.concurrency stays unset");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 2.5 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, undefined, "a non-integer roles.analyst.concurrency stays unset");
	// roles.analyst.mergeThreshold: a valid positive integer applies, an invalid value warns
	// and stays unset, so the module default of 250 applies
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 300 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, 300, "a valid roles.analyst.mergeThreshold applies");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 0 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, undefined, "a non-positive roles.analyst.mergeThreshold stays unset");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 2.5 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, undefined, "a non-integer roles.analyst.mergeThreshold stays unset");
	// roles.doctor.maxNotesBullets: a valid positive integer applies, an invalid value warns
	// and stays unset, so the use-site default of 20 applies
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { doctor: { maxNotesBullets: 30 } } }));
	assert.equal(loadConfig(rootAP).roles.doctor?.maxNotesBullets, 30, "a valid roles.doctor.maxNotesBullets applies");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { doctor: { maxNotesBullets: 0 } } }));
	assert.equal(loadConfig(rootAP).roles.doctor?.maxNotesBullets, undefined, "a non-positive roles.doctor.maxNotesBullets stays unset");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { doctor: { maxNotesBullets: 2.5 } } }));
	assert.equal(loadConfig(rootAP).roles.doctor?.maxNotesBullets, undefined, "a non-integer roles.doctor.maxNotesBullets stays unset");
	// backward compat: a pre-rename roles.analyser entry serves as roles.analyst when
	// roles.analyst is absent, and is ignored when roles.analyst is present
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyser: { concurrency: 6, mergeThreshold: 400 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, 6, "a pre-rename roles.analyser entry maps to roles.analyst");
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, 400, "the analyser entry's mergeThreshold maps too");
	writeFileSync(join(rootAP, "se-llm-team.json"), JSON.stringify({ roles: { analyser: { concurrency: 6 }, analyst: { concurrency: 2 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, 2, "roles.analyst wins when both entries exist");
} finally {
	process.env.HOME = savedHomeAP;
}
const orchLogAP = () => readFileSync(join(kanbanDir(rootAP), ".logs", "orchestrator.log"), "utf8");
assert.ok(orchLogAP().includes('logStallMinutes "banana" ignored: must be a positive number of minutes'), "a non-number logStallMinutes warned about");
assert.ok(orchLogAP().includes("logStallMinutes 0 ignored: must be a positive number of minutes"), "logStallMinutes <= 0 warned about");
assert.ok(orchLogAP().includes('invalid roles.analyst.concurrency 0, ignored (expected a positive integer)'), "a non-positive roles.analyst.concurrency warned about");
assert.ok(orchLogAP().includes('invalid roles.analyst.concurrency 2.5, ignored (expected a positive integer)'), "a non-integer roles.analyst.concurrency warned about");
assert.ok(orchLogAP().includes('invalid roles.analyst.mergeThreshold 0, ignored (expected a positive integer)'), "a non-positive roles.analyst.mergeThreshold warned about");
assert.ok(orchLogAP().includes('invalid roles.analyst.mergeThreshold 2.5, ignored (expected a positive integer)'), "a non-integer roles.analyst.mergeThreshold warned about");
assert.ok(orchLogAP().includes('invalid roles.doctor.maxNotesBullets 0, ignored (expected a positive integer)'), "a non-positive roles.doctor.maxNotesBullets warned about");
assert.ok(orchLogAP().includes('invalid roles.doctor.maxNotesBullets 2.5, ignored (expected a positive integer)'), "a non-integer roles.doctor.maxNotesBullets warned about");
console.log("orchestrator.test.ts: ... + logStallMinutes config smoke passed");

// --- part AQ: the maxParallel config: a missing key keeps the default 0 (no limit), a
// configured value applies, an invalid value warns and keeps 0. loadConfig runs directly;
// the empty temp HOME keeps the ambient user-level config out ---
const rootAQ = fixture();
cleaned.push(rootAQ);
const homeAQ = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAQ);
mkdirSync(kanbanDir(rootAQ), { recursive: true });
const savedHomeAQ = process.env.HOME;
process.env.HOME = homeAQ;
try {
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "a missing maxParallel key keeps the default 0");
	writeFileSync(join(rootAQ, "se-llm-team.json"), JSON.stringify({ maxParallel: 3 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 3, "a configured maxParallel applies");
	writeFileSync(join(rootAQ, "se-llm-team.json"), JSON.stringify({ maxParallel: 0 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "maxParallel 0 is valid and means no limit");
	writeFileSync(join(rootAQ, "se-llm-team.json"), JSON.stringify({ maxParallel: -1 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "a negative maxParallel keeps 0");
	writeFileSync(join(rootAQ, "se-llm-team.json"), JSON.stringify({ maxParallel: 2.5 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "a non-integer maxParallel keeps 0");
} finally {
	process.env.HOME = savedHomeAQ;
}
const orchLogAQ = () => readFileSync(join(kanbanDir(rootAQ), ".logs", "orchestrator.log"), "utf8");
assert.ok(orchLogAQ().includes("maxParallel -1 ignored: must be an integer >= 0"), "a negative maxParallel warned about");
assert.ok(orchLogAQ().includes("maxParallel 2.5 ignored: must be an integer >= 0"), "a non-integer maxParallel warned about");
assert.ok(!orchLogAQ().includes("maxParallel 0 ignored"), "maxParallel 0 is valid, no warning");
console.log("orchestrator.test.ts: ... + maxParallel config smoke passed");

// --- part AR: the roles.doctor.maxNotesBullets knob reaches the rendered doctor prompt
// through the real analysis runner: node src/analysis-run.ts against a fixture root with a
// stub agent (HOME isolated, so no ambient config leaks in). With no key the use-site
// default 20 renders into the shipped agents/doctor.md; an override renders its value ---
const rootAR = mkdtempSync(join(tmpdir(), "orch-notes-cap-"));
cleaned.push(rootAR);
const homeAR = mkdtempSync(join(tmpdir(), "orch-home-"));
cleaned.push(homeAR);
mkdirSync(join(rootAR, ".kanban"), { recursive: true });
const stubAR = join(rootAR, "argv-agent.cjs");
writeFileSync(
	stubAR,
	`#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(join(rootAR, "stub.argv.log"))}, JSON.stringify(process.argv) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "OK" }] } }) + "\\n");
`,
);
chmodSync(stubAR, 0o755);
const runAR = (name: string) =>
	execFileSync(process.execPath, [join(HERE, "../src/analysis-run.ts"), rootAR, join(rootAR, name), "developer"], {
		env: { ...process.env, HOME: homeAR },
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 120000,
	});
const writeLogAR = (name: string) =>
	writeFileSync(join(rootAR, name), JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "did the thing" }] } }) + "\n");
const doctorPromptAR = () => {
	const lines = readFileSync(join(rootAR, "stub.argv.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
	// the doctor call runs last and is the only one without the analyst tool isolation
	const argv = lines.filter((a) => !a.includes("--no-tools")).at(-1)!;
	return argv[argv.length - 1];
};
// default: no roles.doctor key, the use-site default 20 renders
writeFileSync(join(rootAR, "se-llm-team.json"), JSON.stringify({ agent: stubAR }));
writeLogAR("one.log");
runAR("one.log");
let promptAR = doctorPromptAR();
assert.ok(promptAR.includes("keep at most 20 top-level bullets"), `the default cap 20 renders: ...${promptAR.slice(-300)}`);
assert.ok(!promptAR.includes("{{maxNotesBullets}}"), "the placeholder never stays literal");
// override: roles.doctor.maxNotesBullets renders its value
writeFileSync(join(rootAR, "se-llm-team.json"), JSON.stringify({ agent: stubAR, roles: { doctor: { maxNotesBullets: 7 } } }));
writeLogAR("two.log");
runAR("two.log");
promptAR = doctorPromptAR();
assert.ok(promptAR.includes("keep at most 7 top-level bullets"), `the configured cap 7 renders: ...${promptAR.slice(-300)}`);
console.log("orchestrator.test.ts: ... + maxNotesBullets through the analysis runner passed");
