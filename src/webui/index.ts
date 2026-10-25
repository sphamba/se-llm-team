// the public API of the old single-file webui module, one barrel so imports stay stable
export { esc, logFixups, LOG_LINES, md, renderLogChunk } from "./logpane.ts";
export {
	agentLabel,
	agentRowSig,
	agentStatsText,
	applyStages,
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
export { CSS } from "./theme.ts";
export { boardOf, DEFAULT_STAGES, loadWebUiConfig, mergeBoards, PAGE, refreshMs, tabNames, tabsHtml, type StageFlags, type WebUiConfig } from "./page.ts";
