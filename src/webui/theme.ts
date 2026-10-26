// the served stylesheet and its palette, split out of PAGE so a redesign task edits one block

import { STATIONS } from "./board.ts";

// #370 one breakpoint for the whole phone layout: below this width the spine turns vertical and the
// panel, the console and the filter bar become sheets. The stylesheet and the client read this value
export const MOBILE_MAX = 700;

// Space Grotesk carries the prose and the labels; IBM Plex Mono the numbers, the log and the code
const SANS = `"Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const MONO = `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

// the Ink black dark palette, written once and applied twice: explicit choice via data-theme, browser default via media query; the token names match the light :root block one for one
const DARK_TOKENS = `--canvas: #05080a; --panel: #0b1118; --raised: #111a24; --hairline: #18222e; --text: #b3b1aa; --dim: #75808e; --faint: #4d5866; --link: #e6b450;
/* 000129: medium/critical hues widened (yellow / strong red) so the priority chips read apart; -bg tints match their fg */
--low-bg: rgba(170, 217, 76, .15); --low-fg: #aad94c; --medium-bg: rgba(255, 209, 115, .15); --medium-fg: #ffd173; --high-bg: rgba(255, 143, 64, .15); --high-fg: #ff8f40; --critical-bg: rgba(255, 82, 82, .15); --critical-fg: #ff5252;
--cx-trivial-bg: rgba(100, 130, 165, .18); --shine-hi: #ffffff; --overlay: rgba(0, 0, 0, .6); --code-bg: #010102;
--accent-backlog: #b3bbc6; --accent-backlog-text: #b3bbc6; --accent-todo: #e6b22d; --accent-todo-text: #e6b22d; --accent-review: #ffa068; --accent-review-text: #ffa068; --accent-merge: #cea5fd; --accent-merge-text: #cea5fd; --accent-live: #68c5ff; --accent-live-text: #68c5ff; --accent-integration: #69ceca; --accent-integration-text: #69ceca; --accent-done: #73d484; --accent-done-text: #73d484; --error: #ff6b63; --error-text: #ff6b63;`;
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
--accent-backlog: #979faa; --accent-backlog-text: #666c75; --accent-todo: #c79603; --accent-todo-text: #886600; --accent-review: #eb7c33; --accent-review-text: #a84f0a; --accent-merge: #b188df; --accent-merge-text: #7b5a9f; --accent-live: #3fa9e5; --accent-live-text: #1674a4; --accent-integration: #4ab1ae; --accent-integration-text: #227a78; --accent-done: #56b669; --accent-done-text: #2e7f40; --error: #ff645f; --error-text: #b0423d;
/* 000191: motion knobs, one place to retune the entrances, the chunk fade and the pulse loop; 000194: --exit runs the closes, --shine is the whiter band mix; #369: one motion token set, every duration and easing in the sheet reads one of these */
--t-fast: 120ms; --t-base: 180ms; --t-slow: 240ms; --t-breathe: 2s; --t-slot: 800ms; --t-wave: 5.6s; --ease-enter: cubic-bezier(.2, .8, .2, 1); --ease-exit: cubic-bezier(.4, 0, .8, 1); --ease-breathe: ease-in-out; --shine: 45%;
/* #377 one spacing scale: the chrome, the station heads and the cards read one of these six steps */
--sp-1: 4px; --sp-2: 6px; --sp-3: 8px; --sp-4: 12px; --sp-5: 16px; --sp-6: 24px; }
${DARK_VARS}
/* the self-hosted faces: latin subsets served by the hub's /fonts route, no unicode-range, font-display swap so the fallback paints first */
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/space-grotesk-400.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 500; font-display: swap; src: url("/fonts/space-grotesk-500.woff2") format("woff2"); }
@font-face { font-family: "Space Grotesk"; font-style: normal; font-weight: 700; font-display: swap; src: url("/fonts/space-grotesk-700.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/ibm-plex-mono-400.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 500; font-display: swap; src: url("/fonts/ibm-plex-mono-500.woff2") format("woff2"); }
/* the type scale, 16px base: 2rem count, 1.0625rem title, 0.9375rem task name, 0.875rem body, 0.8125rem station label and log, 0.75rem meta; nothing falls below 0.75rem. #374 the body base clamps 14px to 16px, so a 1920 screen reads one step larger and 1440 stays as it was */
html, body { height: 100%; }
body { --panel-w: clamp(28rem, 32vw, 35rem); --console-h: 0px; --chrome: 0px; display: flex; flex-direction: column; margin: 0; background: var(--canvas); color: var(--text); font-family: ${SANS}; font-size: clamp(0.875rem, 0.35vw + 0.55rem, 1rem); }
/* 000147: buttons inherit the page font instead of the UA Arial default */
button { font-family: inherit; }
header { display: flex; align-items: baseline; gap: 10px; padding: var(--sp-4) 18px var(--sp-3); }
h1 { font-size: 1.0625rem; font-weight: 500; margin: 0; }
#theme { margin-left: auto; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.875rem; }
#theme:hover { background: var(--raised); }
#updated { font-size: 0.75rem; color: var(--dim); font-family: ${MONO}; font-variant-numeric: tabular-nums; }
/* 000091: a relative #tabs at z-index 1 keeps the bar above the board's relation lines; 000124: the task cards stack at z-index 2 */
#tabs { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 18px 0; }
#tabs:empty { display: none; }
.tab { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px 6px 0 0; padding: 4px 12px; font-size: 0.875rem; cursor: pointer; }
.tab:hover { background: var(--raised); }
.tab.active { border-color: var(--link); color: var(--link); }
/* #368 the filter bar: one wrapping row under the tabs and above the spine, every control a chip or a
   text field on the chrome; clear sits at the row's end and hides while nothing filters */
#filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: var(--sp-3) 18px; }
#f-q { flex: 0 1 15rem; min-width: 8rem; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 8px; font-family: inherit; font-size: 0.8125rem; }
#f-q::placeholder { color: var(--dim); }
.f-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.f-label { color: var(--dim); font-size: 0.75rem; }
.f-chip { border: 1px solid var(--hairline); background: var(--panel); color: var(--dim); border-radius: 999px; padding: 3px 9px; min-height: 28px; font-family: inherit; font-size: 0.75rem; }
.f-chip:hover { background: var(--raised); }
.f-chip[aria-pressed="true"] { border-color: var(--link); color: var(--link); }
/* #378 a pressed filter chip takes its own value hue, the same per-value colour the cards use (000129) */
.f-chip.pr-low[aria-pressed="true"], .f-chip.cx-simple[aria-pressed="true"] { border-color: var(--low-fg); background: var(--low-bg); color: var(--low-fg); }
.f-chip.pr-medium[aria-pressed="true"], .f-chip.cx-moderate[aria-pressed="true"] { border-color: var(--medium-fg); background: var(--medium-bg); color: var(--medium-fg); }
.f-chip.pr-high[aria-pressed="true"] { border-color: var(--high-fg); background: var(--high-bg); color: var(--high-fg); }
.f-chip.pr-critical[aria-pressed="true"], .f-chip.cx-complex[aria-pressed="true"] { border-color: var(--critical-fg); background: var(--critical-bg); color: var(--critical-fg); }
.f-chip.cx-trivial[aria-pressed="true"] { border-color: var(--faint); background: var(--cx-trivial-bg); color: var(--text); }
#f-clear { margin-left: auto; }
#f-clear[hidden] { display: none; }
/* #370 the phone filter button and its sheet's apply control: desktop keeps the visible bar */
#f-toggle, #f-apply { display: none; }
.f-chip, .arch-row, .pal-row { cursor: pointer; }
/* #368 the done archive: the done station's overflow opens this view in place of the spine, same
   window, one page of 50 rows and a footer with the newer and older controls */
#board.hidden, #archive.hidden { display: none; }
#archive { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 18px 18px; }
.arch-head { display: flex; align-items: baseline; gap: 10px; padding: 2px 0 8px; font-size: 0.875rem; }
#arch-count { color: var(--dim); font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; }
.arch-head .m-action { margin-left: auto; }
.arch-row { display: flex; align-items: baseline; gap: var(--sp-3); width: 100%; margin: 0; border: 0; border-bottom: 1px solid var(--hairline); background: none; color: var(--text); padding: var(--sp-2) 2px; font-family: inherit; font-size: 0.8125rem; text-align: left; }
.arch-row:hover { background: var(--raised); }
.arch-cx { flex: 0 0 auto; }
.arch-tok, .arch-dur { flex: 0 0 auto; width: 4rem; text-align: right; white-space: nowrap; color: var(--dim); font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; }
.arch-dur { width: 5rem; }
.arch-num, .pal-num { color: var(--link); font-family: ${MONO}; font-variant-numeric: tabular-nums; }
.arch-name, .pal-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arch-date, .pal-state { color: var(--dim); font-size: 0.75rem; font-family: ${MONO}; }
.pal-live { color: var(--accent-todo); font-size: 0.75rem; font-family: ${MONO}; }
#arch-foot { display: flex; align-items: baseline; gap: 10px; padding: 10px 0 0; color: var(--dim); font-size: 0.75rem; font-family: ${MONO}; }
#arch-page { flex: 1 1 auto; }
#arch-newer[hidden], #arch-more[hidden] { display: none; }
#arch-empty, #pal-empty, #pal-more { padding: 6px 2px; color: var(--dim); font-size: 0.75rem; font-family: ${MONO}; }
#arch-empty.hidden, #pal-empty.hidden, #pal-more.hidden { display: none; }
body.panel-open #archive { padding-right: calc(18px + var(--panel-w)); }
/* #368 the command palette: a centred dialog over the page chrome, the input above the capped list */
#palette { position: fixed; inset: 0; z-index: 10; display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; background: color-mix(in srgb, var(--text) 35%, transparent); }
#palette.hidden { display: none; }
#pal-box { width: min(40rem, 92vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--hairline); border-radius: 8px; padding: 8px; }
#pal-input { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 0.9375rem; }
#pal-list { display: flex; flex-direction: column; overflow-y: auto; margin-top: 6px; }
.pal-row { display: flex; align-items: baseline; gap: 8px; width: 100%; margin: 0; border: 0; border-bottom: 1px solid var(--hairline); background: none; color: var(--text); padding: 5px 6px; font-family: inherit; font-size: 0.8125rem; text-align: left; }
.pal-row[aria-selected="true"] { background: var(--raised); }
/* #368 the panel's outside-filter notice: a task a palette or archive click reaches while the filter
   hides it names itself here, and one click shows it */
#p-outside { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; border: 1px solid var(--hairline); border-radius: 6px; padding: 4px 8px; color: var(--dim); font-size: 0.8125rem; }
#p-outside.hidden { display: none; }
#p-outside .m-action { margin-left: auto; }
/* #366 the station spine: seven tracks, six even and done slightly wider. #374 the floor is derived, not a breakpoint: 9.375rem per station, so at any width too narrow for seven 150px tracks plus the separators the board alone scrolls horizontally (000247) and the page never does. #388 the board keeps no side padding, so the seven tracks fill the viewport and a card box starts at 0. The heads share one hairline grid item and each station body scrolls on its own */
#board { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(6, minmax(9.375rem, 1fr)) minmax(9.375rem, 1.15fr); grid-template-rows: 1px minmax(0, 1fr); gap: 0; padding: var(--sp-3) 0 var(--sp-5); overflow-x: auto; overflow-y: hidden; position: relative; }
.spine { grid-column: 1 / -1; grid-row: 1; background: var(--hairline); position: relative; overflow: hidden; }
/* #369 the sweep is one gradient element on the spine's own hairline, so the loop has one animation node the poll never touches */
/* a disabled integration stage narrows its own track to a strip; the other six keep the floor */
#board.off-integration { grid-template-columns: repeat(5, minmax(9.375rem, 1fr)) 48px minmax(9.375rem, 1.15fr); }
/* relation lines: absolute in the relative board, so the overlay scrolls with the content; z-index 1
paints them above the station bodies and below the z-index-2 task cards, pointer-events none so the
card clicks pass through. #373 the lines exist only during a reveal: at rest the card marker carries
that a relation exists, so the overlay has no opacity of its own */
#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; overflow: visible; opacity: 0; transition: opacity var(--t-fast) var(--ease-enter); }
#board.reveal #relations { opacity: 1; }
/* #373 the reveal dims every unrelated card to 55%, not 40%, so the marker text on a dimmed card
stays readable; the active card and its rimmed blockers keep full strength */
#board.reveal .card:not(.hot) { opacity: .55; }
/* the base path carries no stroke of its own: the line exists only for the revealed card, so a reveal paints nothing but that card's outgoing lines (.relations-hot) */
#relations path { fill: none; stroke: var(--dim); stroke-width: 1.5; stroke-opacity: 0; stroke-dasharray: 6 4; transition: stroke-opacity var(--t-fast) var(--ease-enter); }
#relations path.relations-hot { stroke: var(--link); stroke-opacity: 1; }
@keyframes dashflow { to { stroke-dashoffset: -10; } }
/* #366 one station per phase: the head keeps the tick, the label and the count while the body scrolls; --ac comes from the station class at the end of this sheet */
.station { --i: 0; grid-row: 2; display: flex; flex-direction: column; gap: var(--sp-4); min-width: 0; min-height: 0; }
.station + .station { border-left: 1px solid var(--hairline); }
.st-head { display: flex; align-items: baseline; gap: 8px; padding: var(--sp-2) var(--sp-4) var(--sp-3); position: relative; flex: 0 0 auto; background: var(--canvas); z-index: 2; }
.st-head h2 { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; font-size: 0.8125rem; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; margin: 0; color: var(--ac-t, var(--dim)); display: flex; align-items: center; gap: 6px; }
/* the tick crosses the shared hairline in the station's own tint; a running agent adds the glow */
.st-head::before { content: ""; position: absolute; left: 0; top: -9px; width: 1px; height: 18px; background: var(--ac); }
.station.live .st-head::before { box-shadow: 0 0 6px var(--ac); }
/* #410 the head glow: one bar per head, on the shared hairline, blending the previous column's tint into its own so the walk reads as one transition */
.st-head::after { content: ""; position: absolute; left: 0; top: -1px; width: 20%; height: 1px; opacity: 0; background: linear-gradient(90deg, transparent, var(--ac-prev), var(--ac), transparent); }
/* #385 the scrollbar inset would push a scrolled card off the separator, so the wheel, the trackpad and the keyboard do the scrolling */
.station .cards { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; scrollbar-width: none; }
.station .cards::-webkit-scrollbar { width: 0; }
/* a disabled stage dims its station but keeps the cards reachable */
.station.dim .cards, .station.dim .count { opacity: .4; }
/* a disabled integration stage is a narrow labeled strip with no cards and no count */
.station.strip { border-left: 1px dashed var(--hairline); }
.station.strip .cards, .station.strip .toggle, .station.strip .count { display: none; }
.station.strip .st-head { flex-direction: column; align-items: center; }
.station.strip .st-head h2 { writing-mode: vertical-rl; color: var(--faint); }
.count { font-size: 2rem; font-weight: 500; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); }
/* #366 a card is a row, not a box: no border, no radius, no state tint, its group ends with a hairline. 000124: positioned above the z-index-1 relation lines; the semi-transparent background lets a line passing under the card show through faintly (no --card var, --panel is the card's base color in both themes) */
.card { position: relative; z-index: 2; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 0; border-bottom: 1px solid var(--hairline); border-radius: 0; padding: var(--sp-3) var(--sp-4) var(--sp-4); cursor: pointer; }
.card:hover { background: color-mix(in srgb, var(--raised) 85%, transparent); }
/* 000320: a task held by the user blockedBy token pins to the top of its station and ends with its own rule; the inline held marker carries the dashed form */
.card.user-hold { border-bottom-color: var(--dim); }
/* 000191: genuinely new cards fade and rise in once at insertion; syncBoard adds .enter only at
creation and the page drops it on animationend, so a poll or a reorder never replays it */
.card.enter { animation: cardIn var(--t-slow) var(--ease-enter); }
@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }
/* the top row: the liveness mark, number, the held marker, the priority ruler, then the live cell pushed right;
   it wraps so a narrow station never clips the live cell */
