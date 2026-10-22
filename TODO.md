# Backlog

- [ ] Fallback-path test: add a dedicated test for the tool_execution_start fallback path (tool call with no message_end block). The reviewer verified it by hand only.
- [ ] Fix the flaky webui timing assertion: tests/webui.test.ts line 1467 asserts a duration of 5000 built from two separate Date.now() calls, so a millisecond straddle yields 5001. Use fixed epoch timestamps. Pre-existing, hit once in three full-chain runs.
- [ ] Cosmetic: use local time instead of UTC in the analysis report header date line.
- [ ] Analysis entries could show the original log index of each kept block, so the report cross-references the raw log despite index gaps from folded lead-ins. Positional numbering hides the gaps today.
- [ ] Cap a huge roles.analyser.mergeThreshold at config level (any positive integer is accepted today; the 8000-char prompt cap bounds the damage only).
- [ ] BlockReport.index is written but never read: keep for future use or drop in a cleanup.
- [ ] Optional, likely unneeded: an injected runAnalyser returning an empty string directly bypasses analyserAnswer and stays success. Dead code in production after the empty-answer fix.
- [ ] Idea (not blocking): per-complexity concurrency override for analysers would need RoleLlmConfig.concurrency extended.
