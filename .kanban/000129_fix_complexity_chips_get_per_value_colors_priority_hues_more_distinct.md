---
name: "fix: complexity chips get per-value colors; priority hues more distinct"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
All complexity chips render one muted style regardless of value. Give each complexity value its own color. Widen the priority chip hue separation too (medium, high and critical are close orange shades that read as the same color).

# Specs
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