.c-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.75rem; }
.held { border: 1px dashed var(--dim); color: var(--dim); padding: 0 4px; font-size: 0.6875rem; font-family: ${MONO}; }
.c-live { margin-left: auto; color: var(--ac-t, var(--ac)); font-family: ${MONO}; font-size: 0.75rem; white-space: nowrap; font-variant-numeric: tabular-nums; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ruler { display: inline-flex; gap: 2px; align-items: center; }
.ruler i { display: block; width: 8px; height: 3px; background: var(--hairline); }
.ruler i.on { background: currentColor; }
.ruler.pr-critical { color: var(--critical-fg); }
.ruler.pr-high { color: var(--high-fg); }
.ruler.pr-medium { color: var(--medium-fg); }
.ruler.pr-low { color: var(--low-fg); }
.name { font-size: 0.9375rem; font-weight: 500; line-height: 1.35; margin: var(--sp-2) 0 var(--sp-1); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* the idle card's summary: one dim line, the context the name cannot carry */
.ctx { font-size: 0.75rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the run row: a live run in the station accent, a finished run red and neutral about the card */
.c-run { margin-top: var(--sp-2); font-size: 0.75rem; font-family: ${MONO}; color: var(--dim); }
.c-run.dead { color: var(--error-text); }
/* the meta row: the complexity label, then the issuer and the waits-on marker at the right; it wraps so the labels survive a narrow station */
.c-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: var(--sp-3); font-size: 0.75rem; font-family: ${MONO}; }
.c-meta > span { background: none; padding: 0; border-radius: 0; }
.c-cx { color: var(--dim); }
.c-issuer { margin-left: auto; color: var(--faint); }
/* #373 the waits-on marker: the resting fact that a relation exists, a real button in the meta row so
touch and keyboard reach the popover; the issuer's own auto margin puts the pair at the right edge, so
the marker takes none, and it never wraps and keeps a 28px hit height */
.c-wait { flex: 0 0 auto; min-height: 28px; display: inline-flex; align-items: center; white-space: nowrap; border: 1px solid var(--hairline); background: var(--raised); color: var(--text); border-radius: 6px; padding: 0 8px; font-family: inherit; font-size: 0.75rem; }
.c-wait.held { border-style: dashed; border-color: var(--dim); color: var(--dim); }
.c-wait:hover { border-color: var(--link); color: var(--link); }
.c-wait:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
/* #373 the marker popover: one row per stored ref, the rendered refs open their card, the off-board
ones stay text with their badge; fixed, so a card never clips it */
#waits-pop { position: fixed; z-index: 4; display: flex; flex-direction: column; min-width: 16rem; max-width: 24rem; padding: 4px; background: var(--panel); border: 1px solid var(--hairline); border-radius: 8px; box-shadow: 0 12px 32px var(--overlay); }
.wait-row { display: flex; align-items: baseline; gap: 8px; width: 100%; margin: 0; border: 0; border-radius: 4px; background: none; color: var(--text); padding: 5px 6px; font-family: inherit; font-size: 0.75rem; text-align: left; }
button.wait-row { min-height: 28px; }
.wait-row:hover { background: var(--raised); }
.wait-row:focus-visible { outline: 2px solid var(--link); outline-offset: -2px; }
.wait-name { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wait-state { color: var(--dim); font-family: ${MONO}; font-size: 0.6875rem; }
.wait-badge { flex: 0 0 auto; color: var(--dim); font-family: ${MONO}; font-size: 0.6875rem; }
.wait-badge.wait-done { color: var(--accent-done-text); }
/* #373 an off-board blocker keeps a stub at its card's right edge instead of vanishing; the tag
names the reason where the station is wide enough */
.c-stub { position: absolute; top: 6px; right: 2px; display: flex; align-items: baseline; gap: 6px; max-width: 45%; overflow: hidden; pointer-events: none; color: var(--dim); font-family: ${MONO}; font-size: 0.6875rem; }
.c-stub-item { flex: 0 0 auto; white-space: nowrap; }
.stub-tag { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--faint); margin-left: 4px; }
/* #373 the blocker rim: an inset ring on the cards the active card waits on */
.card.rim { box-shadow: inset 0 0 0 1px var(--link); }
.num { font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); margin-right: 4px; }
.num-link { color: var(--link); cursor: pointer; }
.num-link:hover { text-decoration: underline; }
/* #397 the liveness glyph is a circle, not a spinner ring: it keeps the breathe pulse and fills from the station accent's -text step, with --ac and then the link colour as the fallback the panel's loading line reads */
.spin { display: inline-block; width: 7px; height: 7px; border: 0; border-radius: 50%; background: var(--ac-t, var(--ac, var(--link))); margin-right: 6px; vertical-align: 1px; }
.st-head h2 .spin { margin-right: 0; }
.chip { font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; background: var(--hairline); color: var(--text); }
.chip.issuer { background: var(--code-bg); color: var(--dim); }
.chip.cx { background: var(--code-bg); color: var(--dim); }
.issued { color: var(--dim); }
/* #366 the run row's totals (taskStats): the value already sits in the span, so no entrance animation runs on a poll */
.card-stats { font-variant-numeric: tabular-nums; }
.card-stats:empty { display: none; }
/* #408 the phone card's token total: the desktop card reads the run row instead, so the cell hides */
.card-tokens { display: none; }
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
.empty { padding: 0 var(--sp-4); font-size: 0.75rem; color: var(--dim); }
.toggle { display: block; width: 100%; margin-top: 4px; border: 0; border-top: 1px solid var(--hairline); background: none; color: var(--link); border-radius: 0; padding: 6px 12px; cursor: pointer; font-size: 0.75rem; font-family: ${MONO}; text-align: left; }
.toggle:hover { color: var(--text); }
/* the panel's run rows: one row per agent run, sub run and doctor run. #353 kept one accent per
   role, and the failed-run red wins over it (two classes beat one) */
#p-runs { display: flex; flex-direction: column; margin-bottom: 14px; }
#p-runs:empty { display: none; }
.run-row { display: flex; align-items: baseline; gap: 8px; width: 100%; margin: 0; border: 0; background: none; color: inherit; padding: 5px 2px; cursor: pointer; font-family: inherit; font-size: 0.8125rem; text-align: left; }
.run-row:hover { background: var(--raised); }
.run-row .row-meta { margin-left: auto; font-family: ${MONO}; font-size: 0.75rem; color: var(--dim); font-variant-numeric: tabular-nums; }
.run-row.agent-sub, .run-row.agent-doctor { position: relative; padding-left: var(--sp-5); font-size: 0.75rem; }
/* #379 the run tree: one guide per run group and a tick into each child, both read the group's --guide, which a live run turns to the run-level accent */
.run-group-live { --guide: var(--link); }
.run-row.agent-sub::before, .run-row.agent-doctor::before { content: ""; position: absolute; left: 7px; top: 0; bottom: 0; width: 1px; background: var(--guide, var(--hairline)); }
.run-row.agent-sub::after, .run-row.agent-doctor::after { content: ""; position: absolute; left: 7px; top: 50%; width: 6px; height: 1px; background: var(--guide, var(--hairline)); }
.run-note { padding: 4px 2px 4px var(--sp-5); color: var(--dim); font-size: 0.75rem; }
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
.run-row > .run-mark { flex: 0 0 11px; display: inline-flex; justify-content: center; }
.run-mark > .spin, .run-mark > .check, .run-mark > .cross { margin-right: 0; }
/* the docked task panel: full height below the page chrome, the board gives up the panel's width so
   the panel never covers a station head, and the console lifts the panel's bottom edge */
#panel { position: fixed; top: var(--chrome); right: 0; bottom: var(--console-h); width: var(--panel-w); z-index: 3; overflow-y: auto; overflow-x: hidden; background: var(--panel); border-left: 1px solid var(--hairline); padding: 0 18px 18px; }
#panel.hidden { display: none; }
/* 000191: the panel slides in over the exit step's 180ms and the refresh never replays it */
#panel:not(.hidden) { animation: panelIn var(--t-base) var(--ease-enter); }
@keyframes panelIn { from { transform: translateX(100%); } }
#panel.closing { animation: panelOut var(--t-base) var(--ease-exit) forwards; }
@keyframes panelOut { to { transform: translateX(100%); } }
body.panel-open #board { padding-right: calc(18px + var(--panel-w)); }
/* the header is sticky at every width, so the title and the close control never scroll away */
#p-head { position: sticky; top: 0; display: flex; align-items: flex-start; gap: 10px; padding: 14px 0 8px; background: var(--panel); z-index: 1; }
#p-head h2 { flex: 1 1 auto; min-width: 0; font-size: 1.0625rem; font-weight: 500; margin: 0; line-height: 1.3; }
#p-head h2:focus { outline: none; }
/* #370 the phone sheet's drag handle, hidden on the desktop dock */
#p-handle { display: none; }
#p-close { flex: 0 0 auto; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.8125rem; }
#p-close:hover { background: var(--raised); }
#p-facts { font-size: 0.8125rem; margin-bottom: 10px; }
#p-facts div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 2px 0; }
#p-facts .k { min-width: 84px; color: var(--dim); }
/* the priority control sits on its label's line, aligned with the facts rows above, and is a
   four-option segmented group: the active option takes its own hue */
#p-prio-wrap { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin-bottom: 6px; }
#p-prio-wrap .k { min-width: 84px; color: var(--dim); }
#p-prio { display: flex; }
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
#p-prio-err { width: 100%; font-size: 0.75rem; color: var(--error-text); margin-bottom: 6px; }
#p-prio-err:empty { display: none; }
#p-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
#p-actions:empty { display: none; }
.m-action { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 3px 10px; font-size: 0.8125rem; font-family: inherit; cursor: pointer; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); }
.m-action:hover { background: var(--raised); }
/* #364 keyboard focus: every element the stylesheet marks interactive answers Tab with the same
   visible ring, so the pointer cue is never the only cue */
