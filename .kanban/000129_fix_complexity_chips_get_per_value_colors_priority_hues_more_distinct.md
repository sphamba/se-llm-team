---
name: "fix: complexity chips get per-value colors; priority hues more distinct"
priority: "medium"
state: "done"
worktree: ""
complexity: "simple"
blockedBy: ""
---

# Summary
All complexity chips render one muted style regardless of value. Give each complexity value its own color. Widen the priority chip hue separation too (medium, high and critical are close orange shades that read as the same color).

# Specs
# User observation (2026-10-12)

The user sees ALL complexity chips black in dark mode and all grey in light mode. That is the current .chip.cx { background: var(--code-bg); color: var(--muted) } style reading as near-black (dark theme) / grey (light theme) for every value. The per-value colors below must fix exactly this: each value clearly distinct and clearly visible in both themes, not a near-invisible dark chip.

# 1. Complexity chips per value

Both emission sites (board card src/webui.ts ~:557, detail card ~:996) emit one class chip cx for every value. Emit chip cx cx-<complexity> (esc(t.complexity || "moderate")) at both sites and add per-value colors:

- cx-simple: a calm green/blue, cx-moderate: orange, cx-complex: red-ish. Reuse the existing priority palette vars (--low-fg/--medium-fg/--critical-fg with their -bg backgrounds) or add three new vars per theme - one approach.
- Colors must read in both themes (light block ~:433, dark block ~:726). The base .chip.cx rule can stay as the fallback for an unknown value.

# 2. Priority chips more distinct

The p-low..p-critical colors exist and differ, but medium (#ffb454), high (#ff8f40) and critical (#d95757 in light / #e65050 in dark) sit close together. Shift the hues further apart so each priority reads at a glance - e.g. keep low green, medium yellow-orange, high orange-red, critical strong red, in both themes. Adjust the -bg tints to match.

# Tests

src/webui.test.ts: the board and detail markup carry cx-<value> and p-<value> classes. Files: src/webui.ts and src/webui.test.ts only.

# 1. Complexity chips per value

Both emission sites (board card src/webui.ts ~:557, detail card ~:996) emit one class chip cx for every value. Emit chip cx cx-<complexity> (esc(t.complexity || "moderate")) at both sites and add per-value colors:

- cx-simple: a calm green/blue, cx-moderate: orange, cx-complex: red-ish. Reuse the existing priority palette vars (--low-fg/--medium-fg/--critical-fg with their -bg backgrounds) or add three new vars per theme - one approach.
- Colors must read in both themes (light block ~:433, dark block ~:726). The base .chip.cx rule can stay as the fallback for an unknown value.

# 2. Priority chips more distinct

The p-low..p-critical colors exist and differ, but medium (#ffb454), high (#ff8f40) and critical (#d95757 in light / #e65050 in dark) sit close together. Shift the hues further apart so each priority reads at a glance - e.g. keep low green, medium yellow-orange, high orange-red, critical strong red, in both themes. Adjust the -bg tints to match.

# Tests

src/webui.test.ts: the board and detail markup carry cx-<value> and p-<value> classes. Files: src/webui.ts and src/webui.test.ts only.

# Complexity

simple (user-ordered complexity assignment; single-file styling change).

# Notes

- Implemented in worktree fix/129-complexity-chips-get, commit dd25b25. Both emission sites (board cardHtml, detail attrsHtml in src/webui.ts) now emit `chip cx cx-<complexity>` with esc(t.complexity || "moderate"). Added .chip.cx-simple/.cx-moderate/.cx-complex rules reusing the priority palette vars (green/yellow/red); base .chip.cx stays as fallback for unknown values.
- Priority hues widened: dark medium #ffb454 -> #ffd173 (yellow), dark critical #d95757 -> #ff5252 (strong red), light medium #eba400 -> #c99700 (deeper yellow); -bg tints updated to match. Light high/critical and dark high kept (gaps now read apart: green/yellow/orange/red).
- src/webui.test.ts updated: board and detail markup assert the cx-<value> class (incl. escaped unknown value), the per-value css rules ship in the page, and the updated detail emission string. Full suite passes (node --experimental-strip-types --test, all 5 test files, 0 fail).
- Note: the task's quoted line numbers were stale (emission sites are at ~:725 board, ~:1194 detail; theme blocks ~:599 dark, ~:901 light); followed the spec text, not the numbers. No open questions.
- Review (2026-10-12): pass, no fixes. Verified both emission sites emit `chip cx cx-<value>` (board cardHtml ~:723, detail attrsHtml ~:1197); per-value rules ship after the base `.chip.cx` fallback (:947 vs :954-956), same specificity, so unknown values like `cx-&lt;x&gt;` fall through to the base rule. Priority hues read green -> yellow -> orange -> red in both themes, -bg tints match their fg. Full suite passes (5 files, 0 fail). Only src/webui.ts and src/webui.test.ts touched, as the spec requires. cx-moderate follows the priority medium hue (yellow after the spec 2 shift) since the spec's chosen approach reuses the priority palette; the green/yellow/orange/red set stays clearly distinct, so accepted.
- Live test (2026-10-12): pass, no issues. Served the worktree's exact PAGE/taskPayload from a standalone harness (127.0.0.1:4399, imports src/webui.ts from the worktree, real board data; the :4242 hub still serves main until merge) and drove headless Chromium.
  - Board: all 133 rendered cards carry `chip cx cx-<value>` (125 moderate default, 6 simple, 2 complex); no bare `.chip.cx` remains. Priority: 69 medium, 32 low, 26 high, 6 critical, all `p-<value>`.
  - Computed chip colors, light: cx-simple/p-low #86b300, cx-moderate/p-medium #c99700, cx-complex/p-critical #e65050, p-high #fa8532. Dark: cx-simple/p-low #aad94c, cx-moderate/p-medium #ffd173, cx-complex/p-critical #ff5252, p-high #ff8f40. Same values via the explicit theme toggle, the `prefers-color-scheme: dark` media query, and after a reload (localStorage theme persists). The old near-black dark-mode complexity chip is gone.
  - Detail modal opened for a simple, a moderate and a complex task in both themes: the complexity chip carries the matching cx class and per-value colors, matching the card.
  - Distinctness (OKLab dE): adjacent priority pairs light 11.8/9.8/13.0, dark 13.0/15.1/12.8, all above the old medium-high 8.2 (light) / 8.3 (dark). Complexity pairs light 11.8/18.4, dark 13.0/27.2.
  - Contrast (composited chip fg vs tint over the card): dark 4.67-8.76, improved where touched (dark medium 7.44 -> 8.64, dark critical 3.94 -> 4.67). Light 2.17-3.10; medium improved 1.90 -> 2.31 and low/high are unchanged at 2.19/2.17, so the low light-mode contrast is the pre-existing tinted-pill palette, legible at 12px in the screenshots and not a regression.
  - No console errors, page errors or failed requests over a poll cycle and a modal open. Hand-edited complexity values (e.g. `trivial`, markup) are normalized to moderate by the parser (src/kanban.ts:152), so the emitted class always gets a valid value; esc() at both emission sites still covers a bypass.
  - No open questions, no new tasks to create.