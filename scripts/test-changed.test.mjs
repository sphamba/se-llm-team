import assert from "node:assert/strict";
import { expand, mapToTests } from "./test-changed.mjs";

const ORCH = expand(["tests/orchestrator"]);
const KANBAN = expand(["tests/kanban", "tests/kanban.test.ts"]);
const WEBUI = expand(["tests/webui", "tests/webui.test.ts"]);
const EFF = expand(["tests/efficiency-analysis", "tests/efficiency-analysis.test.ts"]);
const ALL = [...ORCH, ...KANBAN, ...WEBUI, ...EFF, "tests/extension.test.ts", "index.test.ts", "tests/mcp.test.ts", "tests/plugin.test.ts"];

assert.deepEqual(mapToTests([]), [], "no modifications run nothing");
assert.deepEqual(mapToTests(["src/orchestrator.ts"]), ORCH);
assert.deepEqual(mapToTests(["src/pid.ts"]), ORCH);
assert.deepEqual(mapToTests(["agents/developer.md"]), ORCH);
assert.deepEqual(mapToTests(["src/orchestrator/spawn.ts"]), ALL, "orchestrator internals have no rule, everything runs");
assert.deepEqual(mapToTests(["src/webui.ts"]), WEBUI);
assert.deepEqual(mapToTests(["src/webui/board.ts"]), WEBUI);
assert.deepEqual(mapToTests(["src/kanban.ts"]), [...ORCH, ...KANBAN, ...WEBUI]);
assert.deepEqual(mapToTests(["src/efficiency-analysis.ts"]), EFF);
assert.deepEqual(mapToTests(["src/hub.ts"]), [...ORCH, "tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["index.ts"]), ["tests/extension.test.ts", "index.test.ts"]);
assert.deepEqual(mapToTests(["package.json"]), ALL, "package.json runs everything");
assert.deepEqual(mapToTests(["README.md"]), ALL, "an unknown path runs everything");
assert.deepEqual(mapToTests(["hooks/hooks.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests([".claude-plugin/plugin.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests([".mcp.json"]), ["tests/plugin.test.ts"]);
assert.deepEqual(mapToTests(["src/webui.ts", "src/kanban.ts"]), [...ORCH, ...KANBAN, ...WEBUI], "several paths merge their suites");
assert.deepEqual(mapToTests(["tests/kanban.test.ts"]), ["tests/kanban.test.ts"], "a changed test file runs itself");
assert.deepEqual(mapToTests(["tests/orchestrator/spawn.test.ts"]), ["tests/orchestrator/spawn.test.ts"], "a changed area test runs itself");
console.log("test-changed.test.mjs: mapping table passed");
