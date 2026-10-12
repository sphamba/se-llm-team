---
name: "fix: log pane meta keeps a stale model or thinking level from an older record"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#146"
complexity: "simple"
blockedBy: ""
shortName: "stale-log-meta-field"
---

# Summary
The log pane's meta line (#m-log-meta, from #146) can show a model or thinking level that the latest usage-bearing log record no longer carries: logStats in src/webui.ts only overwrites each field when the current record has it, so an absent field is inherited from an older record. This contradicts the #146 Specs sentence that the two fields come from the LATEST usage-bearing record.

# Specs
Root cause in src/webui.ts (worktree feat/146-log-pane-model-meta, commit 40b4921): logStats (src/webui.ts:233) walks the log top to bottom, and inside the usage guard for turn_end / assistant records with message.usage.totalTokens it does:

    // the loop reads top to bottom, so the latest usage-bearing record wins
    if (typeof rec.message.model === "string" && rec.message.model) model = rec.message.model;
    if (typeof rec.message.thinkingLevel === "string" && rec.message.thinkingLevel) thinkingLevel = rec.message.thinkingLevel;

Both assignments are conditional on the field being present and non-empty in the current record, and neither field is ever reset to null. A record that omits model or thinkingLevel therefore keeps the value inherited from an earlier usage-bearing record.

Deviation from spec: #146's Specs say "logStats picks up model and thinkingLevel from the LATEST usage-bearing record" (log pane shows "model · thinking level", model only when there is no thinking level, line hidden when model is null). With the inheritance, the payload — and the rendered line — reflects the latest record that happened to carry each field, not the latest usage-bearing record.

Two observed cases (live test, headless Chromium against a real hub, fixture live log with a live pid, records appended while the pane was open):
- Latest usage-bearing record = model "Model C", no thinkingLevel -> payload thinkingLevel was "high" (carried from an earlier record) and the pane showed "Model C · thinking high" instead of "Model C".
- Latest usage-bearing record = thinkingLevel "low", no model -> payload model was "Model C" (carried) and the pane showed "Model C · thinking low" instead of hiding the line.

Practical impact is low: pi always sends message.model on assistant records, and thinkingLevel is optional, so only a mid-run thinking level change (or a transcript whose tail record lacks a field) leaves a stale value on screen.

Expected behavior candidates:
- Latest record wins: when the latest usage-bearing record omits a field, clear it to null, so the client shows "Model C" (no thinking suffix) or hides the line (no model) — matching the #146 Specs and the assumption that a thinkingLevel without a model hides the line.
- Carry-forward is intentional: then update #146's Specs sentence and its assumptions instead, and document that the meta line can show a value from an older record.

Tests: src/webui.test.ts (the flat assertion script extended by #146) needs a case whose latest usage-bearing record is missing one of the two fields (model present / thinkingLevel absent, and the reverse), asserting the payload clears the absent field rather than carrying it. The developer/reviewer tests do not cover the absent-field case. Keep the existing latest-record and nulls-without-usage-record assertions green. No orchestrator changes.

# Notes

# Open questions
- Should a model or thinkingLevel that is absent from the latest usage-bearing record clear to null (latest record wins, as the #146 Specs state), or keep the last value seen in an older record? If the carry-forward is intentional, update the Specs and the #146 assumptions instead.
