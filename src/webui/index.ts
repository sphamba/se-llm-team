// the public API of the old single-file webui module, one barrel so imports stay stable
export { esc, logFixups, LOG_LINES, md, renderLogChunk } from "./logpane.ts";
export {
	agentLabel,
	agentRowSig,
	agentStatsText,
	buildShell,
	cardBaseHtml,
	cardHtml,
	curve,
	doctorCol,
	flipDiff,
	fmtDur,
	fmtTokens,
	LAYOUT,
	numLinkHtml,
	pairLayout,
	relationPaths,
	spinnerHtml,
	syncAgentStats,
	syncBoard,
	syncCardStats,
	syncDoctorCards,
	syncStatsLine,
	taskStats,
	taskStatsText,
} from "./board.ts";
export { agentLogPayload, cardStatsPayload, taskDetail, taskHistory, taskPayload } from "./payload.ts";
export { boardOf, loadWebUiConfig, mergeBoards, PAGE, refreshMs, tabNames, tabsHtml, type WebUiConfig } from "./page.ts";
