import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startHub } from "../../src/hub.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "../../src/webui/fonts");
const FACES = ["space-grotesk-400", "space-grotesk-500", "space-grotesk-700", "ibm-plex-mono-400", "ibm-plex-mono-500"];
const LICENSES = ["OFL-SpaceGrotesk.txt", "OFL-IBMPlexMono.txt"];

// 000372: the five committed faces are the contract the sibling tokens task declares @font-face for
const WOFF2 = FACES.map((face) => `${face}.woff2`);
for (const name of WOFF2) {
	const file = join(FONT_DIR, name);
	assert.ok(existsSync(file), `missing ${name}`);
	assert.equal(readFileSync(file).subarray(0, 4).toString("latin1"), "wOF2", `${name} is a real woff2`);
}
for (const name of LICENSES) assert.ok(existsSync(join(FONT_DIR, name)), `missing ${name}`);

const root = mkdtempSync(join(tmpdir(), "fonts-test-"));
const home = mkdtempSync(join(tmpdir(), "fonts-home-"));
const cleanup = () => {
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

// HOME at the temp home keeps the hub registry and lock out of the real global dir
process.env.HOME = home;
const ui = await startHub({ name: "fonts-test", root, host: "localhost", port: 0 });
assert.ok(ui, "hub starts on port 0");
const base = `http://localhost:${ui.port}`;

// fetch normalizes "..", so the traversal cases need the raw path
const rawGet = (path: string): Promise<{ status: number; body: string }> =>
	new Promise((resolve, reject) => {
		const req = httpRequest({ host: "localhost", port: ui.port, path, method: "GET" }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("latin1") }));
		});
		req.on("error", reject);
		req.end();
	});

for (const name of WOFF2) {
	const res = await fetch(`${base}/fonts/${name}`);
	assert.equal(res.status, 200, `${name} is served`);
	assert.equal(res.headers.get("content-type"), "font/woff2", `${name} content-type`);
	assert.ok(res.headers.get("cache-control"), `${name} cache-control`);
	const body = Buffer.from(await res.arrayBuffer());
	assert.equal(body.subarray(0, 4).toString("latin1"), "wOF2", `${name} body is woff2`);
	assert.deepEqual(body, readFileSync(join(FONT_DIR, name)), `${name} body is the committed file`);
}

for (const path of ["/fonts/unknown.woff2", "/fonts/", "/fonts/space-grotesk-400.woff2/extra"]) {
	const res = await fetch(`${base}${path}`);
	assert.equal(res.status, 404, `${path} is 404`);
}

for (const path of ["/fonts/..%2fpackage.json", "/fonts/../../etc/passwd"]) {
	const res = await rawGet(path);
	assert.equal(res.status, 404, `${path} is 404`);
	assert.ok(!res.body.includes('"packageManager"'), `${path} leaks package.json`);
	assert.ok(!res.body.includes("root:"), `${path} leaks /etc/passwd`);
}

cleanup();

console.log("fonts.test.ts: all assertions passed");
