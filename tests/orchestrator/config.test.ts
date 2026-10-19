import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHubRegistry, startHub } from "../../src/hub.ts";
import { createTask, kanbanDir, setState } from "../../src/kanban.ts";
import { loadConfig } from "../../src/orchestrator.ts";
import { HERE, fixture, argvStub, llmArgs, runDaemon, waitFor, freePort, daemons, cleaned } from "../helpers.ts";

// --- part Z: 000215 neutral shared paths: the XDG config dir, the legacy fallback, the
// one-time registry migration, and the legacy-lock warning ---
const nspRoot = fixture();
const nspHome = mkdtempSync(join(tmpdir(), "orch-xdg-home-"));
cleaned.push(nspRoot, nspHome);
const nspXdg = join(nspHome, ".xdg-config");
const nspNeutralDir = join(nspXdg, "se-llm-team");
const nspLegacyDir = join(nspHome, ".pi", "agent");
const nspSavedHome = process.env.HOME;
const nspSavedXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = nspHome;
process.env.XDG_CONFIG_HOME = nspXdg;
// assigning undefined would set the env to the string "undefined", so delete instead
const nspRestoreEnv = () => {
	if (nspSavedHome === undefined) delete process.env.HOME;
	else process.env.HOME = nspSavedHome;
	if (nspSavedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = nspSavedXdg;
};
try {
	// the neutral config is read when present
	mkdirSync(nspNeutralDir, { recursive: true });
	writeFileSync(join(nspNeutralDir, "se-llm-team.json"), JSON.stringify({ agent: "neutral-agent", pollMinutes: 7 }));
	const nspCfg = loadConfig(nspRoot);
	assert.equal(nspCfg.agent, "neutral-agent", "the neutral config is read when present");
	assert.equal(nspCfg.pollMinutes, 7, "the neutral config's keys apply");

	// the legacy config is read when the neutral file is absent, one log line names it
	rmSync(join(nspNeutralDir, "se-llm-team.json"));
	mkdirSync(nspLegacyDir, { recursive: true });
	writeFileSync(join(nspLegacyDir, "se-llm-team.json"), JSON.stringify({ agent: "legacy-agent", pollMinutes: 3 }));
	const nspLegacyCfg = loadConfig(nspRoot);
	assert.equal(nspLegacyCfg.agent, "legacy-agent", "the legacy config is read when the neutral file is absent");
	assert.ok(
		readFileSync(join(kanbanDir(nspRoot), ".logs", "orchestrator.log"), "utf8").includes(`using the legacy config at ${join(nspLegacyDir, "se-llm-team.json")}`),
		"one log line names the legacy config path",
	);

	// the project-local config overrides both globals
	mkdirSync(kanbanDir(nspRoot), { recursive: true });
	writeFileSync(join(nspRoot, ".kanban", "se-llm-team.json"), JSON.stringify({ agent: "project-agent" }));
	assert.equal(loadConfig(nspRoot).agent, "project-agent", "the project-local config overrides the legacy global");
	writeFileSync(join(nspNeutralDir, "se-llm-team.json"), JSON.stringify({ agent: "neutral-agent" }));
	assert.equal(loadConfig(nspRoot).agent, "project-agent", "the project-local config overrides the neutral global too");

	// the hub registry migrates once from the legacy path: a fresh legacy entry copies over and
	// survives the seed
	const nspLegacyProject = join(nspHome, "legacy-project");
	writeFileSync(join(nspLegacyDir, "se-llm-team-hub.json"), JSON.stringify([{ name: "legacy", root: nspLegacyProject, start: Date.now(), lastHeartbeat: Date.now() }]));
	const nspHub = await startHub({ name: "x", root: nspRoot, host: "127.0.0.1", port: 0 });
	assert.ok(nspHub, "the hub starts for the migration check");
	assert.ok(existsSync(join(nspNeutralDir, "se-llm-team-hub.json")), "the legacy registry migrated to the neutral path");
	assert.deepEqual(readHubRegistry().map((e) => e.name).sort(), ["legacy", "x"], "the migrated legacy entry seeded the registry");
	assert.ok(existsSync(join(nspLegacyDir, "se-llm-team-hub.json")), "the legacy registry file is never removed");
	// copy once: the neutral file exists, so a second start never re-copies the legacy registry
	nspHub.close();
	writeFileSync(join(nspNeutralDir, "se-llm-team-hub.json"), "[]\n"); // the hub aged the migrated entry out
	const nspHub2 = await startHub({ name: "x", root: nspRoot, host: "127.0.0.1", port: 0 });
	assert.ok(nspHub2, "the second hub starts");
	assert.deepEqual(readHubRegistry().map((e) => e.name), ["x"], "the legacy registry is not copied a second time");
	nspHub2.close();

	// a legacy lock held by a live process warns (an old-code daemon may still serve the hub),
	// the election continues, and the lock is taken at the neutral path only
	const nspPort = await freePort();
	writeFileSync(join(nspNeutralDir, "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: nspPort } }));
	writeFileSync(join(nspLegacyDir, "se-llm-team-hub.lock"), String(process.pid));
	const nspDaemon = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", nspRoot, "--rescan-seconds", "1", "--poll-minutes", "0.05"], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, HOME: nspHome, XDG_CONFIG_HOME: nspXdg },
	});
	daemons.push({ daemon: nspDaemon, root: nspRoot });
	let nspOut = "";
	nspDaemon.stdout.on("data", (d) => (nspOut += d));
	nspDaemon.stderr.on("data", (d) => (nspOut += d));
	await waitFor(() => nspOut.includes("web ui on"), 15000, "the daemon serves the hub despite the legacy lock", () => nspOut);
	assert.ok(nspOut.includes("old-code daemon may still serve the hub"), "the legacy lock held by a live process warns");
	assert.equal(readFileSync(join(nspNeutralDir, "se-llm-team-hub.lock"), "utf8").trim(), String(nspDaemon.pid), "the hub lock is taken at the neutral path");
	assert.equal(readFileSync(join(nspLegacyDir, "se-llm-team-hub.lock"), "utf8").trim(), String(process.pid), "the legacy lock file is never written or removed");
	nspDaemon.kill("SIGTERM");
} finally {
	nspRestoreEnv();
}
console.log("orchestrator.test.ts: ... + neutral shared paths smoke passed");

// --- part Z2 (#220): an unwritable neutral config dir must not kill the daemon, and the
// election log must name the write failure instead of a rival daemon. Two states of the same
// failure: the dir cannot be created (mkdir EACCES) and the dir exists but cannot be written
// (lock EACCES) ---
const unwritableHubProbe = async (precreate: boolean) => {
	const probeRoot = fixture();
	const probeHome = mkdtempSync(join(tmpdir(), "orch-ro-home-"));
	const probeXdg = mkdtempSync(join(tmpdir(), "orch-ro-xdg-"));
	cleaned.push(probeRoot, probeHome, probeXdg);
	const neutralDir = join(probeXdg, "se-llm-team");
	const lockFile = join(neutralDir, "se-llm-team-hub.lock");
	mkdirSync(join(probeHome, ".pi", "agent"), { recursive: true });
	writeFileSync(join(probeHome, ".pi", "agent", "se-llm-team.json"), JSON.stringify({ webUi: { enabled: true, host: "127.0.0.1", port: await freePort() } }));
	if (precreate) mkdirSync(neutralDir);
	chmodSync(precreate ? neutralDir : probeXdg, 0o555);
	try {
		const probe = spawn(process.execPath, [join(HERE, "../src/orchestrator.ts"), "--root", probeRoot, "--rescan-seconds", "1", "--poll-minutes", "0.05"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, HOME: probeHome, XDG_CONFIG_HOME: probeXdg },
		});
		daemons.push({ daemon: probe, root: probeRoot });
		let out = "";
		probe.stdout.on("data", (d) => (out += d));
		probe.stderr.on("data", (d) => (out += d));
		await waitFor(() => out.includes("hub lock write failed"), 15000, "the election names the write failure", () => out);
		assert.ok(out.includes("EACCES"), "the failure log names the error code");
		assert.ok(out.includes(precreate ? lockFile : neutralDir), "the failure log names the failing path");
		assert.ok(!out.includes("another daemon"), "a write failure is not misreported as a rival daemon");
		await new Promise((r) => setTimeout(r, 1200)); // several hub ticks: the failure still never kills the daemon
		assert.equal(probe.exitCode, null, "the daemon keeps running without the hub");
		probe.kill("SIGTERM");
		await new Promise((r) => probe.on("exit", r));
	} finally {
		chmodSync(precreate ? neutralDir : probeXdg, 0o755); // cleanup needs the dir writable again
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
	join(kanbanDir(rootY), "se-llm-team.json"),
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
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0.05, backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 0.05, "a configured logStallMinutes applies");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: "banana", backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 60, "a non-number logStallMinutes keeps 60");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ logStallMinutes: 0, backlogIdleMinutes: 0 }));
	assert.equal(loadConfig(rootAP).logStallMinutes, 60, "logStallMinutes <= 0 keeps 60");
	// roles.analyst.concurrency: a valid positive integer applies, an invalid value warns
	// and stays unset, so the module default of 8 applies
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 4 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, 4, "a valid roles.analyst.concurrency applies");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 0 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, undefined, "a non-positive roles.analyst.concurrency stays unset");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { concurrency: 2.5 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, undefined, "a non-integer roles.analyst.concurrency stays unset");
	// roles.analyst.mergeThreshold: a valid positive integer applies, an invalid value warns
	// and stays unset, so the module default of 250 applies
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 300 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, 300, "a valid roles.analyst.mergeThreshold applies");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 0 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, undefined, "a non-positive roles.analyst.mergeThreshold stays unset");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyst: { mergeThreshold: 2.5 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, undefined, "a non-integer roles.analyst.mergeThreshold stays unset");
	// backward compat: a pre-rename roles.analyser entry serves as roles.analyst when
	// roles.analyst is absent, and is ignored when roles.analyst is present
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyser: { concurrency: 6, mergeThreshold: 400 } } }));
	assert.equal(loadConfig(rootAP).roles.analyst?.concurrency, 6, "a pre-rename roles.analyser entry maps to roles.analyst");
	assert.equal(loadConfig(rootAP).roles.analyst?.mergeThreshold, 400, "the analyser entry's mergeThreshold maps too");
	writeFileSync(join(kanbanDir(rootAP), "se-llm-team.json"), JSON.stringify({ roles: { analyser: { concurrency: 6 }, analyst: { concurrency: 2 } } }));
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
	writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ maxParallel: 3 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 3, "a configured maxParallel applies");
	writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ maxParallel: 0 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "maxParallel 0 is valid and means no limit");
	writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ maxParallel: -1 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "a negative maxParallel keeps 0");
	writeFileSync(join(kanbanDir(rootAQ), "se-llm-team.json"), JSON.stringify({ maxParallel: 2.5 }));
	assert.equal(loadConfig(rootAQ).maxParallel, 0, "a non-integer maxParallel keeps 0");
} finally {
	process.env.HOME = savedHomeAQ;
}
const orchLogAQ = () => readFileSync(join(kanbanDir(rootAQ), ".logs", "orchestrator.log"), "utf8");
assert.ok(orchLogAQ().includes("maxParallel -1 ignored: must be an integer >= 0"), "a negative maxParallel warned about");
assert.ok(orchLogAQ().includes("maxParallel 2.5 ignored: must be an integer >= 0"), "a non-integer maxParallel warned about");
assert.ok(!orchLogAQ().includes("maxParallel 0 ignored"), "maxParallel 0 is valid, no warning");
console.log("orchestrator.test.ts: ... + maxParallel config smoke passed");
