// the served stylesheet and its palette, split out of PAGE so a redesign task edits one block

import { STATIONS } from "./board.ts";

// Space Grotesk carries the prose and the labels; IBM Plex Mono the numbers, the log and the code
const SANS = `"Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

// the Ink black dark palette, written once and applied twice: explicit choice via data-theme, browser default via media query; the token names match the light :root block one for one
const DARK_TOKENS = `--canvas: #05080a; --panel: #0b1118; --raised: #111a24; --hairline: #18222e; --text: #b3b1aa; --dim: #75808e; --faint: #4d5866; --link: #e6b450;
/* 000129: medium/critical hues widened (yellow / strong red) so the priority chips read apart; -bg tints match their fg */
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252;
--cx-trivial-bg: rgba(100, 130, 165, .18); --shine-hi: #ffffff; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102;
--accent-backlog: #5a6378; --accent-backlog-text: #74818f; --accent-todo: #ffb454; --accent-todo-text: #ffb454; --accent-review: #ff8f40; --accent-review-text: #ff8f40; --accent-merge: #d2a6ff; --accent-merge-text: #d2a6ff; --accent-live: #59c2ff; --accent-live-text: #59c2ff; --accent-integration: #95e6cb; --accent-integration-text: #95e6cb; --accent-done: #aad94c; --accent-done-text: #aad94c; --error: #ff5252; --error-text: #ff5252;`;
const darkBlock = (selector: string) => `${selector} { ${DARK_TOKENS} }`;
const themeButton = (selector: string) => `${selector} #theme { color: var(--link); border-color: var(--link); }`;
const DARK_VARS = `
${darkBlock(':root[data-theme="dark"]')}
${themeButton(':root[data-theme="dark"]')}
@media (prefers-color-scheme: dark) { ${darkBlock(':root:not([data-theme="light"])')}
${themeButton(':root:not([data-theme="light"])')} }
`;

