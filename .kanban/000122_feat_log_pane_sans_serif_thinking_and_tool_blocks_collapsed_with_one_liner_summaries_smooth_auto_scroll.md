---
name: "feat: log pane sans serif; thinking and tool blocks collapsed with one-liner summaries; smooth auto-scroll"
priority: "medium"
state: "backlog"
worktree: "feat/122-log-pane-sans"
blockedBy: "#52"
---

# Summary
Log-pane rework: sans serif log text, thinking blocks and tool calls collapsed by default (tool summaries show the tool name plus a one-liner detail, full args/output inside, errors surfaced), and smooth live auto-scrolling with a prefers-reduced-motion fallback.

# Specs
Rework the agent log pane in the task detail card per user decisions: (1) Sans serif text: the log text (#m-log-text / #m-log CSS in the PAGE string, src/webui.ts) currently renders monospace — switch to the page's sans serif stack. (2) Thinking blocks collapsed by default: group each thinking block (thinking_start through thinking_end) into a collapsible <details> element, collapsed by default, with a "Thinking" summary; streamed thinking deltas append into the details body so expansion shows the full text. (3) Tool call blocks collapsed by default: tool_execution_start renders a collapsible <details> whose summary shows the tool name (shell, read, write, edit, ...) and the one-liner detail — e.g. the first line of the command/input or the file path, capped at ~80 chars; the details body holds the full args and, when tool_execution_end arrives, its text appended into the same block keyed by toolCallId (keep the chunk-local tool dedupe so nothing duplicates across poll windows). Errors stay visible: an error tool_execution_end surfaces its text in the summary (capped) as today. (4) Smooth automatic scrolling: the live auto-scroll to the bottom uses scrollTo({top: scrollHeight, behavior: "smooth"}), falling back to behavior "auto" under prefers-reduced-motion (which already kills the other animations). Keep every existing rendering rule intact: non-sidechain record shapes, the walk-back, handle allowlist, live poll; the #118 backlog task (sidechain content rules in the same dispatch) lands separately — sequence with it and resolve keeping both. Extend src/webui.test.ts: source asserts the sans serif log font, the collapsed <details> markup with tool-name + one-liner summaries and the Thinking summary, error surfacing in the summary, and the smooth-scroll fallback under prefers-reduced-motion. Full suite green: node src/webui.test.ts. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes.

# Notes
