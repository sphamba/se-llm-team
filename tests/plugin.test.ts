import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPORT_MAX_AGE_MS } from "../src/orchestrator/report.ts";

const repo = realpathSync(join(import.meta.dirname, ".."));

// the plugin manifests parse as JSON
const plugin = JSON.parse(readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8"));
const marketplace = JSON.parse(readFileSync(join(repo, ".claude-plugin", "marketplace.json"), "utf8"));
const hooks = JSON.parse(readFileSync(join(repo, "hooks", "hooks.json"), "utf8"));
const mcp = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));

// plugin identity, marketplace listing and the version sync with package.json
assert.equal(plugin.name, "se-llm-team");
assert.deepEqual(plugin.agents, [], "the agents manifest key replaces the agents/ scan, so the daemon role prompts ship no session subagents");
assert.equal(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version, plugin.version, "plugin.json version matches package.json");
assert.equal(marketplace.name, "se-llm-team");
const entry = marketplace.plugins.find((p: any) => p.name === "se-llm-team");
assert.ok(entry, "the marketplace lists se-llm-team");
assert.equal(entry.source, "./", "the plugin source is the marketplace root itself");

// every ${CLAUDE_PLUGIN_ROOT} path the manifests reference exists in the repo
const resolveRoot = (p: string) => p.replace("${CLAUDE_PLUGIN_ROOT}", repo);
for (const [name, server] of Object.entries<any>(mcp.mcpServers)) {
	assert.equal(server.command, "node");
	assert.ok(existsSync(resolveRoot(server.args[0])), `${name} mcp command points at an existing file`);
}
assert.ok(hooks.hooks.UserPromptSubmit?.length, "a UserPromptSubmit hook is registered");
assert.ok(hooks.hooks.SessionStart?.length, "a SessionStart hook is registered");
for (const [event, entries] of Object.entries<any>(hooks.hooks)) {
	for (const e of entries) for (const h of e.hooks) {
		assert.equal(h.command, "node");
		assert.ok(existsSync(resolveRoot(h.args[0])), `${event} hook command points at an existing file`);
	}
}

// the skill ships at the conventional path and stays user-invoked
const skill = readFileSync(join(repo, "skills", "se-llm-team", "SKILL.md"), "utf8");
assert.match(skill, /disable-model-invocation: true/);

// the drain script: exits 0 with no reports dir and on an empty one, drains a fresh fixture
// report to stdout and removes it, drops a report older than the cutoff
const root = realpathSync(mkdtempSync(join(tmpdir(), "plugin-test-")));
const script = join(repo, "hooks", "drain-reports.ts");
const run = () => execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
try {
	assert.doesNotThrow(run, "no reports dir exits 0");
	const reportsDir = join(root, ".kanban", ".reports");
	mkdirSync(reportsDir, { recursive: true });
	assert.doesNotThrow(run, "empty reports dir exits 0");

	const fixture = join(reportsDir, "2026-01-01T00-00-00-000Z.md");
	writeFileSync(fixture, "# Board report\n\nfixture body\n");
	const stale = join(reportsDir, "2020-01-01T00-00-00-000Z.md");
	writeFileSync(stale, "stale body\n");
	const aged = new Date(Date.now() - REPORT_MAX_AGE_MS - 60_000);
	utimesSync(stale, aged, aged);
	const out = run();
	assert.ok(out.includes("fixture body"), "the fresh fixture report is drained to stdout");
	assert.ok(!out.includes("stale body"), "a report older than the cutoff is dropped, not printed");
	assert.ok(!existsSync(fixture), "the drained file is removed");
	assert.ok(!existsSync(stale), "the stale file is removed");
	assert.ok(!existsSync(`${fixture}.claiming`), "no claim file is left behind");
	console.log("plugin.test.ts: all assertions passed");
} finally {
	rmSync(root, { recursive: true, force: true });
}
