---
name: "fix: clear agent log panel while the new log loads"
priority: "medium"
state: "doing"
worktree: "fix/243-clear-agent-log-loading"
issuer: "user"
complexity: "simple"
shortName: "clear-agent-log-loading"
---

# Summary
When an agent log is opened, clear the log panel text and show a loading state until the new log arrives, so the previously opened agent's log is never visible while loading (and never on fetch failure either).

# Specs
## Goal
When a user opens an agent's log in the webui, the log panel must never show a previously opened agent's log while the new log loads.

## Current behaviour (measured)
- src/webui/page.ts:826 openLog unhides the pane immediately and clears only the meta line; #m-log-text is never cleared and no loading state is shown, so the previous agent's log stays visible until the init payload arrives and ingest() replaces innerHTML (:896).
- pullLog (:877) swallows fetch failures (.catch(() => {})), which leaves the stale text forever.
- Not a race: pullLog's guard (:884) already blocks superseded fetches.

## Decided direction (user)
Clear text + loading state: on open, the text is cleared and a loading indicator shows; it stays if the fetch fails. Not the delayed-reveal alternative.

## Required changes
1. On openLog, clear #m-log-text immediately and show a loading state (text such as "Loading...") until the first init payload arrives.
2. On fetch failure, keep the loading state visible; never fall back to the previous agent's content and never hide the pane silently.
3. Client-only change: no server endpoint changes, no log file format changes.

## Constraints
- Keep the template-string client; no new dependencies.
- Do not change the /api/agent-log endpoint or pullLog's supersede guard.

## Acceptance criteria
- `pnpm test` passes with no regressions.
- Manual check (live test): open two different agents' logs in sequence in the browser; the second panel must show the loading state (not the first agent's log) while fetching, then render the second agent's log.

# Notes