#theme:focus-visible, .tab:focus-visible, .card:focus-visible, .num-link:focus-visible, .toggle:focus-visible, .run-row:focus-visible, summary:focus-visible, #p-close:focus-visible, #c-close:focus-visible, .seg:focus-visible, .m-action:focus-visible, .f-chip:focus-visible, .arch-row:focus-visible, .pal-row:focus-visible, #f-q:focus-visible, #pal-input:focus-visible, #f-toggle:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
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
#console:not(.hidden) { animation: logIn var(--t-base) var(--ease-enter); }
@keyframes logIn { from { opacity: 0; transform: translateY(4px); } }
/* 000194: the matching close, after the entrance rule so the equal-specificity logOut wins */
#console.closing { animation: logOut var(--t-base) var(--ease-exit) forwards; }
@keyframes logOut { to { opacity: 0; transform: translateY(4px); } }
#c-handle { flex: 0 0 auto; height: 8px; cursor: row-resize; background: var(--hairline); }
#c-handle:hover { background: var(--dim); }
#c-handle:focus-visible { outline: 2px solid var(--link); outline-offset: -2px; }
#c-head { flex: 0 0 auto; display: flex; align-items: baseline; gap: 10px; padding: 2px 18px 4px; font-size: 0.75rem; font-family: ${MONO}; color: var(--dim); font-variant-numeric: tabular-nums; }
#c-title { color: var(--text); }
#c-close { flex: 0 0 auto; margin-left: auto; border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 1px 9px; cursor: pointer; font-size: 0.75rem; }
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
#c-text > * { animation: chunkIn var(--t-fast) var(--ease-enter); }
@keyframes chunkIn { from { opacity: 0; transform: translateY(2px); } }
/* 000194: the pulse brightens only the glyphs: background-clip: text clips the gradient to the
block's text, the nested pre and summary children included, and color: transparent hides the box,
so the band passing reads as letters brightening, never a highlight bar; the details.pulse
selectors outrank the muted color rule (color: transparent must stick there) and --shine-base
follows the block's own color; 000198: flat shoulders (base 0-33% and 67-100%) so the 300%
window sits on flat base at both loop endpoints, no partial-bright tail at the wrap */
[data-motion="live"] #c-text > .pulse, [data-motion="live"] #c-text > details.lg-think.pulse, [data-motion="live"] #c-text > details.lg-tool.pulse { --shine-base: var(--text); background-image: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, var(--shine-hi) var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%); background-size: 300% 100%; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer var(--t-breathe) linear infinite; }
[data-motion="live"] #c-text > details.lg-think.pulse, [data-motion="live"] #c-text > details.lg-tool.pulse { --shine-base: var(--dim); }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
/* #369 the shine is live-only and rides the .pulse markLiveLine puts on the newest streaming block,
so no historical line ever shines; because the color: transparent sits inside the same opt-in rule,
an un-animated block can never strand invisible text, and the old reduced-motion restores are gone */
/* one accent per stage, in pipeline order; the waiting and working states of a stage share it */
/* #366 each station points --ac at its stage token, generated from the station table so the mapping lives in one place */
${STATIONS.map((s, i) => `.s-${s.id} { --ac: var(--accent-${s.accent}); --ac-t: var(--accent-${s.accent}-text); --ac-prev: var(--accent-${STATIONS[Math.max(0, i - 1)].accent}); }`).join("\n")}
/* #370 the phone layout, one breakpoint for every surface and media queries only: the spine stacks
   vertically in pipeline order and the hairline becomes the connector on the left edge. The root
   keeps the 16px base, so the type scale needs no mobile override except the station count */
