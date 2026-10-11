---
name: "feat: hub registration carries the root branch; duplicate project tabs append it"
priority: "medium"
state: "reviewing"
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
- Implemented in worktree feat/103-hub-registration-carries, commit 08f2f15.
- src/hub.ts: HubEntry gains branch; new exported currentBranch(root) runs `git branch --show-current` in the root (stdio piped, "" on a detached HEAD, non-git root, or any git failure). joinHub sends {name, root, branch} at register and at every heartbeat; the heartbeat handler updates lastHeartbeat and branch on the entry, so the label tracks the checkout as it moves. startHub seeds self with the live branch too.
- Registry identity switched from name to root: /register keys entries by root (two checkouts of one repo keep their own entries), seeding and failover inherit that. /api/tasks and /api/agent-log select by root; a bare project name still resolves when unique (backward compatible) and answers 404 when duplicated (ambiguous). /api/projects serves the branch via the entry spread.
- src/webui.ts: tabNames returns {id, label} descriptors - id is the entry root (unique identity), label is "name (branch)" only for names registered more than once, plain name otherwise; an empty branch (detached HEAD) keeps the plain name. tabsHtml renders data-project from the id and the visible label from the label. The client keys boards, polls and active-tab tracking by id; the single-project fallback [{id:"",label:""}] keeps the old bare /api/tasks ui.
- Tests: webui.test.ts covers branch-append only for duplicated names, detached-HEAD fallback, id/label escaping and identity disambiguation through tabsHtml; page-source assertions updated. orchestrator.test.ts part U fixtures extended (entry shape with branch, register stores branch, heartbeat re-resolves it, name-only heartbeat still works, two same-named checkouts keep own entries and root selects each board); part V asserts the registry entries carry a non-empty branch. Spec item 4 asked for these hub fixtures; they live in orchestrator.test.ts, so that file is touched beyond the constraint list.
- Live two-checkout acceptance smoke (temp HOME, free port, both daemons on one repo's two branches) passed: two tabs' data ("repo (branch-a)" / "repo (branch-b)" via the tested tabNames), each root serving its own board, heartbeat picking up a branch move. Single-daemon case verified unchanged. Two bugs found and fixed by the smoke: execFileSync leaked git's stderr into the daemon log every heartbeat (fixed with stdio pipe), and the heartbeat name fallback matched a same-named entry of the OTHER checkout, returning 200 to an unregistered daemon so it never registered (fixed: root-gated lookup, name fallback only without a root in the body).
- Full suite green: node src/kanban.test.ts, node src/webui.test.ts, node src/orchestrator.test.ts.
- Review (commit f941365): verified the hub payload, root-keyed registry, resolveEntry fallback, live branch per heartbeat, webui id/label split and the tests against the specs; all match. Two fixes: startHub's close() still cleaned up by the old name key while entries now key by root, so the hub's own entry survived close in the registry (other hubs would seed the lingering fresh entry for up to staleMs) - now deletes by opts.root, regression-asserted in part U after hubU.close(); tabNames counted duplicates on a plain {} so a repo basename like "constructor" or "toString" never got the branch suffix - now Object.create(null) (the PAGE boards pattern), asserted in webui.test.ts. Suite re-run green on all three test files. Files touched beyond the constraint list: src/orchestrator.test.ts only (hub fixtures, as the specs' item 4 required).
