import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mapToTests } from "./test-changed.mjs";

const ORCH = readdirSync("tests/orchestrator").filter((f) => f.endsWith(".test.ts")).sort().map((f) => `tests/orchestrator/${f}`);
const ALL = [...ORCH, "tests/kanban.test.ts", "tests/webui.test.ts", "tests/extension.test.ts", "tests/efficiency-analysis.test.ts", "index.test.ts", "tests/mcp.test.ts", "tests/plugin.test.ts"];

assert.deepEqual(mapToTests([]), [], "no modifications run nothing");
assert.deepEqual(mapToTests(["src/orchestrator.ts"]), ORCH);
assert.deepEqual(mapToTests(["src/pid.ts"]), ORCH);
assert.deepEqual(mapToTests(["agents/developer.md"]), ORCH);
assert.deepEqual(mapToTests(["src/orchestrator/spawn.ts"]), ALL, "orchestrator internals have no rule, everything runs");
assert.deepEqual(mapToTests(["src/webui.ts"]), ["tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["src/webui/board.ts"]), ["tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["src/kanban.ts"]), [...ORCH, "tests/kanban.test.ts", "tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["src/hub.ts"]), [...ORCH, "tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["index.ts"]), ["tests/extension.test.ts", "index.test.ts"]);
assert.deepEqual(mapToTests(["package.json"]), ALL, "package.json runs everything");
assert.deepEqual(mapToTests(["README.md"]), ALL, "an unknown path runs everything");
assert.deepEqual(mapToTests(["hooks/hooks.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests([".claude-plugin/plugin.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests([".mcp.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests(["src/webui.ts", "src/kanban.ts"]), [...ORCH, "tests/kanban.test.ts", "tests/webui.test.ts"], "several paths merge their suites");
assert.deepEqual(mapToTests(["tests/kanban.test.ts"]), ["tests/kanban.test.ts"], "a changed test file runs itself");
assert.deepEqual(mapToTests(["tests/orchestrator/spawn.test.ts"]), ["tests/orchestrator/spawn.test.ts"], "a changed area test runs itself");
console.log("test-changed.test.mjs: mapping table passed");
