---
name: "feat: agent cards with tokens and duration; subs always visible in the caller column"
priority: "medium"
state: "doing"
worktree: "feat/120-agent-cards-with"
---

# Summary
Rework the detail-card agent history: larger cards per button showing tokens (kilo, e.g. 42k) and duration (runs and subagents), subagent cards always visible stacked under their caller in the same column (fetched for all runs on open), labeled "Sub-<caller role>" without the id string. Server parses usage.totalTokens and record timestamps.

# Specs
In the task detail card, rework the agent history per user decisions: (1) Each button becomes a bit larger card showing the run's tokens in kilo (e.g. "42k" = Math.round(total/1000)+"k") and the duration, next to the existing role and run label. Applies to run cards and subagent cards alike; clicking still serves the same log/transcript as today. (2) Subagent cards are ALWAYS displayed in the same column as their caller: the agent history renders as a horizontal row of columns, each column holding the run card with its subagent cards stacked vertically below — not only after clicking the caller. On openTask, fetch the sub list for every run handle in parallel (sub=list per handle), not only for the clicked run. (3) Subagent card label: "Sub-" + caller role, e.g. "Sub-reviewer", without number and without the random id string. Server side (src/webui.ts): agentHistory entries extend {role, run, alive, handle} with tokens and duration — verified source: run-log records carry ISO timestamp, and turn_end records carry message.usage.totalTokens ({input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost}); sum message.usage.totalTokens across turn_end records (includes cache reads; the provider-reported total) and duration = last record timestamp minus first. The subagentLogs list (sub=list) extends {index, id} with tokens and duration parsed the same way from the subagent .output transcript (assistant records carry usage and timestamp). Keep all existing rules intact: handle allowlist, chunked payload, walk-back, live poll, markActiveAgent live marking, and non-sidechain log rendering unchanged (the #118 subagent-content render fix is a separate backlog task, same file, disjoint region). Extend src/webui.test.ts: agentHistory entries carry tokens/duration; the sub list carries tokens/duration; page markup renders the card shape with tokens/duration and the "Sub-<role>" labels; subs always visible per caller column. Full suite green: node src/webui.test.ts. Files: src/webui.ts, src/webui.test.ts. No orchestrator changes.

# Notes
