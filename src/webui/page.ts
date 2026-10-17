import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIORITY_RANK } from "../kanban.ts";
import { esc, inline, logFixups, md } from "./logpane.ts";
import { agentLabel, agentRowSig, agentStatsText, applyCardStats, buildShell, cardBaseHtml, cardHtml, curve, doctorCol, flipDiff, fmtDur, fmtTokens, LAYOUT, makeStatsQueue, mergeCardStats, numLinkHtml, relationPaths, sortedCol, spinnerHtml, statsKey, syncAgentStats, syncBoard, syncCardStats, syncDoctorCards, syncStatsLine, taskStats, taskStatsText } from "./board.ts";

// the served page: PAGE interpolates the tested renderers and helpers as client source; the
// webui config loader and the per-tab client state helpers live here too
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 4242;

export interface WebUiConfig {
	enabled: boolean;
	host: string;
	port: number;
}

// se-llm-team.json: the neutral config dir first (XDG when set, else ~/.config/se-llm-team),
// the legacy pi path is a read-only fallback when the neutral file is absent; project
// .kanban/se-llm-team.json overrides both; a missing file, invalid JSON or absent keys mean off
export function loadWebUiConfig(root?: string): WebUiConfig {
	const home = process.env.HOME ?? "";
	const neutral = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "se-llm-team", "se-llm-team.json");
	const paths = [existsSync(neutral) ? neutral : join(home, ".pi", "agent", "se-llm-team.json")];
	if (root) paths.push(join(root, ".kanban", "se-llm-team.json"));
	let webUi: { enabled?: boolean; host?: string; port?: number } | undefined;
	for (const path of paths) {
		try {
			webUi = JSON.parse(readFileSync(path, "utf8")).webUi ?? webUi;
		} catch {
			// missing file or invalid JSON
		}
	}
	return { enabled: webUi?.enabled === true, host: webUi?.host ?? DEFAULT_HOST, port: webUi?.port ?? DEFAULT_PORT };
}

// tab descriptors from the hub's /api/projects entries: one tab per registered project, and none for a
// single project, so a single-project setup (or the single-project server, whose /api/projects is
// a 404) keeps the old single-board ui. The identity is the entry's root, unique per checkout, so
// two same-named checkouts select their own boards; a name registered more than once appends the
// branch to the label ("" on a detached HEAD keeps the plain name)
export function tabNames(projects) {
	if (projects.length < 2) return [];
	const seen = Object.create(null); // a repo basename can collide with Object.prototype keys
	for (const p of projects) seen[p.name] = (seen[p.name] ?? 0) + 1;
	return projects.map((p) => ({
		id: p.root,
		label: seen[p.name] > 1 && p.branch ? p.name + " (" + p.branch + ")" : p.name,
	}));
}

// tab bar html: one button per tab, data-project carries the root identity, the active one
// marked; a single project renders no bar
export function tabsHtml(tabs, active) {
	if (tabs.length < 2) return "";
	return tabs
		.map((t) => '<button class="tab' + (t.id === active ? " active" : "") + '" data-project="' + esc(t.id) + '">' + esc(t.label) + "</button>")
		.join("");
}

// per-project client state: each tab keeps its payload and its fold choices, so a tab switch
// renders cached data with no flash and a poll of one project never clobbers another
export function boardOf(boards, name) {
	return (boards[name] ??= { tasks: [], expanded: new Set() });
}

// one poll cycle into the per-project state: each payload lands under its own project name, and a
// null payload (project vanished or its fetch failed) keeps that tab's previous data
export function mergeBoards(boards, rows) {
	for (const [name, tasks] of rows) if (tasks) boardOf(boards, name).tasks = tasks;
}

// the open detail card's poll cadence (000142): a live agent's or live doctor's tokens and
// duration advance with the run log, so while the open task has one the poll ticks at 1 s;
// otherwise the 5 s board poll
export function refreshMs(t) {
	return t && ((t.agents || []).some((a) => a.alive) || (t.doctors || []).some((d) => d.alive)) ? 1000 : 5000;
}

// Ayu Dark palette (ayu-theme/ayu-colors), written once and applied twice: explicit choice via data-theme, browser default via media query
const DARK_VARS = `
:root[data-theme="dark"] { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
/* 000129: medium/critical hues widened (yellow / strong red) so the priority chips read apart; -bg tints match their fg */
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252;
/* 000226: the doctor card's blue, the dark pair */
--doctor-fg: #59a7ff; --doctor-bg-strong: rgba(89, 167, 255, .28); }
:root[data-theme="dark"] #theme { color: var(--link); border-color: var(--link); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #10141c; --fg: #bfbdb6; --panel: #141821; --border: #1b1f29; --heading: #bfbdb6; --muted: #5a6673; --faint: #5a6673; --soft: #bfbdb6; --hover: #1b1f29; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102; --link: #e6b450;
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252;
/* 000226: the doctor card's blue, the dark pair */
--doctor-fg: #59a7ff; --doctor-bg-strong: rgba(89, 167, 255, .28); }
:root:not([data-theme="light"]) #theme { color: var(--link); border-color: var(--link); } }
`;

