---
name: "fix: spinner and animated height while task details load"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "user"
complexity: "simple"
shortName: "task-detail-spinner"
---

# Summary
Task detail modal polish: show a spinner while the detail fetch runs (instead of only the text placeholder) and animate the modal height growing when the content arrives. CSS-only, no libraries.

# Specs
## Goal
The task detail modal shipped by #242 (commit 95843be) shows a "Loading task details…" text placeholder while the detail fetch runs, then jumps to full height when content arrives. Decided UX: a spinner while loading, and the modal height grows with animation when the content arrives.

## Facts (current state)
- src/webui/page.ts openTask: renders the modal shell from the light row, shows a "Loading task details…" placeholder in the body, fetches GET /api/task-detail?num=N on every open with no client-side cache, discards a superseded open's response with a generation counter, and shows "Task details failed to load" on failure.
- The modal markup and CSS live in the PAGE template string (src/webui/page.ts); no frameworks, no animation libraries.

## Required changes
1. Loading state: show a spinner while the detail fetch runs, alongside the existing "Loading task details…" label. CSS-only spinner, no libraries, no images.
2. Height animation: when the detail arrives, animate the modal height from the loading height to the content height (CSS transition on height or max-height; no libraries). The modal must not jump.
3. Failure state: the spinner stops, the inline error shows; no growth animation on failure.
4. Do not change the fetch behaviour (every open fetches, no cache, supersede guard stays).

## Constraints
- Keep the template-string client; no new dependencies.
- Do not touch the /api endpoints, the agent log pane (#243), the board cards (#245), or the poll/notify logic (#244).

## Acceptance criteria
- `pnpm test` passes with no regressions.
- Manual check (live test): open a task with the webui open; a spinner shows while the details load, and the modal height grows with a smooth animation when the content arrives; on a failed fetch the spinner stops and the inline error shows.

# Notes
