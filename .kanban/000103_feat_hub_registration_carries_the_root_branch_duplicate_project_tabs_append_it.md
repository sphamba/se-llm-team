---
name: "feat: hub registration carries the root branch; duplicate project tabs append it"
priority: "medium"
state: "doing"
worktree: "feat/103-hub-registration-carries"
---

# Summary
The hub registry gains the registering daemon's root checkout branch (resolved live at register and each heartbeat), /api/projects serves it, and duplicate project tabs in the webui append it as "name (branch)" with the tab identity switching to the root.

# Specs
Part 2 of the base-branch feature (the merger/merge-flow part is task #102). The user's rule: in the #39 hub tabs, when a project appears multiple times, append the "root" branch name (where the orchestrator was spawned from). Live resolution per the user's decision.

Facts (main 35ba118, verified): HubEntry src/hub.ts:10-15 = {name (repo basename), root, start, lastHeartbeat}; /register :217-228 accepts only name + absolute existing root; heartbeat updates only lastHeartbeat :232; /api/projects :180 serves the four fields. joinHub sends {name, root} only. Webui: tabNames src/webui.ts:333-335 = projects.map(p => p.name) - the name is BOTH identity and label; tabsHtml :338-343 sets data-project and the visible label from the same string; the client poll :836-840 feeds /api/projects into tabNames. #39 (done, merged) owns this region; its selection is by name, so duplicates collide.

Changes:
1. Registration carries the branch: the daemon resolves its root checkout's current branch (e.g. `git branch --show-current` in root) at register and at every heartbeat, sends it, and the hub stores it on the HubEntry (live per operation - the label tracks the checkout's branch as it moves). Detached HEAD: send an empty string (the label falls back to the plain name).
2. /api/projects serves the branch field.
3. Webui tabNames: when multiple entries share the same project name, each such tab's label becomes "name (branch)" (the branch from its own entry); non-duplicated names keep the plain label. The tab identity (data-project) switches to the entry's root (unique) so two same-named projects select their own boards; the /api/tasks?project= selection follows the identity the hub can serve (root-based; the developer keeps the API backward-compatible).
4. Tests: src/webui.test.ts - tabNames appends the branch only for duplicated names; identity disambiguation asserted; the hub payload carries the branch (extend the hub unit/election tests' fixtures).

Acceptance: two daemons registering the same repo from different checkouts render two tabs "repo (branch-a)" and "repo (branch-b)", each showing its own board; a single registration behaves exactly as today; full suite green.

Constraints:
- Files: src/hub.ts, src/webui.ts, src/webui.test.ts.
- The tab region (tabNames/tabsHtml) is disjoint from the in-flight #88 (agent history) and #84 (agentLogPayload) webui work; coordinate in the merger if the regions drift.

# Notes