@media (max-width: ${MOBILE_MAX}px) {
:root { --ctl-h: 32px; }
header { flex-wrap: wrap; padding: 10px 12px 6px; }
#theme { min-height: var(--ctl-h); }
#tabs { flex-wrap: nowrap; gap: 8px; overflow-x: auto; padding: 6px 12px 0; }
.tab { min-height: 44px; padding: 0 16px; }
#board { display: flex; flex-direction: column; gap: 0; padding: 14px 0 12px; overflow-x: hidden; overflow-y: auto; }
.spine, #relations { display: none; }
/* #386 nothing inside the phone board shrinks: the station, its cards and each card size to their content, so a card never paints over the next one and #board stays the one vertical scroller */
.station { padding-left: 0; border-left: 1px solid var(--hairline); flex: 0 0 auto; min-height: auto; }
.station + .station { border-top: 0; border-left: 1px solid var(--hairline); margin-top: 16px; }
.station.strip { border-left: 1px dashed var(--hairline); }
.station.strip .st-head { flex-direction: row; align-items: baseline; }
.station.strip .st-head h2 { writing-mode: horizontal-tb; }
.station .cards { flex: 0 0 auto; min-height: auto; overflow: visible; }
.card { flex: 0 0 auto; padding: 10px 12px 12px; }
/* #408 a phone card is the id, the title and the tokens: the token cell takes the id row's right edge
and the five desktop rows drop, while the live mark and the number stay */
.card .ruler { display: none; }
.card .c-live { display: none; }
.card .ctx { display: none; }
.card .c-run { display: none; }
.card .c-meta { display: none; }
.card .card-tokens { display: inline-block; margin-left: auto; font-variant-numeric: tabular-nums; }
.station .cards > .card:last-child { border-bottom: 0; }
.st-head { align-items: baseline; padding: 14px 12px 0; border-top: 1px solid color-mix(in srgb, var(--ac) 55%, transparent); }
.station.live .st-head { border-top-color: var(--ac); }
.st-head h2 { font-size: 0.875rem; }
.st-head::before { left: 1px; top: 23px; width: 7px; height: 1px; }
/* #403 the phone head rules its column off and carries the desktop sweep as a glow on that rule; the
   motion layer starts it at the station's own slot, so the wave walks down the stack */
.st-head::after { content: ""; position: absolute; left: 0; top: -1px; width: 20%; height: 1px; opacity: 0; background: linear-gradient(90deg, transparent, var(--ac-prev), var(--ac), transparent); }
.empty { padding: 0 12px; }
.count { font-size: 0.8125rem; }
/* #387 the touch floor: a compact control keeps its desktop height and carries an invisible 44px band
   centred on its middle, so the look holds and the finger still lands; the band takes the tap. A stacked
   row takes no band: on a 29px pitch the next row's band starts 21px into the current row's box, so the
   bottom of a run row would open the row below. The card takes no band either, because its content
   already clears 44px and its ::after is the running progress line. A nested run row draws its
   connector in ::after and a more specific rule, so it keeps the connector and goes without a band.
   #405 the theme toggle, the filter button, the chips and the close buttons take the one 32px --ctl-h
   box and lean on the same band for the 44px floor */
/* #408 no phone card shows its meta row, so the waits-on marker takes no band */
.m-action, .seg, .toggle, #c-text summary, #theme, #f-toggle, .f-chip, #p-close, #c-close { position: relative; }
.m-action::after, .seg::after, .toggle::after, #c-text summary::after, #theme::after, #f-toggle::after, .f-chip::after, #p-close::after, #c-close::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 44px; margin-top: -22px; }
/* the neighbours still sit at least 8px apart */
#p-actions, .f-group, #tabs, .c-top, .c-meta { gap: 8px; }
/* #405 a wrapped chip row sits two band overhangs apart, so two chips' bands touch and never overlap;
   the filter sheet that stacks the chip groups and the loose chips uses the same distance */
.f-group { gap: 12px; }
/* #373 the popover becomes a full width block under its card, never a floating panel */
#waits-pop { min-width: 0; max-width: none; }
}
/* #370 the panel: a full-screen sheet with a drag handle, the sticky header keeps the task identity
   and a visible close button, and the back gesture follows the existing hash route */