// served by the single-project server and by the hub for every registered project; the tab bar
// comes from the hub's /api/projects and each tab polls /api/tasks?project=<root id>
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Software Engineering LLM Team</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
/* Ayu Light palette (ayu-theme/ayu-colors); 000129: medium moved to a deeper yellow so the priority chips read apart */
:root { --bg: #fcfcfc; --fg: #5c6166; --panel: #ffffff; --border: rgba(107, 125, 143, .12); --heading: #5c6166; --muted: #adaeb1; --faint: #adaeb1; --soft: #5c6166; --hover: rgba(233, 237, 242, .95); --overlay: rgba(15, 23, 42, .45); --code-bg: #ebeef0; --link: #f29718;
--low-bg: rgba(134, 179, 0, .15); --low-fg: #86b300; --medium-bg: rgba(201, 151, 0, .15); --medium-fg: #c99700; --high-bg: rgba(250, 133, 50, .15); --high-fg: #fa8532; --critical-bg: rgba(230, 80, 80, .15); --critical-fg: #e65050;
/* 000191: motion knobs, one place to retune the entrances, the chunk fade and the pulse loop; 000194: --exit runs the closes, --shine is the whiter band mix */
--enter: 200ms; --exit: 180ms; --fade: 150ms; --pulse: 2s; --shine: 45%;
/* 000226: the doctor card's blue, the light pair */
--doctor-fg: #2f6fdd; --doctor-bg-strong: rgba(47, 111, 221, .24); }
${DARK_VARS}
html, body { height: 100%; }
body { display: flex; flex-direction: column; margin: 0; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
/* 000147: buttons inherit the page font instead of the UA Arial default */
button { font-family: inherit; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; background: var(--code-bg); }
h1 { font-size: 1.125rem; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.875rem; }
#theme:hover { background: var(--hover); }
#updated { font-size: 0.875rem; color: var(--muted); }
/* 000165: the serving hub's identity, hidden until the first /api/hub answer fills it */
#hub { padding: 2px 18px 8px; font-size: 0.8125rem; color: var(--muted); }
#hub:empty { display: none; }
/* 000091: a relative #tabs at z-index 1 keeps the bar above the overlay and clickable while a modal is open; 000119: #modal must sit above #tabs and #relations (both z-index 1) or the relation lines paint over it; 000124: the task cards stack at z-index 2, so #modal bumps to 3 */
#tabs { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 18px 0; }
#tabs:empty { display: none; }
.tab { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px 6px 0 0; padding: 4px 12px; font-size: 0.875rem; cursor: pointer; }
.tab:hover { background: var(--hover); }
.tab.active { border-color: var(--link); color: var(--link); }
#board { flex: 1 1 auto; min-height: 0; display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; position: relative; }
/* relation lines: absolute in the relative board, so the overlay scrolls with the content; z-index 1
paints them above the static .col/.pair containers and below the z-index-2 task cards, pointer-events
none so the card clicks pass through */
#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
/* 000127: the low opacity keeps the lines a subtle hint behind the semi-transparent cards; hovering either connected card raises it (.relations-hot) */
#relations path { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; }
#relations path.relations-hot { stroke-opacity: .8; }
@keyframes dashflow { to { stroke-dashoffset: -10; } }
/* 000047: the middle columns stack as pairs, sized and gapped like the single columns */
.pair { display: flex; flex-direction: column; gap: 10px; min-width: 300px; flex: 1 0 300px; }
.col { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; border-top: 3px solid var(--ac); padding: 10px; min-width: 300px; flex: 1 0 300px; }
/* 000096: as a .pair child the .col basis would act on the height axis and floor it at 300px */
.pair .col { flex: 0 0 auto; }
.col h2 { font-size: 0.875rem; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; color: var(--heading); }
.count { color: var(--faint); }
/* 000124: positioned above the z-index-1 relation lines; the semi-transparent background lets a line passing under the card show through faintly (no --card var, --panel is the card's base color in both themes) */
.card { position: relative; z-index: 2; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--border); border-left: 3px solid var(--ac); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: color-mix(in srgb, var(--hover) 85%, transparent); }
/* 000191: genuinely new cards fade and rise in once at insertion; syncBoard adds .enter only at
creation and the page drops it on animationend, so a poll or a reorder never replays it */
.card.enter { animation: cardIn var(--enter) ease-out; }
@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }
.name { font-size: 0.9375rem; line-height: 1.35; margin-bottom: 6px; }
.num { color: var(--faint); margin-right: 4px; }
.num-link { color: var(--link); cursor: pointer; }
.num-link:hover { text-decoration: underline; }
.spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid var(--border); border-top-color: var(--fg); border-radius: 50%; vertical-align: -1px; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } #relations path, #agent-relations path { animation: none; } }
.chip { font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; background: var(--border); color: var(--soft); }
.chip.issuer { background: var(--code-bg); color: var(--muted); }
.chip.cx { background: var(--code-bg); color: var(--muted); }
.issued { color: var(--muted); }
.card-stats { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 6px; animation: statsIn var(--fade) ease-out; }
/* 000264: lazily-fetched stats fade in when the span joins (syncCardStats); the height shift glides via the FLIP diff */
@keyframes statsIn { from { opacity: 0; transform: translateY(2px); } }
.p-low { background: var(--low-bg); color: var(--low-fg); }
.p-medium { background: var(--medium-bg); color: var(--medium-fg); }
.p-high { background: var(--high-bg); color: var(--high-fg); }
.p-critical { background: var(--critical-bg); color: var(--critical-fg); }
/* 000129: per-value complexity chips reuse the priority palette; .chip.cx above stays as the fallback for an unknown value */
/* 000143: calm blue-grey tint with the theme foreground, readable in both themes */
.chip.cx-trivial { background: rgba(100, 130, 165, .18); color: var(--fg); }
.chip.cx-simple { background: var(--low-bg); color: var(--low-fg); }
.chip.cx-moderate { background: var(--medium-bg); color: var(--medium-fg); }
.chip.cx-complex { background: var(--critical-bg); color: var(--critical-fg); }
.empty { font-size: 0.875rem; color: var(--faint); }
.toggle { display: block; width: 100%; margin-top: 2px; border: 1px solid var(--border); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.875rem; }
.toggle:hover { background: var(--hover); }
/* 000120: each run as a card, its subagent cards stacked below it in the same column;
   000238: the main view card's translucent rest background lets the relation lines show through
   faintly, hover and active keep their own looks */
