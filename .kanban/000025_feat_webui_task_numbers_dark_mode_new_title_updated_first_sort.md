---
name: "feat: webui task numbers, dark mode, new title, updated-first sort"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Four webui changes in src/webui.ts: show the task number (#42 style), add a dark mode toggle that defaults to the browser preference, retitle to "Software Engineering LLM Team", and sort cards with most recently updated on top.

# Specs
Four changes, all in src/webui.ts:

1. Task number:
- The /api/tasks payload includes `file` (for example `000042_fix_....md`). Derive the number from the leading digits of the file name (strip leading zeros: 000042 → 42).
- Show `#42` on each card before the name, and in the modal (with the attrs).

2. Dark mode toggle, defaulting to the browser default:
- Convert the hardcoded colors (body, header, #updated, .col, .card, .chip palette, #modal overlay, #m-box, #m-attrs, code blocks) to CSS variables.
- Light palette is the base; a dark palette applies through `@media (prefers-color-scheme: dark)`.
- Add a toggle button in the header that switches light ↔ dark. Store the choice in localStorage; on load apply the stored choice if present, otherwise leave the browser default.

3. Title:
- `<title>se-llm-team board</title>` → `<title>Software Engineering LLM Team</title>`.
- `<h1>se-llm-team</h1>` → `<h1>Software Engineering LLM Team</h1>`.

4. Updated-first sort:
- Add `updated` (epoch milliseconds from the task file mtime, via statSync) to the /api/tasks payload.
- In render(), sort each column's cards by `updated` descending, so the most recently updated task is on top.

Acceptance:
- Existing webui tests pass; extend the smoke test in src/webui.test.ts with the `updated` field in the payload.
- The page shows the new title, `#N` on cards, the toggle, and sorted cards.

Constraints:
- Only src/webui.ts and src/webui.test.ts change.

# Notes