@media (max-width: ${MOBILE_MAX}px) {
#panel { top: 0; bottom: 0; left: 0; width: auto; z-index: 5; border-left: 0; padding: 0 12px calc(12px + env(safe-area-inset-bottom)); }
#p-head { gap: 12px; padding: calc(18px + env(safe-area-inset-top)) 0 8px; }
#p-handle { display: block; position: absolute; top: calc(6px + env(safe-area-inset-top)); left: 50%; width: 40px; height: 4px; margin-left: -20px; border-radius: 2px; background: var(--hairline); }
#p-close { min-width: var(--ctl-h); min-height: var(--ctl-h); }
body.panel-open #board, body.panel-open #archive { padding-right: 12px; }
}
/* #370 the console: collapsed to one status line until a tap on the handle raises the bottom sheet to
   at most 70% of the viewport, or a drag sets its own height; the close control stays visible and the
   log keeps its scroll. #405 the sheet reads its own variable, so a phone drag never moves the dock */
@media (max-width: ${MOBILE_MAX}px) {
body { --console-h-touch: calc(92px + env(safe-area-inset-bottom)); }
#console { position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; height: var(--console-h-touch, calc(92px + env(safe-area-inset-bottom))); overflow: hidden; border-radius: 12px 12px 0 0; }
#console.raised { height: 70vh; }
#c-handle { position: relative; height: 44px; background: none; }
#c-handle:hover { background: none; }
#c-handle::before { content: ""; position: absolute; top: 10px; left: 50%; width: 40px; height: 4px; margin-left: -20px; border-radius: 2px; background: var(--hairline); }
#c-head { align-items: center; min-height: 44px; gap: 8px; padding: 0 12px; }
#c-close { min-width: var(--ctl-h); min-height: var(--ctl-h); }
#c-text { padding: 6px 12px calc(10px + env(safe-area-inset-bottom)); }
}
/* #370 the filter bar collapses behind one button with an active-count badge; its sheet repeats the
   same controls with an apply and a clear, and the palette goes full screen with an autofocused input */
