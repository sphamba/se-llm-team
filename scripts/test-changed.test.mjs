import assert from "node:assert/strict";
import { mapToTests } from "./test-changed.mjs";

const ALL = ["tests/kanban.test.ts", "tests/orchestrator.test.ts", "tests/webui.test.ts", "tests/extension.test.ts", "index.test.ts"];

assert.deepEqual(mapToTests([]), [], "no modifications run nothing");
assert.deepEqual(mapToTests(["src/orchestrator.ts"]), ["tests/orchestrator.test.ts"]);
assert.deepEqual(mapToTests(["src/pid.ts"]), ["tests/orchestrator.test.ts"]);
assert.deepEqual(mapToTests(["agents/developer.md"]), ["tests/orchestrator.test.ts"]);
assert.deepEqual(mapToTests(["src/webui.ts"]), ["tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["src/kanban.ts"]), ["tests/kanban.test.ts", "tests/orchestrator.test.ts", "tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["src/hub.ts"]), ["tests/orchestrator.test.ts", "tests/webui.test.ts"]);
assert.deepEqual(mapToTests(["index.ts"]), ["tests/extension.test.ts", "index.test.ts"]);
assert.deepEqual(mapToTests(["package.json"]), ALL, "package.json runs everything");
assert.deepEqual(mapToTests(["README.md"]), ALL, "an unknown path runs everything");
assert.deepEqual(mapToTests(["src/webui.ts", "src/kanban.ts"]), ["tests/kanban.test.ts", "tests/orchestrator.test.ts", "tests/webui.test.ts"], "several paths merge their suites");
assert.deepEqual(mapToTests(["tests/kanban.test.ts"]), ["tests/kanban.test.ts"], "a changed test file runs itself");
console.log("test-changed.test.mjs: mapping table passed");
