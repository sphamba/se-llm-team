// the served stylesheet and its palette, split out of PAGE so a redesign task edits one block

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
body { display: flex; flex-direction: column; margin: 0; background: var(--canvas); color: var(--text); font-family: ${SANS}; font-size: 0.875rem; }
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
/* 000091: a relative #tabs at z-index 1 keeps the bar above the overlay and clickable while a modal is open; 000119: #modal must sit above #tabs and #relations (both z-index 1) or the relation lines paint over it; 000124: the task cards stack at z-index 2, so #modal bumps to 3 */
#tabs { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 18px 0; }
#tabs:empty { display: none; }
.tab { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px 6px 0 0; padding: 4px 12px; font-size: 0.875rem; cursor: pointer; }
.tab:hover { background: var(--raised); }
.tab.active { border-color: var(--link); color: var(--link); }
#board { flex: 1 1 auto; min-height: 0; display: flex; gap: 10px; padding: 10px 18px 18px; overflow-x: auto; align-items: flex-start; position: relative; }
/* relation lines: absolute in the relative board, so the overlay scrolls with the content; z-index 1
paints them above the static .col/.pair containers and below the z-index-2 task cards, pointer-events
none so the card clicks pass through */
#relations { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; overflow: visible; }
/* 000127: the low opacity keeps the lines a subtle hint behind the semi-transparent cards; hovering either connected card raises it (.relations-hot) */
#relations path { fill: none; stroke: var(--dim); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; animation-direction: reverse; }
#relations path.relations-hot { stroke-opacity: .8; }
@keyframes dashflow { to { stroke-dashoffset: -10; } }
/* 000047: the middle columns stack as groups, sized and gapped like the single columns */
.pair { display: flex; flex-direction: column; gap: 10px; min-width: 300px; flex: 1 0 300px; }
.col { background: var(--panel); border: 1px solid var(--hairline); border-radius: 8px; border-top: 3px solid var(--ac); padding: 10px; min-width: 300px; flex: 1 0 300px; }
/* 000096: as a .pair child the .col basis would act on the height axis and floor it at 300px */
.pair .col { flex: 0 0 auto; }
.col h2 { font-size: 0.8125rem; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 10px; color: var(--dim); }
/* a disabled stage fades the column chrome to 40%; a waiting integration card dims too, because the gate holds it there, while an in-flight integration card keeps full opacity */
.col.off { background: color-mix(in srgb, var(--panel) 40%, transparent); border-color: color-mix(in srgb, var(--hairline) 40%, transparent); border-top-color: color-mix(in srgb, var(--ac) 40%, transparent); }
.col.off h2, .col.off .empty, .col.off .toggle { opacity: .4; }
.col.off.c-to-integration-test .card { opacity: .4; }
.count { font-size: 2rem; font-weight: 500; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); }
/* 000124: positioned above the z-index-1 relation lines; the semi-transparent background lets a line passing under the card show through faintly (no --card var, --panel is the card's base color in both themes) */
.card { position: relative; z-index: 2; background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--hairline); border-left: 3px solid var(--ac); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: color-mix(in srgb, var(--raised) 85%, transparent); }
/* 000320: a task held by the user blockedBy token: the 1px top, right and bottom border turns dashed
at the relation lines' 6-on/4-off rhythm. A plain border-style: dashed cannot do 6/4, so the dashes
paint on a pseudo-element, which .card:hover's background shorthand cannot wipe; the border colors go
transparent so the size, the 3px left accent and the 6px radius stay (the negative insets reach the
border box from the padding box an absolute child is placed in) */
.card.user-hold { border-top-color: transparent; border-right-color: transparent; border-bottom-color: transparent; }
.card.user-hold::after { content: ""; position: absolute; inset: -1px -1px -1px -3px; border-radius: 6px; pointer-events: none; background: repeating-linear-gradient(90deg, var(--hairline) 0 6px, transparent 6px 10px) left top / 100% 1px no-repeat, repeating-linear-gradient(90deg, var(--hairline) 0 6px, transparent 6px 10px) left bottom / 100% 1px no-repeat, repeating-linear-gradient(0deg, var(--hairline) 0 6px, transparent 6px 10px) right top / 1px 100% no-repeat; }
/* 000191: genuinely new cards fade and rise in once at insertion; syncBoard adds .enter only at
creation and the page drops it on animationend, so a poll or a reorder never replays it */
.card.enter { animation: cardIn var(--enter) ease-out; }
@keyframes cardIn { from { opacity: 0; transform: translateY(3px); } }
.name { font-size: 0.9375rem; font-weight: 500; line-height: 1.35; margin-bottom: 6px; }
.num { font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); margin-right: 4px; }
.num-link { color: var(--link); cursor: pointer; }
.num-link:hover { text-decoration: underline; }
.spin { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border: 2px solid var(--hairline); border-top-color: var(--text); border-radius: 50%; vertical-align: 0px; animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } #relations path, #agent-relations path { animation: none; } }
.chip { font-size: 0.75rem; padding: 1px 7px; border-radius: 999px; background: var(--hairline); color: var(--text); }
.chip.issuer { background: var(--code-bg); color: var(--dim); }
.chip.cx { background: var(--code-bg); color: var(--dim); }
.issued { color: var(--dim); }
.card-stats { display: block; font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); margin-top: 6px; animation: statsIn var(--fade) ease-out; }
/* 000264: lazily-fetched stats fade in when the span joins (syncCardStats); the height shift glides via the FLIP diff */
@keyframes statsIn { from { opacity: 0; transform: translateY(2px); } }
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
.toggle { display: block; width: 100%; margin-top: 2px; border: 1px solid var(--hairline); background: var(--panel); color: var(--link); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 0.875rem; }
.toggle:hover { background: var(--raised); }
/* 000120: each run as a card, its subagent cards stacked below it in the same column;
   000238: the main view card's translucent rest background lets the relation lines show through
   faintly, hover and active keep their own looks */