@media (max-width: ${MOBILE_MAX}px) {
#f-toggle { display: inline-flex; align-items: center; gap: 8px; margin: 6px 12px; min-height: var(--ctl-h); border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 8px; padding: 0 14px; font-family: inherit; font-size: 0.875rem; cursor: pointer; }
#f-toggle[aria-expanded="true"] { border-color: var(--link); color: var(--link); }
#f-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--link); color: var(--canvas); font-family: ${MONO}; font-size: 0.75rem; line-height: 20px; text-align: center; }
#filters { display: none; }
body.filters-open #filters { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 7; flex-direction: column; align-items: stretch; gap: 12px; max-height: 80vh; overflow-y: auto; padding: 14px 12px calc(14px + env(safe-area-inset-bottom)); background: var(--panel); border-top: 1px solid var(--hairline); border-radius: 12px 12px 0 0; }
#f-q { flex: 0 0 auto; min-width: 0; min-height: 44px; font-size: 1rem; }
.f-chip { min-height: var(--ctl-h); }
#f-clear { margin-left: 0; }
#f-apply { display: inline-flex; align-items: center; margin-left: auto; }
#palette { padding: 0; align-items: stretch; }
#pal-box { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; padding: calc(10px + env(safe-area-inset-top)) 12px calc(10px + env(safe-area-inset-bottom)); }
#pal-input { min-height: 44px; font-size: 1rem; }
.pal-row { min-height: 44px; align-items: center; }
}
/* #369 one motion layer: the data-motion attribute on the root decides which loops run, the token
block above decides how fast, and every ambient rule is opt-in, so a document with no attribute
paints no ambience and a poll that rewrites a card's content never restarts a loop the head or the
dot owns. live adds the breathing dot, the head glow and the newest-line shine; #377 leaves one mode
live and one floor, so the system ask is the only none. #413 the card's progress line is information,
so its geometry paints in both modes and only its shine rides the live gate */
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
/* #403 the head glow: one cycle covers every station, one slot per station, and the boundaries are 1/7
   of the cycle, so a station added later updates these percentages with the station count */
