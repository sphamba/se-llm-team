import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 000383: the served page is read from the source, not from the boot-time module constant, so a
// merged ui change lands on the next browser reload with no daemon restart.
const DIR = dirname(fileURLToPath(import.meta.url));

// every module the page interpolates or renders from (the font files themselves are immutable:
// their @font-face URLs carry the face name, so only the directory is stamped)
const SOURCES = ["page.ts", "theme.ts", "board.ts", "filters.ts", "logpane.ts", "payload.ts", "fonts"];

// the newest mtime across the webui sources: one stat set per request, no recompile
export function pageStamp(): number {
	let newest = 0;
	for (const name of SOURCES) {
		try {
			newest = Math.max(newest, statSync(join(DIR, name)).mtimeMs);
		} catch {
			/* a source that is gone or unreadable does not pin the page */
		}
	}
	return newest;
}

// A fresh module graph, hence a fresh page. An in-process import() with a cache-busting query
// busts only its own URL: the nested ./theme.ts and ./board.ts imports resolve to the plain
// specifier and stay cached, so a change there would never be re-read (probed on node 24.22).
// Ceiling: a spawned node per source change, never per request; if the spawn cost ever matters,
// a vm.SourceTextModule linker that re-reads each dependency replaces it behind the same seam.
export function renderPage(): string {
	const url = new URL("./page.ts", import.meta.url).href;
	return execFileSync(process.execPath, ["-e", `import(${JSON.stringify(url)}).then((m) => process.stdout.write(m.PAGE))`], {
		encoding: "utf8",
		maxBuffer: 16 << 20,
	});
}

// the stamp cache: a request with the cached stamp serves the page, a newer stamp renders once,
// and a request that arrives during a render awaits it instead of starting a second one. A render
// that throws is not cached, so the next request retries and a broken source answers 500 until
// it is fixed rather than freezing the last good page over it.
export function livePage(stampOf: () => number, render: () => string | Promise<string>): () => Promise<string> {
	let key = Number.NaN;
	let page = "";
	let busy: Promise<string> | null = null;
	return async () => {
		const stamp = stampOf();
		if (stamp === key) return page;
		if (busy) return busy;
		busy = (async () => render())()
			.then((html) => {
				key = stamp;
				page = html;
				return html;
			})
			.finally(() => {
				busy = null;
			});
		return busy;
	};
}

export const servedPage = livePage(pageStamp, renderPage);