.agent-card { display: block; border: 1px solid var(--hairline); background: color-mix(in srgb, var(--panel) 85%, transparent); color: var(--text); border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 0.875rem; text-align: left; position: relative; z-index: 2; }
.agent-card:hover { background: var(--raised); }
/* 000191: a genuinely new run card rises in with the board cards' entrance */
.agent-card.enter { animation: cardIn var(--enter) ease-out; }
.agent-card-active { border-color: var(--link); background: color-mix(in srgb, var(--link) 20%, var(--panel)); }
.agent-stats { display: block; font-size: 0.75rem; font-family: ${MONO}; font-variant-numeric: tabular-nums; color: var(--dim); margin-top: 2px; }
.agent-col { display: flex; flex-direction: column; gap: 8px; }
.agent-subs { display: flex; flex-direction: column; gap: 8px; }
.agent-subs:empty { display: none; }
#m-agent-btns { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; }
#m-doctor { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; margin-top: 8px; }
#m-doctor:empty { display: none; }
/* 000353: run and sub cards read their role's stage accent and the stage's darker label step;
at rest only the text and check mark take the color and the plain .agent-card outline and panel
background show through, while the opened card keeps the role-colored outline and a 20% panel mix
via .agent-card-active */
.agent-doctor { color: var(--accent-done-text); }
.agent-doctor.agent-card-active { border-color: var(--accent-done); background: color-mix(in srgb, var(--accent-done) 20%, var(--panel)); }
.agent-doctor .check { color: var(--accent-done); }
.agent-splitter { color: var(--accent-backlog-text); }
.agent-splitter.agent-card-active { border-color: var(--accent-backlog); background: color-mix(in srgb, var(--accent-backlog) 20%, var(--panel)); }
.agent-splitter .check { color: var(--accent-backlog); }
.agent-developer { color: var(--accent-todo-text); }
.agent-developer.agent-card-active { border-color: var(--accent-todo); background: color-mix(in srgb, var(--accent-todo) 20%, var(--panel)); }
.agent-developer .check { color: var(--accent-todo); }
.agent-reviewer { color: var(--accent-review-text); }
.agent-reviewer.agent-card-active { border-color: var(--accent-review); background: color-mix(in srgb, var(--accent-review) 20%, var(--panel)); }
.agent-reviewer .check { color: var(--accent-review); }
.agent-merger { color: var(--accent-merge-text); }
.agent-merger.agent-card-active { border-color: var(--accent-merge); background: color-mix(in srgb, var(--accent-merge) 20%, var(--panel)); }
.agent-merger .check { color: var(--accent-merge); }
.agent-livetest { color: var(--accent-live-text); }
.agent-livetest.agent-card-active { border-color: var(--accent-live); background: color-mix(in srgb, var(--accent-live) 20%, var(--panel)); }
.agent-livetest .check { color: var(--accent-live); }
.agent-integration { color: var(--accent-integration-text); }
.agent-integration.agent-card-active { border-color: var(--accent-integration); background: color-mix(in srgb, var(--accent-integration) 20%, var(--panel)); }
.agent-integration .check { color: var(--accent-integration); }
/* 000353: a dead run turns the whole card red; two classes beat every role rule above, so the
label, the outline and the active tint all lose to the failed-run red */
.agent-card.agent-dead { color: var(--error-text); border-color: var(--error); background: color-mix(in srgb, var(--error) 15%, var(--panel)); }
/* 000276: the sub, splitter and doctor cards read at the meta step, one step under the role cards */
.agent-sub, .agent-splitter, .agent-doctor { font-size: 0.75rem; }
.check { color: var(--low-fg); margin-right: 5px; }
.cross { color: var(--error-text); margin-right: 5px; }
#m-agent { position: relative; z-index: 0; margin-bottom: 12px; }
/* 000237: the detail card's relation lines, behind the cards: the agent area is the svg's offset
parent and its own stacking context (z-index 0), so the z-index-2 agent cards stay under the
sticky #m-head while the svg (z-index 1) paints under them; pointer-events none lets the card
clicks through, the canvas fills the area, the paths carry the geometry; 000304: the layer paints
outside the area box, bounded by the dialog card's border */
#agent-relations { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; overflow: visible; }
#agent-relations path { fill: none; stroke: var(--dim); stroke-width: 1.5; stroke-opacity: .3; stroke-dasharray: 6 4; animation: dashflow 1s linear infinite; transition: stroke-opacity .15s ease; }
#agent-relations path.relations-hot, #agent-relations path.relations-sel { stroke-opacity: .8; }
/* 000152: the pane grows to 70vh so long logs show more content; 000304: its own layer keeps it
above the connector svg */
#m-log { position: relative; z-index: 2; margin-top: 6px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--code-bg); max-height: 70vh; overflow: auto; }
#m-log.hidden { display: none; }
/* 000191: the pane fades and rises on open */
#m-log:not(.hidden) { animation: logIn var(--enter) ease-out; }
@keyframes logIn { from { opacity: 0; transform: translateY(4px); } }
/* 000194: the matching close, after the entrance rule so the equal-specificity logOut wins */
#m-log.closing { animation: logOut var(--exit) ease-in forwards; }
@keyframes logOut { to { opacity: 0; transform: translateY(4px); } }
#m-log-meta { padding: 6px 10px 0; font-size: 0.75rem; line-height: 1.45; color: var(--dim); font-family: ${MONO}; font-variant-numeric: tabular-nums; }
#m-log-meta.hidden { display: none; }
/* the log text renders in IBM Plex Mono at the log step; blocks are collapsed <details> the client fills in */
#m-log-text { margin: 0; padding: 8px 10px; font-size: 0.8125rem; line-height: 1.45; font-family: ${MONO}; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text pre { font: inherit; margin: 0; padding: 0; white-space: pre-wrap; overflow-wrap: break-word; }
#m-log-text details { margin: 2px 0; }
#m-log-text summary { cursor: pointer; }
#m-log-text details.lg-think, #m-log-text details.lg-tool { color: var(--dim); }
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
#m-log-text > .pulse, #m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { --shine-base: var(--text); background-image: linear-gradient(90deg, var(--shine-base) 0%, var(--shine-base) 33%, color-mix(in srgb, var(--shine-hi) var(--shine), var(--shine-base)) 50%, var(--shine-base) 67%, var(--shine-base) 100%); background-size: 300% 100%; background-repeat: no-repeat; -webkit-background-clip: text; background-clip: text; color: transparent; animation: chunkIn var(--fade) ease-out, shimmer var(--pulse) linear infinite; }
#m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { --shine-base: var(--dim); }
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
@media (prefers-reduced-motion: reduce) { #m-log-text > .pulse { background-image: none; color: var(--text); } #m-log-text > details.lg-think.pulse, #m-log-text > details.lg-tool.pulse { background-image: none; color: var(--dim); } }
/* 206/207: the close header is sticky at every width, mobile and desktop: sticky is clamped to the
containing block, so #m-box drops its top padding and #m-head carries it (else the header pins 18px
down and scrolled text peeks above it); its own bottom padding keeps 10px clearance under the title
while content scrolls */
#m-box { background: var(--panel); border-radius: 10px; padding: 0 18px 18px; width: min(760px, calc(100vw - 32px)); max-height: 82vh; overflow-y: auto; overflow-x: hidden; }
/* 000246: the detail arrival grows the modal from the loading height pinned by openTask to the
content height; the class drops at the transition end, and reduced motion keeps the instant resize */
#m-box.grow { transition: height var(--enter) ease-out; }
@media (prefers-reduced-motion: reduce) { #m-box.grow { transition: none; } }
#m-head { display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; margin-bottom: 0; padding: 18px 0 10px; background: var(--panel); z-index: 1; }
#m-head h2 { font-size: 1.0625rem; font-weight: 500; margin: 0; }
#m-close { border: 1px solid var(--hairline); background: var(--panel); color: var(--text); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 0.875rem; }
#m-close:hover { background: var(--raised); }
#m-attrs { font-size: 0.875rem; color: var(--text); margin-bottom: 12px; }
#m-attrs div { padding: 3px 0; }
#m-attrs span:not(.chip):not(.num-link) { display: inline-block; min-width: 80px; color: var(--dim); }
#m-actions { display: flex; justify-content: flex-start; margin-bottom: 12px; }
#m-actions:empty { display: none; }
.m-action { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 4px 12px; font-size: 0.875rem; font-family: inherit; cursor: pointer; }
/* #364 keyboard focus: every element the stylesheet marks with cursor: pointer answers Tab with the
same visible ring, so the pointer cue is never the only cue */
#theme:focus-visible, .tab:focus-visible, .card:focus-visible, .num-link:focus-visible, .toggle:focus-visible, .agent-card:focus-visible, #m-log-text summary:focus-visible, #m-close:focus-visible, .m-action:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
.m-action:disabled { opacity: 0.6; cursor: default; }
.m-block { color: var(--error-text); border: 1px solid var(--error); background: color-mix(in srgb, var(--error) 15%, var(--panel)); }
.m-unblock { color: var(--accent-done-text); border: 1px solid var(--accent-done); background: color-mix(in srgb, var(--accent-done) 15%, var(--panel)); }
#m-body { font-size: 0.875rem; line-height: 1.5; }
#m-body h1, #m-body h2, #m-body h3 { font-size: 0.9375rem; font-weight: 500; margin: 12px 0 4px; }
#m-body ul { margin: 4px 0; padding-left: 20px; }
/* #310 quoted covered-task summaries render as blockquotes: a subtle left border, small left
padding and the soft colour, with a vertical margin only so the paragraphs around it do not shift */
#m-body blockquote { border-left: 3px solid var(--hairline); padding-left: 10px; margin: 4px 0; color: var(--dim); }
#m-body pre { background: var(--code-bg); border-radius: 6px; padding: 8px 10px; overflow: auto; font-size: 0.8125rem; }
#m-body code { background: var(--code-bg); border-radius: 4px; padding: 0 4px; font-size: 0.8125rem; }
#m-body pre code { padding: 0; background: none; }
/* 000153: the pane is already mono, so the inline and fenced code inside the dialog and the log keep the same mono stack and only drop the code surface */
#m-log-text code, #m-log-text pre code, #m-body code, #m-body pre { font-family: ${MONO}; }
#m-body a { color: var(--link); }
/* #291 md() tables in the dialog and the log pane: the wrapper scrolls on its own, cells stay on
one line, and the leftmost column pins left with a static right border as the cue */
.md-table-wrap { overflow-x: auto; }
.md-table-wrap table { border-collapse: collapse; }
.md-table-wrap th, .md-table-wrap td { white-space: nowrap; text-align: left; padding: 3px 10px; border-bottom: 1px solid var(--hairline); }
.md-table-wrap .md-pin { position: sticky; left: 0; background: var(--panel); border-right: 1px solid var(--hairline); }
/* the log pane sits on the code background, not the dialog panel, so its pinned column matches the pane */
#m-log-text .md-table-wrap .md-pin { background: var(--code-bg); }
/* one accent per stage, in pipeline order; the waiting and working states of a stage share it */
.c-backlog { --ac: var(--accent-backlog); }
.c-to-do, .c-doing { --ac: var(--accent-todo); }
.c-to-review, .c-reviewing { --ac: var(--accent-review); }
.c-to-merge, .c-merging { --ac: var(--accent-merge); }
.c-to-live-test, .c-live-testing { --ac: var(--accent-live); }
.c-to-integration-test, .c-integration-testing { --ac: var(--accent-integration); }
.c-done { --ac: var(--accent-done); }
/* 204: mobile, the root font size 15% smaller so every rem-based size scales down with it */
@media (max-width: 600px) { html { font-size: 85%; } }
/* 205: mobile, the task details popup is a full-screen sheet, flush with all four sides; the vh
line is the fallback for the dvh line (older mobile browsers), max-height none lifts the 82vh cap */
@media (max-width: 600px) { #m-box { width: 100vw; margin: 0; border-radius: 0; height: 100vh; height: 100dvh; max-height: none; } }
`;