@keyframes headWave { 0% { transform: translateX(-100%); opacity: 0; } 1% { opacity: 1; } 13% { opacity: 1; } 14.2857% { transform: translateX(500%); opacity: 0; } 100% { transform: translateX(500%); opacity: 0; } }
[data-motion="live"] .spin { animation: breathe var(--t-breathe) var(--ease-breathe) infinite; }
[data-motion="live"] #relations path { animation: dashflow var(--t-breathe) linear infinite; animation-direction: reverse; }
[data-motion="live"] .st-head::after { animation: headWave var(--t-wave) linear infinite; animation-delay: calc(var(--i, 0) * var(--t-slot)); }
html.motion-paused .st-head::after { animation-play-state: paused; }
.card.running { --p: 0; }
.card.running::after { content: ""; position: absolute; left: 0; bottom: 0; width: 100%; height: 1px; background-color: var(--ac, var(--link)); transform: scaleX(var(--p)); transform-origin: left center; }
[data-motion="live"] .card.running::after { --shine-base: var(--ac, var(--link)); background-image: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, var(--shine-hi) var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%); background-size: 300% 100%; background-repeat: no-repeat; animation: shimmer var(--t-breathe) linear infinite; }
/* #369 the floor: none disables every animation and transition, the inlined FLIP travel included,
and the system ask turns everything off whatever the stored choice says; one block, not five */
[data-motion="none"] *, [data-motion="none"]::before, [data-motion="none"] *::before, [data-motion="none"] *::after { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { [data-motion] *, [data-motion]::before, [data-motion] *::before, [data-motion] *::after { animation: none !important; transition: none !important; } }
`;
