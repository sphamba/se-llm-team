import assert from "node:assert/strict";
import { livePage } from "../../src/webui/page-source.ts";

// 000383: the served page keys off the newest webui source mtime, so a merged ui change lands on
// the next reload with no daemon restart, and an unchanged source costs one stat set, no re-render.

// same stamp: the cached page, one render
{
	let renders = 0;
	const page = livePage(() => 100, () => `page-${++renders}`);
	assert.equal(await page(), "page-1");
	assert.equal(await page(), "page-1", "an unchanged stamp serves the cached page");
	assert.equal(renders, 1, "an unchanged stamp does not re-render");
}

// a newer stamp: exactly one more render, and the new page
{
	let stamp = 100;
	let renders = 0;
	const page = livePage(() => stamp, () => `page-${++renders}`);
	assert.equal(await page(), "page-1");
	stamp = 200;
	assert.equal(await page(), "page-2", "a newer source stamp serves the re-rendered page");
	assert.equal(await page(), "page-2");
	assert.equal(renders, 2, "a newer stamp renders once, then caches");
}

// concurrent requests during a re-render share one render
{
	let renders = 0;
	const page = livePage(() => 100, async () => {
		renders++;
		await new Promise((done) => setTimeout(done, 10));
		return `page-${renders}`;
	});
	const [a, b] = await Promise.all([page(), page()]);
	assert.equal(renders, 1, "two requests during a re-render render once");
	assert.equal(a, "page-1");
	assert.equal(b, "page-1", "both requests get the rendered page");
}

// a render that throws is not cached, so the next request retries
{
	let renders = 0;
	let broken = true;
	const page = livePage(() => 100, () => {
		renders++;
		if (broken) throw new Error("broken source");
		return `page-${renders}`;
	});
	await assert.rejects(page(), /broken source/);
	broken = false;
	assert.equal(await page(), "page-2", "a failed render is retried on the next request");
}

console.log("page-source.test.ts: all assertions passed");
