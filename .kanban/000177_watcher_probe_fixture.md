---
name: "test: #172 watcher open-questions fixture"
priority: "low"
state: "backlog"
worktree: ""
issuer: "#172"
complexity: "trivial"
shortName: "watcher-probe-fixture"
---

# Summary
LIVE-TEST FIXTURE for task #172, deleted right after the test. Do not work on this task. It exists only so a real watcher runs while a backlog task with non-empty openQuestions is on the board.

# Specs
Created by the live-tester during the live test of #172 (docs: watcher report carries board events only, PM runs the board check). The watcher report must NOT carry the questions below, and the PM's own kanban_list backlog check MUST surface them. The task is deleted at the end of the test.

# Notes

# Open questions
FIXTURE-QUESTION-ALPHA: (live-test fixture of #172, deleted right after the test) does the Project manager ask this from its own board check after the watcher report? FIXTURE-QUESTION-BETA: second probe marker, quote it if you ask it.
