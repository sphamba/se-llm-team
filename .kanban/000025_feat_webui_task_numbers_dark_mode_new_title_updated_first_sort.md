---
name: "feat: webui task numbers, dark mode, new title, updated-first sort"
priority: "medium"
state: "done"
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

- Implemented all four specs in src/webui.ts (commit ce6a567 in the worktree):
- Task number: client helper `num` derives `#N` with `parseInt(t.file, 10)` (stops at the first non-digit, strips leading zeros). Shown in a `.num` span before the card name and as a `number` row in the modal attrs.
- Dark mode: all hardcoded colors became CSS variables on `:root` (light base). `DARK_VARS` holds the dark palette once and applies it twice: `:root[data-theme="dark"]` for an explicit choice and `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` for the browser default. Header button `#theme` toggles light/dark, persists to localStorage, and on load applies the stored choice only when it is `light` or `dark` (localStorage wrapped in try/catch so a blocked store cannot break the script). Priority chip palettes got dark variants too.
- Title: `<title>` and `<h1>` are now `Software Engineering LLM Team`.
- Updated-first: `taskUpdated` (statSync mtimeMs, try/catch to 0) added to the /api/tasks payload; render() sorts each column by `updated` descending.
- src/webui.test.ts extended: `updated` equals the task file's statSync mtimeMs, page shows the new title and `id="theme"`.
- Verification: node src/webui.test.ts, node src/kanban.test.ts, node src/orchestrator.test.ts all pass; live server check confirmed title, h1, dark vars (exactly one `:root[data-theme="dark"]` block), media query, no unexpanded interpolation, and payload keys `file,name,priority,state,worktree,updated,body`.
- Review (state reviewing, commit ce6a567): no fixes needed. Checked against the specs: `num` gives `#25` from `000025_...` and renders before the card name and in the modal attrs; every listed hardcoded color now uses a CSS variable (column accent colors stay light-only, not in the spec list, and remain readable on dark); the dark palette applies twice as documented and the media query is excluded when the stored choice is light; toggle, localStorage persistence and load-time restore match the spec; `<title>` and `<h1>` are the new name; payload carries `updated` (statSync mtimeMs) and render() sorts each column descending on a filtered copy (no mutation of the shared list). Constraints hold: only src/webui.ts and src/webui.test.ts changed. Re-ran all three test files: pass. Independent live-server check confirmed title, h1, `id="theme"`, exactly one explicit dark block, media query, no unexpanded interpolation, and payload keys `file,name,priority,state,worktree,updated,body`. Known non-issue: a hand-placed unnumbered .md file would show `#NaN` (pipeline always creates `0000NN_` names; spec does not define that case).
- Live test (state done): PASS, 21/21 checks, no issues found. Ran the webui from the worktree (node startWebUi against the real project root, port 4599; the pre-existing orchestrator instance on 4242 still serves the old code and is untouched). Headless Chromium (Playwright) exercised every flow like a user:
  - Title: `<title>` and `<h1>` are "Software Engineering LLM Team".
  - Task numbers: `.num` shows `#N` before each card name (checked first 8 cards against `parseInt(file, 10)`); modal opens on card click with a `number  #29` row plus file/name/priority/state/worktree rows and a rendered body; Close button and overlay click both hide the modal.
  - Dark mode: on a light-pref browser the light palette applies by default (body rgb(241,245,249)) and the button reads Dark; one click flips to `data-theme="dark"`, dark body bg rgb(15,23,42), dark chip palette rgb(30,58,138), button reads Light, localStorage theme=dark; after reload the stored dark is reapplied. On a dark-pref browser with empty storage no data-theme is set and the dark palette applies through the media query; toggling to light stores light and survives reload with the media query correctly excluded.
  - Updated-first sort: for every non-empty column the DOM card order equals the /api/tasks order sorted by `updated` descending (payload carries file,name,priority,state,worktree,updated,body; 29 tasks).
  - Screenshots at /tmp/webui-light.png, /tmp/webui-dark.png, /tmp/webui-modal.png; test script /tmp/webui-livetest.js. Test server shut down afterwards.
