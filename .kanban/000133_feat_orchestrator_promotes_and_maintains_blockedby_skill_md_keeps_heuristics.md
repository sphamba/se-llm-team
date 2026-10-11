---
name: "feat: orchestrator promotes and maintains blockedBy; SKILL.md keeps heuristics"
priority: "high"
state: "backlog"
worktree: ""
---

# Summary
Move the strict-rule scheduling from SKILL.md step 6 into the orchestrator: continuous blockedBy-driven promotion (every sweep, all schedulable backlog tasks) and automatic removal of done blocker refs. Heuristics stay in SKILL.md. Minimize lane delays: a finished step promotes the lane successor within seconds, not minutes.

# Specs
# 1. Continuous promotion (src/orchestrator.ts, src/orchestrator.test.ts)

autoSchedule today only fires when NO task is active: it returns while any task is in a non-backlog, non-done state (src/orchestrator.ts ~:1047), arms an idleSince timer, and promotes ONE backlog task per idle window after cfg.autoScheduleMinutes. A task whose blockers just reached done therefore waits for the whole pipeline to finish plus the idle window.

Replace it with strict, event-driven promotion: on every sweep (the fs.watch-debounced rescan, ~500ms) and every poll, promote EVERY backlog task (one or many) where:

- no blockedBy ref points at a not-done task (the existing blockedByUndone gate), and
- it has no openQuestions (the existing user gate), and
- the task is not conflicted.

The blockedBy chain serializes what must serialize (the PM encodes lanes and order at creation); unchained backlog tasks promote in parallel - that is the PM's lanes decision, expressed machine-readably instead of decided per Watcher report. Drop the idleSince machinery and the autoScheduleMinutes gate from the promotion path entirely; keep autoScheduleMinutes for its other use (the merge-attempted cooldown at ~:808 and ~:863). Log each promotion with the task file, e.g. "promoting <file> to to-do (blockers done)".

Keep setState's error handling (log the failure, keep going).

# 2. Auto-drop done blocker refs (src/orchestrator.ts, src/orchestrator.test.ts)

When a blocker reaches done, the daemon removes that ref from every task's blockedBy in the same sweep (today the PM does this with kanban_update per SKILL.md step 6). Strict rule: for every task with blockedBy refs, drop refs whose blocker task is done, via the updateAttrs path; log the change. blockedBy then always means "undone blockers only", which the webui relation lines reflect automatically. Never touch any other attribute.

# 3. Delays that stay (deliberate, not minimized)

- The merge-attempted cooldown (autoScheduleMinutes) for re-queued/failed mergers - failure path, prevents hot-looping.
- The single-merger gate - two mergers race the git index.
- pollMinutes liveness sampling - the stall window needs it; promotion never waits for a poll because the fs.watch sweep is the trigger.

# 4. SKILL.md (skills/se-llm-team/SKILL.md, README config table)

Rewrite step 6: the orchestrator promotes automatically (strict rules above) and maintains blockedBy; the PM's scheduling role shrinks to what needs thinking - encoding order and lanes via blockedBy at creation (conflict-aware chaining), and answering openQuestions. The Watcher loop stays for reporting to the user only; the PM never promotes backlog tasks by hand anymore. Update the README config table if autoScheduleMinutes' documented meaning changes.

# Complexity

complex. Multi-file, orchestrator subsystem: src/orchestrator.ts, src/orchestrator.test.ts, skills/se-llm-team/SKILL.md, README.md.

# Notes
