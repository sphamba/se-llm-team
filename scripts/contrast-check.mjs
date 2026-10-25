// the design system's contrast floor: every essential text pair and every accent label step
// measures at least 4.5:1 against the surface it renders on, in both theme paths
import assert from "node:assert/strict";
import { CSS } from "../src/webui/theme.ts";

const tokens = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
// the three token blocks: the light :root, the data-theme override and the media-query fallback
const blocks = [...CSS.matchAll(/\{ --canvas: [^}]*\}/g)].map((m) => tokens(m[0]));
assert.equal(blocks.length, 3, "the stylesheet declares three token blocks, one per theme path");
const [light, dark] = blocks;

const chan = (c) => {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
	const n = parseInt(hex.slice(1), 16);
	return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
};
const ratio = (fg, bg) => {
	const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
	return (hi + 0.05) / (lo + 0.05);
};
const FLOOR = 4.5;

const theme = { light, dark };
const pairs = [];
for (const [name, t] of Object.entries(theme)) {
	pairs.push([`${name} --text on --panel`, t["--text"], t["--panel"]]);
	pairs.push([`${name} --text on --canvas`, t["--text"], t["--canvas"]]);
	pairs.push([`${name} --dim on --panel`, t["--dim"], t["--panel"]]);
	for (const key of Object.keys(t)) {
		if (!/^--(accent-[\w-]+|error)-text$/.test(key)) continue;
		pairs.push([`${name} ${key} on --panel`, t[key], t["--panel"]]);
	}
}

const rows = pairs.map(([label, fg, bg]) => {
	assert.match(fg, /^#[0-9a-f]{6}$/, `${label}: ${fg} is a six-digit hex value the check can measure`);
	assert.match(bg, /^#[0-9a-f]{6}$/, `${label}: ${bg} is a six-digit hex value the check can measure`);
	return { label, fg, bg, ratio: ratio(fg, bg) };
});
for (const row of rows) console.log(`${row.ratio.toFixed(2)}:1  ${row.label}  ${row.fg} on ${row.bg}`);
for (const name of Object.keys(theme)) {
	const own = rows.filter((r) => r.label.startsWith(name + " "));
	const worst = own.reduce((a, b) => (b.ratio < a.ratio ? b : a));
	console.log(`\n${name}: ${own.length} pairs, minimum ${worst.ratio.toFixed(2)}:1 (${worst.label})`);
}
const failing = rows.filter((r) => r.ratio < FLOOR);
assert.deepEqual(failing.map((r) => `${r.label} ${r.ratio.toFixed(2)}:1`), [], `every essential pair and accent label step reaches ${FLOOR}:1`);
console.log(`\nall ${rows.length} pairs reach ${FLOOR}:1`);