.agent-card { display: block; border: 1px solid var(--border); background: color-mix(in srgb, var(--panel) 85%, transparent); color: var(--link); border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 0.875rem; text-align: left; position: relative; z-index: 2; }
.agent-card:hover { background: var(--hover); }
/* 000191: a genuinely new run card rises in with the board cards' entrance */
.agent-card.enter { animation: cardIn var(--enter) ease-out; }
.agent-card-active { border-color: var(--link); background: color-mix(in srgb, var(--link) 20%, var(--panel)); }
.agent-dead { color: var(--critical-fg); }
.agent-stats { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
.agent-col { display: flex; flex-direction: column; gap: 4px; }
.agent-subs { display: flex; flex-direction: column; gap: 4px; }
.agent-subs:empty { display: none; }
#m-agent-btns { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
#m-doctor { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-top: 8px; }
#m-doctor:empty { display: none; }
/* 000226: the doctor cards read blue in both themes, scoped to the .agent-doctor marker so the
run buttons and the sub cards keep the link gold; 000230: the marker covers the cards in their
analysed run's column and in the residual #m-doctor row alike; 000232: at rest only the text and
check mark stay blue and the plain .agent-card outline and panel background show through, while
the opened card keeps the blue outline and highlight via .agent-card-active */
.agent-doctor { color: var(--doctor-fg); }
.agent-doctor.agent-card-active { border-color: var(--doctor-fg); background: color-mix(in srgb, var(--doctor-fg) 20%, var(--panel)); }
.agent-doctor .check { color: var(--doctor-fg); }
/* 000247: the splitter cards read the same blue as the doctor cards */
.agent-splitter { color: var(--doctor-fg); }
.agent-splitter.agent-card-active { border-color: var(--doctor-fg); background: color-mix(in srgb, var(--doctor-fg) 20%, var(--panel)); }
.agent-splitter .check { color: var(--doctor-fg); }
.check { color: var(--low-fg); margin-right: 5px; }
.cross { color: var(--critical-fg); margin-right: 5px; }
#m-agent { position: relative; z-index: 0; margin-bottom: 12px; }
/* 000237: the detail card's relation lines, behind the cards: the agent area is the svg's offset
parent and its own stacking context (z-index 0), so the z-index-2 agent cards stay under the
sticky #m-head while the svg (z-index 1) paints under them; pointer-events none lets the card
clicks through, the canvas fills the area, the paths carry the geometry */
#agent-relations { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; }
#agent-relations path { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; }
#agent-relations path.relations-hot, #agent-relations path.relations-sel { stroke-opacity: .8; }
/* 000152: the pane grows to 70vh so long logs show more content */
#m-log { margin-top: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--code-bg); max-height: 70vh; overflow: auto; }
#m-log.hidden { display: none; }
/* 000191: the pane fades and rises on open */
#m-log:not(.hidden) { animation: logIn var(--enter) ease-out; }
@keyframes logIn { from { opacity: 0; transform: translateY(4px); } }
/* 000194: the matching close, after the entrance rule so the equal-specificity logOut wins */
#m-log.closing { animation: logOut var(--exit) ease-in forwards; }
@keyframes logOut { to { opacity: 0; transform: translateY(4px); } }
#m-log-meta { padding: 6px 10px 0; font-size: 0.75rem; line-height: 1.45; color: var(--muted); }
#m-log-meta.hidden { display: none; }
/* the log text renders in the page's Inter stack; 000152: the size matches the card body text, only the line-height stays tuned for logs; blocks are collapsed <details> the client fills in */
#m-log-text { margin: 0; padding: 8px 10px; font-size: 0.9375rem; line-height: 1.45; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text details { margin: 2px 0; }
#m-log-text summary { cursor: pointer; }
#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--muted); }
#m-log-text details > pre { padding-left: 12px; }
/* 000191: appended chunks fade and rise in; a CSS animation replays only on newly inserted
nodes, so untouched siblings never re-animate and only new content moves */
#m-log-text > * { animation: chunkIn var(--fade) ease-out; }
@keyframes chunkIn { from { opacity: 0; transform: translateY(2px); } }
/* 000194: the pulse brightens only the glyphs: background-clip: text clips the gradient to the
block's text, the nested pre and summary children included, and color: transparent hides the box,
so the band passing reads as letters brightening, never a highlight bar; the details.pulse
selectors outrank the muted color rule (color: transparent must stick there) and --shine-base
follows the block's own color; 000198: flat shoulders (base 0-33% and 67-100%) so the 300%
window sits on flat base at both loop endpoints, no partial-bright tail at the wrap */
#m-log-text > .pulse, #m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { --shine-base: var(--fg); background-image: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, #fff var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%); background-size: 300% 100%; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; color: transparent; animation: chunkIn var(--fade) ease-out, shimmer var(--pulse) linear infinite; }
#m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { --shine-base: var(--muted); }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
#modal { position: fixed; inset: 0; z-index: 3; background: var(--overlay); display: flex; align-items: center; justify-content: center; }
#modal.hidden { display: none; }
/* 000191: the overlay fades and the panel rises slightly on open, and the refresh never replays
it (the class list is untouched while the card stays open) */
#modal:not(.hidden) { animation: fadeIn var(--enter) ease-out; }
#modal:not(.hidden) #m-box { animation: boxIn var(--enter) ease-out; }
@keyframes fadeIn { from { opacity: 0; } }
@keyframes boxIn { from { opacity: 0; transform: translateY(6px) scale(.985); } }
/* 000194: the exits run the entrances in reverse; .closing sits after the entrance rules so the
equal-specificity close animation wins, the JS drops .closing and hides on animationend with a
fixed-timeout fallback */
#modal.closing { animation: fadeOut var(--exit) ease-in forwards; }
#modal.closing #m-box { animation: boxOut var(--exit) ease-in forwards; }
@keyframes fadeOut { to { opacity: 0; } }
@keyframes boxOut { to { opacity: 0; transform: translateY(6px) scale(.985); } }
/* 000191: reduced motion stops the entrance, chunk and pulse animations too; the rule sits
after every base animation rule so the later equal-specificity selectors cannot override it;
000194: the details.pulse variants join it, only they outrank #m-log-text > * and .pulse */
@media (prefers-reduced-motion: reduce) { .card.enter, .agent-card.enter, .card-stats, #modal:not(.hidden), #modal:not(.hidden) #m-box, #m-log:not(.hidden), #m-log-text > *, #m-log-text > .pulse, #m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { animation: none; } }
/* 000194: under reduced motion the clip animation stops (above) and color: transparent would
make the text vanish: the gradient drops and the solid color restores per block type */
@media (prefers-reduced-motion: reduce) { #m-log-text > .pulse { background-image: none; color: var(--fg); } #m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { background-image: none; color: var(--muted); } }
/* 206/207: the close header is sticky at every width, mobile and desktop: sticky is clamped to the
containing block, so #m-box drops its top padding and #m-head carries it (else the header pins 18px
down and scrolled text peeks above it); its own bottom padding keeps 10px clearance under the title
while content scrolls */
#m-box { background: var(--panel); border-radius: 10px; padding: 0 18px 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow: auto; }
/* 000246: the detail arrival grows the modal from the loading height pinned by openTask to the
content height; the class drops at the transition end, and reduced motion keeps the instant resize */
#m-box.grow { transition: height var(--enter) ease-out; }
@media (prefers-reduced-motion: reduce) { #m-box.grow { transition: none; } }
#m-head { display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; margin-bottom: 0; padding: 18px 0 10px; background: var(--panel); z-index: 1; }
#m-head h2 { font-size: 1.0625rem; margin: 0; }
#m-close { border: 1px solid var(--border); background: var(--panel); color: var(--fg); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 0.875rem; }
#m-close:hover { background: var(--hover); }
#m-attrs { font-size: 0.875rem; color: var(--soft); margin-bottom: 12px; }
#m-attrs div { padding: 3px 0; }
#m-attrs span:not(.chip):not(.num-link) { display: inline-block; min-width: 80px; color: var(--faint); }
#m-body { font-size: 0.9375rem; line-height: 1.5; }
#m-body h1, #m-body h2, #m-body h3 { font-size: 0.9375rem; margin: 12px 0 4px; }
#m-body ul { margin: 4px 0; padding-left: 20px; }
#m-body pre { background: var(--code-bg); border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 0.875rem; }
#m-body code { background: var(--code-bg); border-radius: 4px; padding: 0 4px; font-size: 0.875rem; }
#m-body pre code { padding: 0; background: none; }
/* 000153: only inline and fenced code render monospace; the Thinking prose and the tool args/output pres are not code, so the bare #m-log-text pre stays outside this selector and inherits the Inter page font */
#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
#m-body a { color: var(--link); }
/* one accent color per column, in pipeline order */
.c-backlog { --ac: #94a3b8; }
.c-to-do { --ac: #60a5fa; }
.c-doing { --ac: #818cf8; }
.c-to-review { --ac: #f59e0b; }
.c-reviewing { --ac: #d97706; }
.c-to-merge { --ac: #d946ef; }
.c-merging { --ac: #c026d3; }
.c-to-live-test { --ac: #14b8a6; }
.c-live-testing { --ac: #0d9488; }
.c-done { --ac: #22c55e; }
/* 204: mobile, the root font size 15% smaller so every rem-based size scales down with it */
@media (max-width: 600px) { html { font-size: 85%; } }
/* 205: mobile, the task details popup is a full-screen sheet, flush with all four sides; the vh
line is the fallback for the dvh line (older mobile browsers), max-height none lifts the 82vh cap */
@media (max-width: 600px) { #m-box { width: 100vw; margin: 0; border-radius: 0; height: 100vh; height: 100dvh; max-height: none; } }
</style>
</head>
<body>
<header><h1>Software Engineering LLM Team</h1><span id="updated"></span><button id="theme" onclick="toggleTheme()">Dark</button></header>
<nav id="tabs"></nav>
<main id="board"></main>
<footer id="hub"></footer>
<div id="modal" class="hidden"><div id="m-box">
<div id="m-head"><h2 id="m-title"></h2><button id="m-close" onclick="closeModal()">Close</button></div>
<div id="m-attrs"></div>
<div id="m-agent"><svg id="agent-relations"></svg><div id="m-agent-btns"></div><div id="m-doctor"></div><div id="m-log-meta" class="hidden"></div><div id="m-log" class="hidden"><div id="m-log-text"></div></div></div>
<div id="m-body"></div>
</div></div>
<script>
"use strict";
const VISIBLE = 5;
let projects = [{ id: "", label: "" }]; // one tab per registered project; id "" is the single-project ui, one board, no tabs
let active = ""; // the active tab's id: a registry root, or "" for the single-project board
const boards = Object.create(null);
const esc = ${esc};
const rootEl = document.documentElement;
const storeTheme = t => { try { localStorage.setItem("theme", t); } catch {} };
function syncThemeBtn() { document.getElementById("theme").textContent = (rootEl.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "Light" : "Dark"; }
function toggleTheme() {
	const next = (rootEl.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark";
	rootEl.dataset.theme = next;
	storeTheme(next);
	syncThemeBtn();
}
try { const stored = localStorage.getItem("theme"); if (stored === "dark" || stored === "light") rootEl.dataset.theme = stored; } catch {}
syncThemeBtn();
const inline = ${inline};
${md}
// FLIP across a refresh: measure old positions, sync the cards, invert, play. Every card whose
// board-content position changed moves, the siblings shifting when a card enters or leaves a
// column included; positions are board-content relative, so a scrolled refresh animates nothing.
${flipDiff}
${curve}
${relationPaths}
// board layout and the card pass, interpolated as source so the client runs the tested code;
// constants go in as values, the functions as source
const LAYOUT = ${JSON.stringify(LAYOUT)};
const PRIORITY_RANK = ${JSON.stringify(PRIORITY_RANK)};
${spinnerHtml}
${numLinkHtml}
${cardBaseHtml}
${cardHtml}
${buildShell}
${sortedCol}
${syncBoard}
${logFixups}
${tabNames}
${tabsHtml}
${boardOf}
${mergeBoards}
${agentLabel}
${fmtTokens}
${fmtDur}
${agentStatsText}
${taskStats}
${taskStatsText}
${agentRowSig}
${syncAgentStats}
${syncStatsLine}
${doctorCol}
${syncDoctorCards}
${syncCardStats}
${statsKey}
${applyCardStats}
${mergeCardStats}
${makeStatsQueue}
${refreshMs}
// tabs: one per registered project, the active one renders that project's board
function renderTabs() {
	const el = document.getElementById("tabs");
	const html = tabsHtml(projects, active);
	if (el.innerHTML !== html) el.innerHTML = html;
	for (const b of el.querySelectorAll(".tab")) b.onclick = () => switchTab(b.dataset.project);
}
function switchTab(name) {
	if (name === active) return;
	active = name;
	closeModal();
	render(true); // no FLIP across boards: positions belong to the project just left
}
function activeBoard() { return boardOf(boards, active); }
// fold choice keyed by state name, so the 5 s refresh keeps it
function toggleCol(st) { const b = activeBoard(); if (b.expanded.has(st)) b.expanded.delete(st); else b.expanded.add(st); render(); if (b.expanded.has(st)) queueStats(st); }
// 000271: the lazy stats queue, one file per request in each column's top-to-bottom board order,
// drained off the click/render path; the queue dedupes on the fetched-or-in-flight keys (a
// successful file stays fetched) and skips done cards with known stats. A failed fetch drops its
// key, so the next poll's re-enqueue retries it; each response merges and re-renders
const statsQueue = makeStatsQueue(
	statsKey,
	(project, file) => fetch("/api/card-stats?files=" + encodeURIComponent(file) + (project ? "&project=" + encodeURIComponent(project) : "")).then(r => r.ok ? r.json() : null).catch(() => null),
	(project, stats) => { mergeCardStats(stats, boardOf(boards, project).tasks, statsKnown, localStorage, project); render(); },
);
function queueStats(st) { const b = activeBoard(); statsQueue.enqueueCol(active, b.tasks, st, VISIBLE); }
function queueExpanded() { const b = activeBoard(); for (const st of b.expanded) queueStats(st); }
// one element per task file, kept across refreshes: an unchanged card keeps its node, so its
// spinner animation and in-flight FLIP transform are never restarted
const cardEls = new Map();
let cols = null;
// 000264: the lazily-known card stats, keyed per project and task (statsKey)
const statsKnown = Object.create(null);
function makeCard(file) {
	const el = document.createElement("div");
	el.className = "card";
	el.dataset.file = file;
	el.onclick = () => openTask(file);
	el.onmouseenter = () => hotRelations(file, true);
	el.onmouseleave = () => hotRelations(file, false);
	// 000191: the entrance class is one-shot, dropped on animationend so a later poll or reorder
	// never replays it
	el.onanimationend = () => { el.classList.remove("enter"); el.onanimationend = null; };
	return el;
}
// board-content relative: page scroll cancels, board scroll is added back, so a refresh after
// scrolling measures identical positions and animates nothing; w/h feed the relation geometry
function cardBox(el) {
	const board = document.getElementById("board");
	const boardRect = board.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	return { x: r.left - boardRect.left + board.scrollLeft, y: r.top - boardRect.top + board.scrollTop, w: r.width, h: r.height };
}
// hovering a card raises the opacity of the lines it connects to, in and out, mouseleave reverts
// (000127, 000144); the paths carry both endpoint files as data, so the match needs no selector
// interpolation
function hotRelations(file, on) {
	for (const p of document.querySelectorAll("#relations path")) {
		if (p.dataset.file === file || p.dataset.blocker === file) p.classList.toggle("relations-hot", on);
	}
}
// one dashed curve per drawn relation, sized to the rendered card extent (+ the loop bulge);
// rewritten only on change, so the dash animation keeps running across refreshes
function drawRelations() {
	const board = document.getElementById("board");
	const svg = document.getElementById("relations");
	if (!svg || !cols) return;
	let w = 0, h = 0;
	const rectOf = file => {
		const el = cardEls.get(file);
		if (!el) return null;
		const r = cardBox(el);
		w = Math.max(w, r.x + r.w);
		h = Math.max(h, r.y + r.h);
		return r;
	};
	const paths = relationPaths(activeBoard().tasks, rectOf);
	svg.setAttribute("width", w + 40);
	svg.setAttribute("height", h);
	const html = paths.map(p => '<path d="' + p.d + '" data-file="' + esc(p.file) + '" data-blocker="' + esc(p.blocker) + '"/>').join("");
	if (svg.__html !== html) { svg.innerHTML = html; svg.__html = html; }
}
function render(skipFlip) {
	renderTabs();
	const tab = activeBoard();
	const board = document.getElementById("board");
	if (!cols) {
		cols = buildShell(board, document);
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.id = "relations";
		svg.setAttribute("pointer-events", "none");
		board.insertBefore(svg, board.firstChild);
		for (const st in cols) cols[st].toggle.onclick = () => toggleCol(st);
		window.addEventListener("resize", drawRelations);
	}
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const old = {};
	if (!skipFlip) for (const el of cardEls.values()) {
		el.style.transition = "none";
		el.style.transform = "";
		old[el.dataset.file] = cardBox(el);
	}
	// 000264: the lazily-known stats land on the rows before the board pass, so the 5 s poll's
	// agent-less cards 6+ never wipe revealed stats; the payload's eager first-5 agents win
	applyCardStats(tab.tasks, statsKnown, localStorage, active);
	syncBoard(cols, tab.tasks, tab.expanded, cardEls, makeCard, VISIBLE, document);
	const now = {};
	for (const el of cardEls.values()) now[el.dataset.file] = cardBox(el);
	const diff = flipDiff(old, now);
	drawRelations(); // settled positions; transitionend redraws after a FLIP settles
	for (const el of cardEls.values()) {
		const d = diff[el.dataset.file];
		if (!d || reduced) continue;
		el.style.transition = "none";
		el.style.transform = "translate(" + d.dx + "px," + d.dy + "px)";
		el.getBoundingClientRect();
		el.style.transition = "transform .4s ease";
		el.style.transform = "";
		el.ontransitionend = () => { el.style.transition = ""; el.ontransitionend = null; drawRelations(); };
	}
}
// the title and attrs block: stateless markup, rewritten freely on open and on every refresh
function writeHead(t) {
	document.getElementById("m-title").textContent = t.name;
	document.getElementById("m-attrs").innerHTML = attrsHtml(t);
	for (const a of document.querySelectorAll("#m-attrs .num-link")) a.onclick = () => openTask(a.dataset.task);
}
// the attrs rows, shared by openTask and the 5 s refresh of the open card
function attrsHtml(t) {
	return "<div><span>number</span>" + numLinkHtml(t.file) + "</div>" +
		"<div><span>file</span>" + esc(t.file) + "</div>" +
		"<div><span>priority</span><span class='chip p-" + esc(t.priority) + "'>" + esc(t.priority) + "</span></div>" +
		"<div><span>complexity</span><span class='chip cx cx-" + esc(t.complexity || "moderate") + "'>" + esc(t.complexity || "moderate") + "</span></div>" +
		"<div><span>state</span>" + esc(t.state) + "</div>" +
		"<div><span>worktree</span>" + (esc(t.worktree) || "&mdash;") + "</div>" +
		"<div><span>issuer</span>" + issuerCell(t) + "</div>" +
		blockedRow(t);
}
// the body block, html-gated like syncBoard's cards: an unchanged body keeps its DOM node and
// with it the reader's scroll position
function setBody(t) {
	const el = document.getElementById("m-body");
	const html = md(t.body || "");
	if (el.__html === html) return;
	el.innerHTML = html;
	el.__html = html;
}
// 000242: the detail url, the num off the file name and the active tab's project for the hub
const detailUrl = file => "/api/task-detail?num=" + parseInt(file.slice(0, 6), 10) + projectParam();
// 000248: the heavy history url, fetched after the detail's text shows
const historyUrl = file => "/api/task-history?num=" + parseInt(file.slice(0, 6), 10) + projectParam();
// 000242: the light rows carry no body or agent data, so openTask renders the shell from the row
// and loads the heavy detail per task; every open re-fetches (no client-side cache, the 5 s poll
// is the documented upgrade path). 000251: the mounted cards are this task's on a same-task
// reopen, so no upfront agent render clears them: the row clears once only on a task switch,
// the history render keeps mode, and no generation counter lets a poll discard the open's
// response (the modalFile and modal-state checks gate the writes)
function openTask(file) {
	const t = activeBoard().tasks.find(x => x.file === file);
	if (!t) return;
	closeLog();
	const keepCards = modalFile === file;
	modalFile = file;
	openDetail = null;
	writeHead(t);
	if (!keepCards) { renderAgent({}); renderDoctor({}); }
	// the loading placeholder: the heavy blocks fill on the detail's arrival
	const loading = '<div class="empty"><span class="spin"></span>Loading task details…</div>';
	const el = document.getElementById("m-body");
	el.innerHTML = loading;
	el.__html = loading;
	// 000194: a reopen during the close drops .closing first, the pending hide must not re-run
	const modal = document.getElementById("modal");
	// 000251: the response guards check this, a closing modal discards them, a reopen's accepted
	const visible = () => !modal.classList.contains("hidden") && !modal.classList.contains("closing");
	modal.classList.remove("closing");
	modal.classList.remove("hidden");
	// 000209: the reset runs after the un-hide: a scrollTop write while .hidden (display: none) is discarded
	// 000237: the lines draw after the un-hide too (display: none rects read zero) and once more
	// when the entrance settles, since the boxIn transform skews the first measure
	const box = document.getElementById("m-box");
	box.scrollTop = 0;
	// 000246: pin the loading height so the detail arrival can grow the box to the content height;
	// mobile keeps its full-screen sheet (an inline height would beat the media query), and
	// reduced motion still pins but the media query turns the transition off
	clearTimeout(box.__growTimer);
	const grow = !matchMedia("(max-width: 600px)").matches;
	if (grow) {
		box.classList.add("grow");
		box.style.height = box.offsetHeight + "px";
	} else {
		box.classList.remove("grow");
		box.style.height = "";
	}
	box.onanimationend = e => { if (e && e.target === box) { box.onanimationend = null; drawAgentRelations(); } };
	drawAgentRelations();
	fetch(detailUrl(file)).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
		// a superseded open or a closing modal must not write into the new view
		if (modalFile !== file || !visible()) return;
		if (!d) {
			// 000246: no grow on failure, the box returns to its natural height under the error
			box.classList.remove("grow");
			box.style.height = "";
			const html = '<div class="empty">Task details failed to load</div>';
			el.innerHTML = html;
			el.__html = html;
			return;
		}
		openDetail = Object.assign({}, openDetail, d);
		writeHead(d);
		setBody(d);
		markLiveLine();
		drawAgentRelations();
		if (grow) {
			// 000246: the measured content height is the transition target; the fixed timeout
			// mirrors closeAnimated's fallback and restores auto height once the grow settles
			box.style.height = box.scrollHeight + "px";
			clearTimeout(box.__growTimer);
			box.__growTimer = setTimeout(() => { box.style.height = ""; box.classList.remove("grow"); }, 400);
		}
		// 000248: the text is up, the heavy agent/doctor history loads in a follow-up fetch and
		// renders when it arrives (loading state per the run cards' own lifecycle)
		return fetch(historyUrl(file)).then(r => r.ok ? r.json() : null).catch(() => null).then(h => {
			// a superseded open or a closing modal must not write into the new view
			if (modalFile !== file || !visible()) return;
			if (!h) return;
			openDetail = Object.assign({}, openDetail, h);
			renderAgent(h, keepCards);
			renderDoctor(h, keepCards);
			markLiveLine();
			drawAgentRelations();
		});
	});
}
// the 5 s refresh of the open detail card: every block re-derives from the fresh payload with no
// close/reopen; renderAgent's keep mode moves only the stats lines on an unchanged run set and
// leaves the log pane alone, and markLiveLine sweeps the pulse when this refresh drops the dead
// run's .spin
function updateOpenTask(t) {
	writeHead(t);
	renderAgent(t, true);
	renderDoctor(t, true);
	setBody(t);
	markLiveLine();
	drawAgentRelations();
}
// 000194: the shared animated close: .closing runs the entrance in reverse, the element hides on
// animationend with a fixed-timeout fallback (a background tab never fires the event); a reopen
// (openTask/openLog) drops .closing first, so the late event must not re-hide
function closeAnimated(el) {
	if (el.classList.contains("closing")) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.classList.add("hidden"); return; }
	// 000194: a stale fallback from a cancelled close (the reopen dropped .closing) must not cut the next exit
	clearTimeout(el.__closeTimer);
	el.classList.add("closing");
	const hide = e => {
		if (e && e.target !== el) return; // descendant chunkIn/boxIn ends bubble up, only the element's own exit ends the hide
		el.removeEventListener("animationend", hide);
		if (!el.classList.contains("closing")) return;
		el.classList.remove("closing");
		el.classList.add("hidden");
	};
	el.addEventListener("animationend", hide);
	el.__closeTimer = setTimeout(hide, 400);
}
function closeModal() {
	const modal = document.getElementById("modal");
	if (modal.classList.contains("hidden")) return;
	closeLog();
	openDetail = null;
	// 000251: the loaded log text is the heavy part, dropped at close so the tab holds no
	// transcript memory while the detail card is shut; the run cards stay mounted for the reopen
	const text = document.getElementById("m-log-text");
	if (text) text.textContent = "";
	closeAnimated(modal);
}
// a stored "#<num>" ref resolved to its task on the active board: undefined when absent
function taskByNum(ref) {
	return activeBoard().tasks.find(x => parseInt(x.file, 10) === parseInt(ref.replace(/^#/, ""), 10));
}
// the blockedBy row: each stored ref links to its task's card when that task is on the board, and
// the row is dropped when the attribute is absent or empty
function blockedRow(t) {
	const refs = String(t.blockedBy || "").split(",").map(s => s.trim()).filter(Boolean);
	if (!refs.length) return "";
	const items = refs.map(ref => {
		const target = taskByNum(ref);
		return target ? numLinkHtml(target.file) : esc(ref);
	});
	return "<div><span>blockedBy</span>" + items.join(", ") + "</div>";
}
// the issuer row: a task-issued issuer ("#<num>") links to its card when that task is on the
// active board; "user", an absent issuer, or an off-board number stays plain text
function issuerCell(t) {
	const target = t.issuer && t.issuer !== "user" ? taskByNum(t.issuer) : null;
	return target ? numLinkHtml(target.file) : esc(t.issuer || "user");
}
// live agent log pane: each run card carries only its handle, the server resolves the real
// path; each run's subagent transcripts load through the same endpoint with sub=list / sub=n
let modalFile = null;
// 000242: the open task's detail (the heavy per-task payload), fetched on open and re-fetched by
// the poll; 000251: no generation counter, the modalFile and modal-state checks gate the writes
let openDetail = null;
let agentGen = 0; // bumped per renderAgent: a superseded open's sub fetches must not write
let logTimer = null;
let logState = null;
const logPane = () => document.getElementById("m-log");
const projectParam = () => (active ? "&project=" + encodeURIComponent(active) : "");
const logUrl = extra => "?file=" + encodeURIComponent(logState.handle) + (logState.sub == null ? "" : "&sub=" + logState.sub) + extra + projectParam();
function markActiveAgent() {
	const p = logPane();
	const st = logState && p && !p.classList.contains("hidden") ? logState : null;
	let sel = null;
	for (const b of document.querySelectorAll("#m-agent .agent-card")) {
		const active = !!st && b.dataset.handle === st.handle && (b.dataset.sub || null) === (st.sub == null ? null : String(st.sub));
		b.classList.toggle("agent-card-active", active);
		if (active) sel = b.dataset.handle;
	}
	// 000237: the selected card's connected lines stay highlighted while its log is open
	for (const path of document.querySelectorAll("#agent-relations path"))
		path.classList.toggle("relations-sel", !!sel && (path.dataset.from === sel || path.dataset.to === sel));
}
// 000237 hovering a run, sub or doctor card raises the opacity of the lines it connects to, and
// mouseleave reverts; the paths carry both endpoint handles as data, so the match needs no
// selector interpolation (the hotRelations pattern). The hovered handle is tracked so a line
// rewrite landing mid-hover (the entrance settle, a poll rebuild) re-applies the raise
let hoverHandle = null;
function hotAgentRelations(handle, on) {
	hoverHandle = on ? handle : null;
	for (const p of document.querySelectorAll("#agent-relations path"))
		if (p.dataset.from === handle || p.dataset.to === handle) p.classList.toggle("relations-hot", on);
}
// the vertical connector: out of the run card's bottom edge heading down, into the sub or doctor
// card's left side heading right; the horizontal run-in scales with the span (the board sBend
// pattern) and clamps to the space left of the card, so the approach reads perpendicular; a card
// flush with the area's left edge keeps the short hook and loses no visible length to the clip
function dropCurve(from, to) {
	const x1 = from.x + from.w / 2;
	const y1 = from.y + from.h;
	const x2 = to.x;
	const y2 = to.y + to.h / 2;
	const v = Math.max(8, Math.min((y2 - y1) * 0.5, 60));
	const d = Math.max(8, Math.min(Math.abs(x1 - x2) * 0.35, 60, x2));
	return "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 + v) + ", " + (x2 - d) + " " + y2 + ", " + x2 + " " + y2;
}
// 000237 the detail card's relation lines, behind the cards in #m-agent: one dashed connector per
// drawn pair; run cards chain right-out/left-in with the board curve (any x/y pair, so a
// flex-wrap line break stays connected); every sub and doctor card of a run drops from its bottom
// edge into the card's left side, wherever the doctor renders (its run's column or the residual
// #m-doctor row). Rewritten only on change, so the dash animation keeps running across refreshes;
// bails while the modal is hidden: display: none rects read zero and would corrupt the gate
function drawAgentRelations() {
	const svg = document.getElementById("agent-relations");
	const modal = document.getElementById("modal");
	if (!svg || !modal || modal.classList.contains("hidden")) return;
	const host = document.getElementById("m-agent");
	const hostRect = host.getBoundingClientRect();
	const box = el => {
		const r = el.getBoundingClientRect();
		return { x: r.left - hostRect.left + host.scrollLeft, y: r.top - hostRect.top + host.scrollTop, w: r.width, h: r.height };
	};
	const paths = [];
	const runs = [...document.querySelectorAll("#m-agent-btns > .agent-col > .agent-card:not(.agent-doctor)")];
	runs.forEach((run, i) => {
		const from = box(run);
		const next = runs[i + 1];
		if (next) paths.push({ from: run.dataset.handle, to: next.dataset.handle, d: curve(from, box(next), false) });
		const subs = run.parentElement.querySelector(".agent-subs");
		if (subs) for (const sub of subs.querySelectorAll(".agent-card"))
			paths.push({ from: run.dataset.handle, to: sub.dataset.handle, d: dropCurve(from, box(sub)) });
	});
	const byHandle = new Map(runs.map(r => [r.dataset.handle, r]));
	for (const doc of document.querySelectorAll("#m-agent .agent-doctor")) {
		const run = byHandle.get(doc.dataset.handle.replace(/\\.doctor$/, ""));
		if (!run) continue;
		paths.push({ from: run.dataset.handle, to: doc.dataset.handle, d: dropCurve(box(run), box(doc)) });
	}
	const html = paths.map(p => '<path d="' + p.d + '" data-from="' + esc(p.from) + '" data-to="' + esc(p.to) + '"/>').join("");
	if (svg.__html !== html) { svg.innerHTML = html; svg.__html = html; markActiveAgent(); if (hoverHandle) hotAgentRelations(hoverHandle, true); }
}
// 000194: while the viewed run is alive, the shine sits on the LATEST block and only while the
// run is inside one: an open thinking block (data-open) or a tool block still awaiting its result
// pre (tool_execution_start without its end); plain text, closed blocks and idle or dead runs
// leave nothing shining, the same liveness signal the .spin spinner reads
function markLiveLine() {
	// 000242: the light rows carry no agent data, the open detail holds the agent history
	const t = openDetail && openDetail.file === modalFile ? openDetail : null;
	const run = t && (t.agents || []).find(a => a.alive);
	const p = logPane();
	const on = !!run && !!logState && run.handle === logState.handle && !p.classList.contains("hidden");
	const text = document.getElementById("m-log-text");
	let live = null;
	if (on) for (const el of text.children) {
		if (el.classList.contains("lg-think") && el.dataset.open) live = el;
		else if (el.classList.contains("lg-tool") && !el.querySelector("pre.lg-out")) live = el;
	}
	for (const el of text.children) el.classList.toggle("pulse", el === live);
}
const atBottom = () => { const p = logPane(); return p.scrollTop + p.clientHeight >= p.scrollHeight - 4; };
// the live auto-scroll glides to the bottom, an instant auto scroll under reduced motion
function glide(p) {
	const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
	p.scrollTo({ top: p.scrollHeight, behavior: behavior });
}
// the rendered chunk lands in the pane first, then logFixups runs the cross-chunk fixes over it
function ingest(html, where) {
	const el = document.getElementById("m-log-text");
	if (where === "init") el.innerHTML = html;
	else el.insertAdjacentHTML(where === "history" ? "afterbegin" : "beforeend", html);
	logFixups(el, document);
}
// one agent card: the role label, then a tokens/duration stats line (42k · 5m 12s); mark is the
// live spinner or the past check, empty on a sub card
function agentCardHtml(extraCls, attrs, label, tokens, duration, mark) {
	const stats = agentStatsText(tokens, duration);
	return '<button class="agent-card' + (extraCls ? " " + extraCls : "") + '" ' + attrs + ">" + mark + esc(label) + (stats ? '<span class="agent-stats">' + esc(stats) + "</span>" : "") + "</button>";
}
// the agent history as one horizontal row of columns: every run a card with its subagent cards
// stacked below, always visible (fetched for every run on open), oldest leftmost (payload order
// is log mtime order), the live run rightmost; a role with several runs labels them 1-based.
// keep=true is the poll refresh of the open card: an unchanged run set moves only the stats lines
// (syncAgentStats), so the live run's spinner animation survives the poll; a structure change
// rebuilds the row, each run's fetched sub box carried over by handle, and only the live run's
// sub list re-fetched; the log pane beside the row is untouched
function renderAgent(t, keep) {
	const el = document.getElementById("m-agent-btns");
	const runs = (t.agents || []).slice();
	const live = runs.find(a => a.alive);
	if (live) { runs.splice(runs.indexOf(live), 1); runs.push(live); }
	if (!runs.length) { el.innerHTML = ""; el.__sig = ""; return; }
	// the run set is the row's structure: role, run, aliveness, status, handle. Unchanged, the
	// stats lines update in place and the live run's spinner keeps spinning across the poll
	if (keep && syncAgentStats(el, runs, document)) {
		if (live) fetchSubs(agentGen, live, el.querySelector(".agent-col:last-child > .agent-subs"));
		return;
	}
	el.__sig = agentRowSig(runs);
	const oldSubs = keep ? new Map() : null;
	if (oldSubs) for (const c of el.querySelectorAll(".agent-col > .agent-card:not(.agent-doctor)")) oldSubs.set(c.dataset.handle, c.parentElement.querySelector(".agent-subs"));
	// 000251: the doctor cards slotted inside these columns survive the rebuild: lift them out
	// first (the innerHTML write would destroy them) and re-slot after, so the keep pass's
	// parentElement check holds and no doctor card remounts
	const doctorRow = document.getElementById("m-doctor");
	const keepDocs = doctorRow.__cards || [];
	for (const c of keepDocs) c.remove();
	const count = {};
	for (const a of runs) count[a.role] = (count[a.role] || 0) + 1;
	el.innerHTML = runs.map(a =>
		'<div class="agent-col">' +
		agentCardHtml((a.role === "splitter" ? "agent-splitter " : "") + (a.alive ? "agent-live" : a.status === "dead" ? "agent-dead" : "agent-past"), 'data-handle="' + esc(a.handle) + '"', agentLabel(a, count), a.tokens, a.duration, a.alive ? '<span class="spin"></span>' : a.status === "dead" ? '<span class="cross">✗</span>' : '<span class="check">✓</span>') +
		'<div class="agent-subs"></div></div>').join("");
	// bind by dataset: a hand-written task file name can hold quotes or backslashes, which no
	// amount of HTML escaping makes safe inside inline JS; 000191: only a genuinely new run's
	// card animates in, the rebuilt old cards stay still
	for (const b of el.querySelectorAll(".agent-col > .agent-card")) {
		b.onclick = () => openAgentLog(b.dataset.handle);
		b.onmouseenter = () => hotAgentRelations(b.dataset.handle, true);
		b.onmouseleave = () => hotAgentRelations(b.dataset.handle, false);
		if (oldSubs && !oldSubs.has(b.dataset.handle)) b.classList.add("enter");
	}
	if (oldSubs) for (const c of el.querySelectorAll(".agent-col")) {
		const box = oldSubs.get(c.querySelector(".agent-col > .agent-card").dataset.handle);
		if (box) c.querySelector(".agent-subs").replaceWith(box);
	}
	for (const c of keepDocs) (doctorCol(el, c.dataset.handle) ?? doctorRow).appendChild(c);
	markActiveAgent();
	// the live run is the last column, so its sub list is the one re-fetched: a sub spawned after
	// the card was opened surfaces without re-opening, past runs' lists are never re-fetched
	if (keep) {
		// the live run's list re-fetches for freshness; a run whose box carried over nothing (a
		// run added while the card was shut) fetches its list too, past runs' mounted lists stay
		if (live) fetchSubs(agentGen, live, el.querySelector(".agent-col:last-child > .agent-subs"));
		const boxes = el.querySelectorAll(".agent-subs");
		runs.forEach((a, i) => { if (a !== live && !boxes[i].children.length) fetchSubs(agentGen, a, boxes[i]); });
		return;
	}
	// every run's subs on open, in parallel: one sub=list fetch per run handle, each list rendered
	// under its caller column
	const gen = ++agentGen;
	const boxes = el.querySelectorAll(".agent-subs");
	runs.forEach((a, i) => fetchSubs(gen, a, boxes[i]));
}
// the doctor history: one card per analysed run's doctor step, slotted into the analysed run's
// column below the run card (the handle is the run's plus the .doctor suffix), oldest leftmost,
// the live doctor rightmost; cards whose run column is gone keep the residual #m-doctor row.
// keep=true is the poll refresh: an unchanged set moves only the stats lines (syncDoctorCards),
// a structure change rebuilds the cards, only genuinely new ones animate in
function renderDoctor(t, keep) {
	const el = document.getElementById("m-doctor");
	const row = document.getElementById("m-agent-btns");
	const docs = (t.doctors || []).slice();
	const live = docs.find(d => d.alive);
	if (live) { docs.splice(docs.indexOf(live), 1); docs.push(live); }
	const cards = el.__cards || [];
	if (keep && syncDoctorCards(cards, docs, row, el, document)) return;
	el.__sig = agentRowSig(docs);
	// old handles gate the enter animation, taken from __cards because a run-row rebuild may
	// already have detached the slotted cards
	const oldHandles = keep ? new Set(cards.map(c => c.dataset.handle)) : null;
	for (const c of cards) c.remove();
	const count = {};
	for (const d of docs) count[d.role] = (count[d.role] || 0) + 1;
	const tmp = document.createElement("div");
	el.__cards = docs.map(d => {
		tmp.innerHTML = agentCardHtml("agent-doctor " + (d.alive ? "agent-live" : "agent-past"), 'data-handle="' + esc(d.handle) + '"', agentLabel(d, count), d.tokens, d.duration, d.alive ? '<span class="spin"></span>' : '<span class="check">✓</span>');
		const b = tmp.firstChild;
		(doctorCol(row, d.handle) ?? el).appendChild(b);
		b.onclick = () => openAgentLog(b.dataset.handle);
		b.onmouseenter = () => hotAgentRelations(b.dataset.handle, true);
		b.onmouseleave = () => hotAgentRelations(b.dataset.handle, false);
		if (oldHandles && !oldHandles.has(b.dataset.handle)) {
			b.classList.add("enter");
			b.onanimationend = () => { b.classList.remove("enter"); b.onanimationend = null; };
		}
		return b;
	});
	markActiveAgent();
}
// one run's subagent cards, labeled Sub-<caller role> without the id string, one per background
// Agent call in log order
function fetchSubs(gen, a, box) {
	fetch("/api/agent-log?file=" + encodeURIComponent(a.handle) + "&sub=list" + projectParam()).then(r => r.ok ? r.json() : []).then(list => {
		// a superseded open must not write into the new view
		if (gen !== agentGen || !box) return;
		const subs = Array.isArray(list) ? list : [];
		// 000251: the gate keys on the sub set only, so a growing transcript's advancing tokens
		// and duration never rebuild the cards; an unchanged set moves the stats lines in place
		const sig = subs.map(s => s.index).join("|");
		if (box.__sig === sig) {
			const bySub = new Map([...box.querySelectorAll(".agent-card")].map(c => [c.dataset.sub, c]));
			for (const s of subs) {
				const card = bySub.get(String(s.index));
				if (card) syncStatsLine(card, s.tokens, s.duration, document);
			}
			return;
		}
		const prev = box.__sig === undefined ? null : new Set([...box.querySelectorAll(".agent-card")].map((c) => c.dataset.sub));
		box.__sig = sig;
		const html = subs.map(s =>
			agentCardHtml("agent-sub", 'data-handle="' + esc(a.handle) + '" data-sub="' + s.index + '"', "Sub-" + a.role, s.tokens, s.duration, "")).join("");
		box.innerHTML = html;
		for (const b of box.querySelectorAll(".agent-card")) {
			b.onclick = () => openSubLog(b.dataset.handle, Number(b.dataset.sub));
			b.onmouseenter = () => hotAgentRelations(b.dataset.handle, true);
			b.onmouseleave = () => hotAgentRelations(b.dataset.handle, false);
			if (prev && !prev.has(b.dataset.sub)) {
				// same one-shot drop as makeCard: a row rebuild re-attaches the carried-over sub
				// boxes, and a lingering enter class would replay their entrance then
				b.classList.add("enter");
				b.onanimationend = () => { b.classList.remove("enter"); b.onanimationend = null; };
			}
		}
		markActiveAgent();
		drawAgentRelations();
	}).catch(() => {});
}
function openAgentLog(handle) {
	if (logState && logState.handle === handle && logState.sub == null && !logPane().classList.contains("hidden")) { closeLog(); return; }
	openLog(handle, null);
}
function openSubLog(handle, n) {
	if (logState && logState.handle === handle && logState.sub === n && !logPane().classList.contains("hidden")) { closeLog(); return; }
	if (handle) openLog(handle, n);
}
function openLog(handle, sub) {
	const t = activeBoard().tasks.find(x => x.file === modalFile);
	const p = logPane();
	if (!t || !p) return;
	// 000194: a reopen during the close drops .closing first
	p.classList.remove("closing");
	p.classList.remove("hidden");
	// the previous view's meta line must not flash before the init payload arrives
	const meta = document.getElementById("m-log-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	// 000243: the previous agent's log must not stay visible while the new one loads: the pane
	// clears at once, and the loading text stays until the init payload replaces it (a failed
	// fetch leaves it in place, never the previous log)
	const text = document.getElementById("m-log-text");
	if (text) text.textContent = "Loading...";
	logState = { handle, sub: sub == null ? null : sub, head: 0, tail: 0, atStart: false, busy: false, idle: false };
	markActiveAgent();
	pullLog(logUrl(""), "init");
	if (logTimer) clearInterval(logTimer);
	logTimer = setInterval(pollLog, 1000);
}
function closeLog() {
	if (logTimer) { clearInterval(logTimer); logTimer = null; }
	logState = null;
	const p = logPane();
	// 000194: poll and state clear at once, only the visual hide waits for the exit animation
	if (p && !p.classList.contains("hidden")) closeAnimated(p);
	// 000154: the meta line is a sibling above the pane now, so it must hide itself on close
	const meta = document.getElementById("m-log-meta");
	if (meta) { meta.textContent = ""; meta.classList.add("hidden"); }
	markActiveAgent();
	markLiveLine();
}
function pollLog() {
	if (!logState || logState.busy) return;
	const t = openDetail && openDetail.file === modalFile ? openDetail : null;
	const liveRun = t && (t.agents || []).find(a => a.alive);
	// logState carries the parent run's handle for a sub view too, so run aliveness keeps both the
	// run's own log and its sub transcripts polling while the run is alive; a live doctor entry
	// keeps its log polling the same way
	const liveDoctor = t && (t.doctors || []).find(d => d.alive);
	const live = (!!liveRun && liveRun.handle === logState.handle) || (!!liveDoctor && liveDoctor.handle === logState.handle);
	// past agents write no lines: one empty poll is proof, stop the timer
	if (!live && logState.idle) {
		if (logTimer) { clearInterval(logTimer); logTimer = null; }
		markLiveLine(); // the death sweep: a run that died while its log idles drops its pulse here
		return;
	}
	const p = logPane();
	// a scroll-to-top can land in a busy poll window and never re-fire; the tick retries history
	if (p && p.scrollTop === 0 && !logState.atStart) {
		pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
		return;
	}
	pullLog(logUrl("&offset=" + logState.tail), "poll");
}
function pullLog(qs, mode) {
	const st = logState;
	if (!st) return;
	st.busy = true;
	const p = logPane();
	fetch("/api/agent-log" + qs).then(r => r.ok ? r.json() : null).then(d => {
		// a superseded open must not write into the new view
		if (!d || logState !== st || !p || p.classList.contains("hidden")) return;
		// 000146: the meta line above the log, model name and thinking level of the latest
		// usage-bearing record; nulls hide it, every payload mode refreshes it
		const meta = document.getElementById("m-log-meta");
		const label = d.model ? d.model + (d.thinkingLevel ? " \u00b7 thinking " + d.thinkingLevel : "") : "";
		if (meta) { meta.textContent = label; meta.classList.toggle("hidden", !label); }
		const el = document.getElementById("m-log-text");
		if (mode === "history") {
			st.head = d.head;
			st.atStart = d.atStart;
			if (d.text) {
				const before = p.scrollHeight;
				ingest(d.text, "history");
				p.scrollTop += p.scrollHeight - before;
			}
		} else {
			st.tail = d.tail;
			if (mode === "poll") st.idle = !d.text;
			if (mode === "init") {
				st.head = d.head;
				st.atStart = d.atStart;
				ingest(d.text, "init");
				glide(p);
			} else if (d.text) {
				const stick = atBottom();
				ingest(d.text, "poll");
				if (stick) glide(p);
			}
		}
		markLiveLine();
	}).catch(() => {}).finally(() => { if (logState === st) st.busy = false; });
}
document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
// 000194: Esc joins the X button and the overlay click on the same close path
window.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
// 000237: the run columns wrap with the width, the lines follow
window.addEventListener("resize", drawAgentRelations);
// the log pane is static markup: the scroll handler binds once and reads the live logState
const pane = logPane();
pane.onscroll = () => {
	if (!logState || logState.busy || logState.atStart || pane.scrollTop > 0) return;
	pullLog(logUrl("&offset=" + logState.head + "&before=1"), "history");
};
// the serving hub's identity (000165): pid, code checkout and commit; null keeps the last text
function renderHub(info) {
	const el = document.getElementById("hub");
	if (!el || !info) return;
	const text = info.old ? "hub: old hub code (restart needed)" : "hub pid " + info.pid + " \u00b7 " + info.root + (info.commit ? " \u00b7 " + info.commit.slice(0, 7) : "");
	if (el.textContent !== text) el.textContent = text;
}
// 000235: poll bookkeeping for the wake check: the stamp of the last served board, the delay of
// the pending tick, and its handle (cleared before a forced wake cycle)
let pollTimer = null, lastReload = Date.now(), lastDelay = 5000;
function refresh() {
	// the serving hub's identity in the footer (000165): a stale-code hub or a failover shows
	// at a glance; a 404 means old hub code that predates the endpoint (a webui hot reload mix)
	fetch("/api/hub").then(r => r.status === 404 ? { old: true } : r.ok ? r.json() : null).catch(() => null).then(renderHub);
	fetch("/api/projects").then(r => r.ok ? r.json() : null).catch(() => null).then(list => {
		// the single-project server 404s here, and a transient hub failure keeps the last known
		// tabs: only a real projects list replaces them
		if (Array.isArray(list)) {
			const tabs = tabNames(list);
			projects = tabs.length ? tabs : [{ id: "", label: "" }]; // single project: the old ui, one board, no tabs
		}
		// a project that vanished from the registry closes the modal its task lived in
		if (!projects.some(t => t.id === active)) { active = projects[0].id; closeModal(); }
		const url = t => t.id ? "/api/tasks?project=" + encodeURIComponent(t.id) : "/api/tasks";
		// every tab polls every cycle, only the active one renders
		return Promise.all(projects.map(t => fetch(url(t)).then(r => r.ok ? r.json() : null).catch(() => null).then(tasks => [t.id, tasks])));
	}).then(rows => {
		mergeBoards(boards, rows);
		render();
		queueExpanded(); // 000271: each poll re-queues the expanded columns, retrying failed files
		// the open card's task still on the board, else the card closes (000242: the light rows
		// carry no agent data, so the heavy blocks re-derive from the poll's detail re-fetch below)
		let open = null;
		if (modalFile && !document.getElementById("modal").classList.contains("hidden")) {
			open = activeBoard().tasks.find(x => x.file === modalFile);
			if (!open) closeModal();
		}
		// stamp only a served board: during a hub outage the old stamp stays visible
		const current = rows.find(([id]) => id === active);
		if (current && current[1]) {
			document.getElementById("updated").textContent = "updated " + new Date().toLocaleTimeString();
			lastReload = Date.now();
		}
		// the next tick keys on the fresh open card (000142): while it shows a live agent the stats
		// advance at log speed, so the cadence is 1 s; no live agent keeps the 5 s board poll.
		// 000242: the tick first re-fetches the open task's detail (the light rows carry no agent
		// data), then paces on the fresh detail
		if (!open) { lastDelay = 5000; return setTimeout(refresh, 5000); }
		return pollDetail().then(() => {
			lastDelay = refreshMs(openDetail);
			return setTimeout(refresh, refreshMs(openDetail));
		});
	}).catch(() => setTimeout(refresh, 5000)).then(t => { pollTimer = t; }); // a failed cycle retries at the board cadence
}
// 000242: the poll's detail re-fetch for the open card; a failed fetch keeps the last detail, a
// loading modal keeps the placeholder until a cycle succeeds. 000248: the heavy history re-fetch
// chains after the detail, the poll paces on the merged card. 000251: no generation counter, a
// poll cycle never discards a just-opened task's response; the modalFile and modal-state checks
// gate the writes
function pollDetail() {
	const modal = document.getElementById("modal");
	return fetch(detailUrl(modalFile)).then(r => r.ok ? r.json() : null).catch(() => null).then(d => {
		if (!d || modalFile !== d.file) return;
		if (modal.classList.contains("hidden") || modal.classList.contains("closing")) return;
		openDetail = Object.assign({}, openDetail, d);
		writeHead(d);
		setBody(d);
		return fetch(historyUrl(modalFile)).then(r => r.ok ? r.json() : null).catch(() => null).then(h => {
			if (!h || modalFile !== d.file) return;
			if (modal.classList.contains("hidden") || modal.classList.contains("closing")) return;
			openDetail = Object.assign({}, openDetail, h);
			updateOpenTask(openDetail);
		});
	});
}
refresh();
// 000235: a wake past twice the last scheduled cadence means the tab slept; cancel the delayed
// tick and refresh at once, so the "updated" line catches up within a second of the wake
addEventListener("visibilitychange", () => {
	if (document.visibilityState !== "visible" || Date.now() - lastReload <= 2 * lastDelay) return;
	clearTimeout(pollTimer);
	refresh();
});
</script>
</body>
</html>
`;
