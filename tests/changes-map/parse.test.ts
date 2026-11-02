// #455 the changes-map answer parser: the model returns strict JSON, but a fence, prose, a
// malformed field or an oversized map must never reach the task file
import assert from "node:assert/strict";
import { parseChangesMap } from "../../src/changes-map.ts";

const symbol = { name: "taskChangesPayload", kind: "fn", ins: 12, del: 3, isNew: false };
const bare = { files: [{ path: "src/webui/payload.ts", symbols: [symbol] }], flows: [{ from: "src/hub.ts", to: "src/webui/payload.ts", what: "the task-changes request" }] };
const text = JSON.stringify(bare);

assert.deepEqual(parseChangesMap(text), bare, "bare strict JSON parses to the contract shape");
assert.deepEqual(parseChangesMap("```json\n" + text + "\n```"), bare, "a fenced block is unwrapped");
assert.deepEqual(parseChangesMap("```\n" + text + "\n```"), bare, "a bare fence is unwrapped too");
assert.deepEqual(parseChangesMap("Here is the map:\n" + text + "\nDone."), bare, "prose around the object is ignored, the outermost braces win");

assert.equal(parseChangesMap("not json at all"), null, "garbage answers null, never a throw");
assert.equal(parseChangesMap(""), null, "an empty answer is no map");
assert.equal(parseChangesMap(undefined), null, "a missing answer is no map");
assert.equal(parseChangesMap("{\"files\": [}"), null, "a broken object answers null");
// a map stored before the rename carries the old key: the fallback keeps it rendering
const legacy = { files: bare.files, transfers: bare.flows };
assert.deepEqual(parseChangesMap(JSON.stringify(legacy)), bare, "a transfers-only answer still parses into flows")

// unknown kinds, bad numbers and a pathless file: the valid entries survive, the rest is dropped
const noisy = parseChangesMap(
	JSON.stringify({
		files: [
			{ path: "src/a.ts", symbols: [{ name: "kept", kind: "fn", ins: 1, del: 2, isNew: true }, { name: "dropped", kind: "var", ins: 1, del: 1, isNew: false }, { name: "clamped", kind: "case", ins: -5, del: "7", isNew: "yes" }] },
			{ symbols: [{ name: "orphan", kind: "fn", ins: 1, del: 1, isNew: false }] },
		],
		flows: [{ from: "src/a.ts", to: "src/b.ts", what: "the helper" }, { to: "src/c.ts" }],
	}),
);
assert.deepEqual(
	noisy,
	{ files: [{ path: "src/a.ts", symbols: [{ name: "kept", kind: "fn", ins: 1, del: 2, isNew: true }, { name: "clamped", kind: "case", ins: 0, del: 0, isNew: false }] }], flows: [{ from: "src/a.ts", to: "src/b.ts", what: "the helper" }] },
	"an unknown kind drops its symbol, a negative or string count clamps to 0, isNew coerces to false, a pathless file drops",
);

// the stored size caps: 60 files, 20 symbols per file, 30 flows, and every clamp is noted
const notes: string[] = [];
const big = parseChangesMap(
	JSON.stringify({
		files: Array.from({ length: 61 }, (_, i) => ({ path: `src/f${i}.ts`, symbols: Array.from({ length: 21 }, (_, j) => ({ name: `s${j}`, kind: "fn", ins: 1, del: 0, isNew: false })) })),
		flows: Array.from({ length: 31 }, (_, i) => ({ from: `src/a${i}.ts`, to: "src/b.ts", what: "x" })),
	}),
	(msg) => notes.push(msg),
)!;
assert.equal(big.files.length, 60, "the file cap keeps 60");
assert.equal(big.files[0].symbols.length, 20, "the symbol cap keeps 20 per file");
assert.equal(big.flows.length, 30, "the flow cap keeps 30");
assert.equal(notes.length, 3, "each clamp logs one note");
assert.ok(notes.every((n) => /clamp/i.test(n)), "each note names the clamp");

console.log("changes-map: parse tests passed");