export const CSS = `* { box-sizing: border-box; }
/* Ayu Light retuned for contrast: the same token names as the dark blocks, the -dim and -text steps carry the 4.5:1 floor */
:root { --canvas: #fcfcfc; --panel: #ffffff; --raised: #f6f8fa; --hairline: rgba(107, 125, 143, .15); --text: #5c6166; --dim: #6f7478; --faint: #b8bbbf; --link: #f29718;
--low-bg: rgba(134, 179, 0, .15); --low-fg: #86b300; --medium-bg: rgba(201, 151, 0, .15); --medium-fg: #c99700; --high-bg: rgba(250, 133, 50, .15); --high-fg: #fa8532; --critical-bg: rgba(230, 80, 80, .15); --critical-fg: #e65050;
--cx-trivial-bg: rgba(100, 130, 165, .18); --shine-hi: #ffffff; --overlay: rgba(15, 23, 42, .45); --code-bg: #ebeef0;
/* 000353: one accent per pipeline stage and agent role, plus the failed-run red; the -text step is the darker Ayu Light ladder step that keeps a label readable on the light panel */
--accent-backlog: #828e9f; --accent-backlog-text: #74757a; --accent-todo: #eba400; --accent-todo-text: #a16a00; --accent-review: #fa8532; --accent-review-text: #ad6410; --accent-merge: #a37acc; --accent-merge-text: #8b64b6; --accent-live: #22a4e6; --accent-live-text: #1a7bb7; --accent-integration: #4cbf99; --accent-integration-text: #3b8264; --accent-done: #86b300; --accent-done-text: #647f00; --error: #e65050; --error-text: #cd474f;
/* 000191: motion knobs, one place to retune the entrances, the chunk fade and the pulse loop; 000194: --exit runs the closes, --shine is the whiter band mix */
--enter: 200ms; --exit: 180ms; --fade: 150ms; --pulse: 2s; --shine: 45%; }
${DARK_VARS}
/* the self-hosted faces: latin subsets served by the hub's /fonts route, no unicode-range, font-display swap so the fallback paints first */
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/space-grotesk-400.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 500; font-display: swap; src: url("/fonts/space-grotesk-500.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 700; font-display: swap; src: url("/fonts/space-grotesk-700.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/ibm-plex-mono-400.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url("/fonts/ibm-plex-mono-500.woff2") format("woff2"); }
/* the type scale, 16px base: 2rem count, 1.0625rem title, 0.9375rem task name, 0.875rem body, 0.8125rem station label and log, 0.75rem meta; nothing falls below 0.75rem */
html, body { height: 100%; }
body { --panel-w: clamp(28rem, 32vw, 35rem); --console-h: 0px; --chrome: 0px; display: flex; flex-direction: column; margin: 0; background: var(--canvas); color: var(--text); font-family: ${SANS}; font-size: 0.875rem; }
/* 000147: buttons inherit the page font instead of the UA Arial default */
button { font-family: inherit; }
header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 6px; }
h1 { font-size: 1.0625rem; font-weight: 500; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.875rem; }
#theme:hover { background: var(--raised); }
#updated { font-size: 0.75rem; color: var(--dim); font-family: ${MONO}; font-variant-numeric: tabular-nums; }
/* 000165: the serving hub's identity, hidden until the first /api/hub answer fills it */
#hub { padding: 2px 18px 8px; font-size: 0.75rem; color: var(--dim); }
#hub:empty { display: none; }
/* 000091: a relative #tabs at z-index 1 keeps the bar above the board's relation lines; 000124: the task cards stack at z-index 2 */
#tabs { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 18px 0; }
#tabs:empty { display: none; }
.tab { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px 6px 0 0; padding: 4px 12px; font-size: 0.875rem; cursor: pointer; }
.tab:hover { background: var(--raised); }
.tab.active { border-color: var(--link); color: var(--link); }
/* #366 the station spine: seven tracks, six even and done slightly wider; below 1100px the board alone scrolls horizontally with a 150px station floor, so the page never scrolls sideways (000247). The heads share one hairline grid item and each station body scrolls on its own */
#board { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)) minmax(0, 1.15fr); grid-template-rows: 1px minmax(0, 1fr); gap: 0 18px; padding: 10px 18px 18px; overflow-x: auto; overflow-y: hidden; position: relative; }
@media (max-width: 1099px) { #board { grid-template-columns: repeat(6, minmax(150px, 1fr)) minmax(150px, 1.15fr); } }
.spine { grid-column: 1 / -1; grid-row: 1; background: var(--hairline); }
/* a disabled integration stage narrows its own track to a strip; below 1100px the floor still wins */
#board.off-integration { grid-template-columns: repeat(5, minmax(0, 1fr)) 48px minmax(0, 1.15fr); }
@media (max-width: 1099px) { #board.off-integration { grid-template-columns: repeat(5, minmax(150px, 1fr)) 48px minmax(150px, 1.15fr); } }
/* relation lines: absolute in the relative board, so the overlay scrolls with the content; z-index 1
paints them above the station bodies and below the z-index-2 task cards, pointer-events none so the
card clicks pass through */
#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; overflow: visible; }
/* 000127: the low opacity keeps the lines a subtle hint behind the semi-transparent cards; hovering either connected card raises it (.relations-hot) */
#relations path { fill: none; stroke: var(--dim); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; animation-direction: reverse; }
#relations path.relations-hot { stroke-opacity: .8; }
@keyframes dashflow { to { stroke-dashoffset: -10; } }
/* #366 one station per phase: the head keeps the tick, the label and the count while the body scrolls; --ac comes from the station class at the end of this sheet */
.station { grid-row: 2; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.station + .station { border-left: 1px solid var(--hairline); }
.st-head { display: flex; align-items: baseline; gap: 8px; padding: 4px 0 10px; position: relative; flex: 0 0 auto; background: var(--canvas); z-index: 2; }
.st-head h2 { flex: 1 1 auto; min-width: 0; font-size: 0.8125rem; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; margin: 0; color: var(--dim); display: flex; align-items: center; gap: 6px; }
/* the tick crosses the shared hairline; only a station with a running agent accents it and its label */
.st-head::before { content: ""; position: absolute; left: 0; top: -9px; width: 1px; height: 18px; background: var(--hairline); }
.station.live .st-head::before { background: var(--ac); box-shadow: 0 0 6px var(--ac); }
.station.live .st-head h2 { color: var(--ac); }
.station .cards { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
/* a disabled stage dims its station but keeps the cards reachable */
.station.dim .cards, .station.dim .count { opacity: .4; }
/* a disabled integration stage is a narrow labeled strip with no cards and no count */
.station.strip { border-left: 1px dashed var(--hairline); }
.station.strip .cards, .station.strip .toggle, .station.strip .count { display: none; }
.station.strip .st-head { flex-direction: column; align-items: center; }
.station.strip .st-head h2 { writing-mode: vertical-rl; color: var(--faint); }
.count { font-size: 2rem; font-weight: 500; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); }
/* #366 a card is a row, not a box: no border, no radius, no state tint, its group ends with a hairline. 000124: positioned above the z-index-1 relation lines; the semi-transparent background lets a line passing under the card show through faintly (no --card var, --panel is the card's base color in both themes) */
.card { position: relative; z-index: 2; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; padding: 8px 2px 10px; cursor: pointer; }
.card:hover { background: color-mix(in srgb, var(--raised) 85%, transparent); }
/* 000320: a task held by the user blockedBy token pins to the top of its station and ends with its own rule; the inline held marker carries the dashed form */
.card.user-hold { border-bottom-color: var(--dim); }
/* 000191: genuinely new cards fade and rise in once at insertion; syncBoard adds .enter only at
creation and the page drops it on animationend, so a poll or a reorder never replays it */
.card.enter { animation: cardIn var(--enter) ease-out; }
@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }
/* the top row: spinner, number, the held marker, the priority ruler, then the live cell pushed right;
   it wraps so a narrow station never clips the live cell */
.c-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.75rem; }
.held { border: 1px dashed var(--dim); color: var(--dim); padding: 0 4px; font-size: 0.6875rem; font-family: ${MONO}; }
.c-live { margin-left: auto; color: var(--ac); font-family: ${MONO}; font-size: 0.75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ruler { display: inline-flex; gap: 2px; align-items: center; }
.ruler i { display: block; width: 8px; height: 3px; background: var(--hairline); }
.ruler i.on { background: currentColor; }
.ruler.pr-critical { color: var(--critical-fg); }
.ruler.pr-high { color: var(--high-fg); }
.ruler.pr-medium { color: var(--medium-fg); }
.ruler.pr-low { color: var(--low-fg); }
.name { font-size: 0.9375rem; font-weight: 500; line-height: 1.35; margin: 4px 0 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* the idle card's summary: one dim line, the context the name cannot carry */
.ctx { font-size: 0.75rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the run row: a live run in the station accent, a finished run red and neutral about the card */
.c-run { margin-top: 4px; font-size: 0.75rem; font-family: ${MONO}; color: var(--dim); }
.c-run.dead { color: var(--error-text); }
/* the meta row: the sub-state marker for a non-primary state, then the priority and complexity labels and the issuer at the right; it wraps so the labels survive a narrow station */
.c-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 5px; font-size: 0.75rem; font-family: ${MONO}; }
.c-meta > span { background: none; padding: 0; border-radius: 0; }
.c-meta .c-p { color: var(--text); }
.c-meta .p-critical { color: var(--critical-fg); }
.c-meta .p-high { color: var(--high-fg); }
.c-meta .p-medium { color: var(--medium-fg); }
.c-meta .p-low { color: var(--low-fg); }
.c-cx { color: var(--dim); }
.c-issuer { margin-left: auto; color: var(--faint); }
.sub-state { color: var(--dim); }
.num { font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); margin-right: 4px; }
.num-link { color: var(--link); cursor: pointer; }
.num-link:hover { text-decoration: underline; }
.spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid var(--hairline); border-top-color: var(--text); border-radius: 50%; vertical-align: 0px; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } #relations path { animation: none; } }
.chip { font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; background: var(--hairline); color: var(--text); }
.chip.issuer { background: var(--code-bg); color: var(--dim); }
.chip.cx { background: var(--code-bg); color: var(--dim); }
.issued { color: var(--dim); }
/* #366 the run row's totals (taskStats): the value already sits in the span, so no entrance animation runs on a poll */
.card-stats { font-variant-numeric: tabular-nums; }
.card-stats:empty { display: none; }
.p-low { background: var(--low-bg); color: var(--low-fg); }
.p-medium { background: var(--medium-bg); color: var(--medium-fg); }
.p-high { background: var(--high-bg); color: var(--high-fg); }
.p-critical { background: var(--critical-bg); color: var(--critical-fg); }
/* 000129: per-value complexity chips reuse the priority palette; .chip.cx above stays as the fallback for an unknown value */
/* 000143: calm blue-grey tint with the theme foreground, readable in both themes */
.chip.cx-trivial { background: var(--cx-trivial-bg); color: var(--text); }
.chip.cx-simple { background: var(--low-bg); color: var(--low-fg); }
.chip.cx-moderate { background: var(--medium-bg); color: var(--medium-fg); }
.chip.cx-complex { background: var(--critical-bg); color: var(--critical-fg); }
.empty { font-size: 0.75rem; color: var(--dim); }
.toggle { display: block; width: 100%; margin-top: 4px; border: 0; border-top: 1px solid var(--hairline); background: none; color: var(--link); border-radius: 0; padding: 6px 0; cursor: pointer; font-size: 0.75rem; font-family: ${MONO}; text-align: left; }
.toggle:hover { color: var(--text); }
/* the panel's run rows: one row per agent run, sub run and doctor run. #353 kept one accent per
   role, and the failed-run red wins over it (two classes beat one) */
#p-runs, #p-history { display: flex; flex-direction: column; margin-bottom: 14px; }
#p-runs:empty, #p-history:empty { display: none; }
.run-row { display: flex; align-items: baseline; gap: 8px; width: 100%; margin: 0; border: 0; border-bottom: 1px solid var(--hairline); background: none; color: inherit; padding: 5px 2px; cursor: pointer; font-family: inherit; font-size: 0.8125rem; text-align: left; }
.run-row:hover { background: var(--raised); }
.run-row .row-meta { margin-left: auto; font-family: ${MONO}; font-size: 0.75rem; color: var(--dim); font-variant-numeric: tabular-nums; }
.run-row.agent-sub, .run-row.agent-doctor { padding-left: 16px; font-size: 0.75rem; }
.run-row.agent-sub .row-role { color: var(--dim); }
.run-row.agent-row-active { background: color-mix(in srgb, var(--link) 12%, var(--panel)); }
.run-row.agent-dead { color: var(--error-text); }
.agent-doctor { color: var(--accent-done-text); }
.agent-splitter { color: var(--accent-backlog-text); }
.agent-developer { color: var(--accent-todo-text); }
.agent-reviewer { color: var(--accent-review-text); }
.agent-merger { color: var(--accent-merge-text); }
.agent-livetest { color: var(--accent-live-text); }
.agent-integration { color: var(--accent-integration-text); }
.check { color: var(--low-fg); margin-right: 5px; }
.cross { color: var(--error-text); margin-right: 5px; }
/* the docked task panel: full height below the page chrome, the board gives up the panel's width so
   the panel never covers a station head, and the console lifts the panel's bottom edge */
#panel { position: fixed; top: var(--chrome); right: 0; bottom: var(--console-h); width: var(--panel-w); z-index: 3; overflow-y: auto; overflow-x: hidden; background: var(--panel); border-left: 1px solid var(--hairline); padding: 0 18px 18px; }
#panel.hidden { display: none; }
/* 000191: the panel slides in over the exit step's 180ms and the refresh never replays it */
#panel:not(.hidden) { animation: panelIn var(--exit) ease-out; }
@keyframes panelIn { from { transform: translateX(100%); } }
#panel.closing { animation: panelOut var(--exit) ease-in forwards; }
@keyframes panelOut { to { transform: translateX(100%); } }
body.panel-open #board { padding-right: calc(18px + var(--panel-w)); }
/* the header is sticky at every width, so the title and the close control never scroll away */
#p-head { position: sticky; top: 0; display: flex; align-items: flex-start; gap: 10px; padding: 14px 0 8px; background: var(--panel); z-index: 1; }
#p-head h2 { flex: 1 1 auto; min-width: 0; font-size: 1.0625rem; font-weight: 500; margin: 0; line-height: 1.3; }
#p-head h2:focus { outline: none; }
#p-close { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.8125rem; }
#p-close:hover { background: var(--raised); }
#p-facts { font-size: 0.8125rem; margin-bottom: 10px; }
#p-facts div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 2px 0; }
#p-facts .k { min-width: 84px; color: var(--dim); }
/* the priority control is a four-option segmented group: the active option takes its own hue */
#p-prio { display: flex; margin-bottom: 6px; }
.seg { border: 1px solid var(--hairline); background: var(--panel); color: var(--dim); padding: 2px 8px; font-size: 0.75rem; font-family: ${MONO}; cursor: pointer; }
.seg + .seg { border-left: 0; }
.seg:first-child { border-radius: 6px 0 0 6px; }
.seg:last-child { border-radius: 0 6px 6px 0; }
.seg:hover { background: var(--raised); }
.seg[aria-pressed="true"] { background: var(--raised); font-weight: 500; }
.seg.p-low[aria-pressed="true"] { color: var(--low-fg); }
.seg.p-medium[aria-pressed="true"] { color: var(--medium-fg); }
.seg.p-high[aria-pressed="true"] { color: var(--high-fg); }
.seg.p-critical[aria-pressed="true"] { color: var(--critical-fg); }
#p-prio-err { font-size: 0.75rem; color: var(--error-text); margin-bottom: 6px; }
#p-prio-err:empty { display: none; }
#p-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
#p-actions:empty { display: none; }
.m-action { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 3px 10px; font-size: 0.8125rem; font-family: inherit; cursor: pointer; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); }
.m-action:hover { background: var(--raised); }
/* #364 keyboard focus: every element the stylesheet marks interactive answers Tab with the same
   visible ring, so the pointer cue is never the only cue */
#theme:focus-visible, .tab:focus-visible, .card:focus-visible, .num-link:focus-visible, .toggle:focus-visible, .run-row:focus-visible, summary:focus-visible, #p-close:focus-visible, #c-close:focus-visible, .seg:focus-visible, .m-action:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
.m-action:disabled { opacity: 0.6; cursor: default; }
.m-block { color: var(--error-text); border: 1px solid var(--error); background: color-mix(in srgb, var(--error) 15%, var(--panel)); }
.m-unblock { color: var(--accent-done-text); border: 1px solid var(--accent-done); background: color-mix(in srgb, var(--accent-done) 15%, var(--panel)); }
#p-body { font-size: 0.875rem; line-height: 1.5; }
#p-body h1, #p-body h2, #p-body h3 { font-size: 0.9375rem; font-weight: 500; margin: 12px 0 4px; }
#p-body ul { margin: 4px 0; padding-left: 20px; }
/* #310 quoted covered-task summaries render as blockquotes: a subtle left border, small left
padding and the soft colour, with a vertical margin only so the paragraphs around it do not shift */
#p-body blockquote { border-left: 3px solid var(--hairline); padding-left: 10px; margin: 4px 0; color: var(--dim); }
#p-body pre { background: var(--code-bg); border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 0.8125rem; }
#p-body code { background: var(--code-bg); border-radius: 4px; padding: 0 4px; font-size: 0.8125rem; }
#p-body pre code { padding: 0; background: none; }
/* 000153: the console is already mono, so the inline and fenced code inside the panel and the log
keep the same mono stack and only drop the code surface */
#c-text code, #c-text pre code, #p-body code, #p-body pre { font-family: ${MONO}; }
#p-body a { color: var(--link); }
/* #291 md() tables in the panel and the log: the wrapper scrolls on its own, cells stay on one
line, and the leftmost column pins left with a static right border as the cue */
.md-table-wrap { overflow-x: auto; }
.md-table-wrap table { border-collapse: collapse; }
.md-table-wrap th, .md-table-wrap td { white-space: nowrap; text-align: left; padding: 3px 10px; border-bottom: 1px solid var(--hairline); }
.md-table-wrap .md-pin { position: sticky; left: 0; background: var(--panel); border-right: 1px solid var(--hairline); }
/* the console sits on the code background, not the panel, so its pinned column matches the pane */
#c-text .md-table-wrap .md-pin { background: var(--code-bg); }
/* the docked console is the column's last child, so its top edge is the drag handle and its height
   is its own var; the panel's bottom edge follows the same var */
#console { flex: 0 0 auto; display: flex; flex-direction: column; height: var(--console-h); min-height: 0; border-top: 1px solid var(--hairline); background: var(--code-bg); }
#console.hidden { display: none; }
#console:not(.hidden) { animation: logIn var(--enter) ease-out; }
@keyframes logIn { from { opacity: 0; transform: translateY(4px); } }
/* 000194: the matching close, after the entrance rule so the equal-specificity logOut wins */
#console.closing { animation: logOut var(--exit) ease-in forwards; }
@keyframes logOut { to { opacity: 0; transform: translateY(4px); } }
#c-handle { flex: 0 0 auto; height: 8px; cursor: row-resize; background: var(--hairline); }
#c-handle:hover { background: var(--dim); }
#c-handle:focus-visible { outline: 2px solid var(--link); outline-offset: -2px; }
#c-head { flex: 0 0 auto; display: flex; align-items: baseline; gap: 10px; padding: 2px 18px 4px; font-size: 0.75rem; font-family: ${MONO}; color: var(--dim); font-variant-numeric: tabular-nums; }
#c-title { color: var(--text); }
#c-close { margin-left: auto; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 1px 9px; cursor: pointer; font-size: 0.75rem; }
#c-close:hover { background: var(--raised); }
#c-log { flex: 1 1 auto; min-height: 0; overflow: auto; }
#c-meta { padding: 4px 18px 0; font-size: 0.75rem; line-height: 1.45; color: var(--dim); font-family: ${MONO}; font-variant-numeric: tabular-nums; }
#c-meta.hidden { display: none; }
/* the log text renders in IBM Plex Mono at the log step; blocks are collapsed <details> the client fills in */
#c-text { margin: 0; padding: 6px 18px 10px; font-size: 0.8125rem; line-height: 1.45; font-family: ${MONO}; white-space: pre-wrap; overflow-wrap: break-word; }
#c-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }
#c-text details { margin: 2px 0; }
#c-text summary { cursor: pointer; }
#c-text details.lg-think, #c-text details.lg-tool { color: var(--dim); }
#c-text details > pre { padding-left: 12px; }
/* 000191: appended chunks fade and rise in; a CSS animation replays only on newly inserted
nodes, so untouched siblings never re-animate and only new content moves */
#c-text > * { animation: chunkIn var(--fade) ease-out; }
@keyframes chunkIn { from { opacity: 0; transform: translateY(2px); } }
/* 000194: the pulse brightens only the glyphs: background-clip: text clips the gradient to the
block's text, the nested pre and summary children included, and color: transparent hides the box,
so the band passing reads as letters brightening, never a highlight bar; the details.pulse
selectors outrank the muted color rule (color: transparent must stick there) and --shine-base
follows the block's own color; 000198: flat shoulders (base 0-33% and 67-100%) so the 300%
window sits on flat base at both loop endpoints, no partial-bright tail at the wrap */
#c-text > .pulse, #c-text > details.lg-think.pulse, #c-text > details.lg-tool.pulse { --shine-base: var(--text); background-image: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, var(--shine-hi) var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%); background-size: 300% 100%; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; color: transparent; animation: chunkIn var(--fade) ease-out, shimmer var(--pulse) linear infinite; }
#c-text > details.lg-think.pulse, #c-text > details.lg-tool.pulse { --shine-base: var(--dim); }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
/* 000191: reduced motion stops the entrance, chunk and pulse animations too; the rule sits
after every base animation rule so the later equal-specificity selectors cannot override it;
000194: the details.pulse variants join it, only they outrank #c-text > * and .pulse */
@media (prefers-reduced-motion: reduce) { .card.enter, #panel:not(.hidden), #console:not(.hidden), #c-text > *, #c-text > .pulse, #c-text > details.lg-think.pulse, #c-text > details.lg-tool.pulse { animation: none; } }
/* 000194: under reduced motion the clip animation stops (above) and color: transparent would
make the text vanish: the gradient drops and the solid color restores per block type */
@media (prefers-reduced-motion: reduce) { #c-text > .pulse { background-image: none; color: var(--text); } #c-text > details.lg-think.pulse, #c-text > details.lg-tool.pulse { background-image: none; color: var(--dim); } }
/* one accent per stage, in pipeline order; the waiting and working states of a stage share it */
/* #366 each station points --ac at its stage token, generated from the station table so the mapping lives in one place */
${STATIONS.map((s) => `.s-${s.id} { --ac: var(--accent-${s.accent}); }`).join("\n")}
/* 204: mobile, the root font size 15% smaller so every rem-based size scales down with it */
@media (max-width: 600px) { html { font-size: 85%; } }
/* 205: mobile, the task panel is a full-screen sheet, flush with all four sides and over the console */
@media (max-width: 600px) { #panel { top: 0; bottom: 0; width: 100vw; padding: 0 12px 12px; } body.panel-open #board { padding-right: 18px; } }
`;
