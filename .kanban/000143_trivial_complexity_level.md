---
name: "feat: trivial complexity level with 0 reviewer steps by default"
priority: "medium"
state: "reviewing"
worktree: "feat/143-trivial-complexity-level"
blockedBy: ""
issuer: "user"
complexity: "complex"
shortName: "trivial-complexity-level"
---

# Summary
Add a fourth complexity level "trivial" that skips reviewer passes entirely by default (0 reviewer steps), wired through the kanban tooling, the orchestrator's reviewer cap and the webui chip colors.

# Specs
Current facts: src/kanban.ts:22 COMPLEXITIES = ["simple", "moderate", "complex"], unknown values normalize to "moderate" (parseTask :152, createTask :334-336); index.ts:67,95 Type.Optional(StringEnum(["simple", "moderate", "complex"])); src/orchestrator.ts:36 DEFAULT_REVIEWER_CAP = { simple: 1, moderate: 2, complex: 3 } with validation at :110-121 rejecting v < 1 (log "invalid reviewerCap.<cx> ... ignored (expected an integer >= 1)"); consumeReviewerRun's cap check at :944-946 (const cap = cfg.reviewerCap[task.complexity] ?? REVIEWER_RUN_CAP, then readCounter >= cap forces to-live-test; readCounter returns 0 when missing); the reviewer-armed marker is written only in the spawn branch (:968-969) and consumeReviewerRun (:343-355) returns early with "no reviewer armed" so a to-review arrival from the developer or the board is unbroken. Webui per-value chips: .chip.cx-simple/.cx-moderate/.cx-complex at src/webui.ts:967-969 with emission sites board :739 and detail :1210 (esc(t.complexity || "moderate")).

Changes:
- src/kanban.ts: COMPLEXITIES gains "trivial"; unknown values still normalize to "moderate".
- index.ts: both StringEnum lists gain "trivial"; the create description text stays accurate.
- src/orchestrator.ts: DEFAULT_REVIEWER_CAP gains trivial: 0; relax the reviewerCap validation from "integer >= 1" to "integer >= 0" (non-integer or negative still warns and keeps the default, same pattern); verify the cap-0 path: a trivial task arriving at to-review hits readCounter (0) >= cap (0) on the first sweep and moves straight to to-live-test without spawning a reviewer, and consumeReviewerRun's no-reviewer-armed early return keeps that arrival unbroken.
- skills/se-llm-team/SKILL.md: the complexity guidance gains trivial (docs-only or micro changes, no reviewer passes) and the "(1 pass for simple, 2 for moderate, 3 for complex)" parenthetical gains "0 for trivial".
- src/webui.ts: add .chip.cx-trivial at :969b with a calm grey/blue readable in both themes, keeping the .chip.cx base fallback; the emission sites pick it up automatically.
- No other behavior changes: simple/moderate/complex caps and flows stay byte-identical, and the roles loop iterating COMPLEXITIES (:101) picks trivial up consistently.

Tests: a cap-0 trivial task goes to-review -> to-live-test with no reviewer spawn (assert no armed marker, no reviewer pid file); reviewerCap.trivial = 0 is accepted while -1 and 1.5 warn and keep the default; a task with complexity "trivial" round-trips through parseTask; the webui renders cx-trivial for a trivial task; all existing suites stay green.

# Notes

- Implemented in worktree feat/143-trivial-complexity-level, commit 03354bd.
- src/kanban.ts: COMPLEXITIES gains "trivial" (appended last); unknown values still normalize to "moderate".
- index.ts: both complexity StringEnums gain "trivial"; the kanban_create description now lists trivial and notes it gets no reviewer pass.
- src/orchestrator.ts: DEFAULT_REVIEWER_CAP gains trivial: 0; reviewerCap validation relaxed from integer >= 1 to integer >= 0 with the warning text updated to match. Cap-0 path verified: a trivial task at to-review hits readCounter 0 >= cap 0 on the first sweep and moves straight to to-live-test without spawning a reviewer; consumeReviewerRun's no-reviewer-armed early return keeps the arrival unbroken. Simple/moderate/complex flows unchanged.
- src/webui.ts: added .chip.cx-trivial (calm blue-grey tint rgba(100,130,165,.18) with var(--fg), readable in both themes) after the existing per-value chips; .chip.cx base fallback kept; both emission sites pick it up automatically.
- skills/se-llm-team/SKILL.md and README.md: complexity guidance and reviewerCap docs now cover trivial (docs-only or micro changes, no reviewer pass, cap 0, invalid < 0 warns).
- Tests: orchestrator.test.ts part AJ-b covers the cap-0 to-review -> to-live-test flow (no reviewer spawn, no armed marker, no pid file, counter reads 0), reviewerCap.trivial = 0 accepted while -1 and 1.5 warn and keep the default, and the trivial round-trip through parseTask. Part AJ updated to use -1 as its invalid fixture (its old 0 fixture is valid under the relaxed rule). kanban.test.ts covers the trivial round-trip, webui.test.ts covers the cx-trivial chip and css, extension.test.ts covers trivial schema validation. All four suites pass (orchestrator, kanban, webui, extension, all exit 0).

# Open questions
