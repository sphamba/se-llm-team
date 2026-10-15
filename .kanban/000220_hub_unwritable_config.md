---
name: "fix: hub setup survives an unwritable neutral config dir"
priority: "medium"
state: "backlog"
worktree: ""
issuer: "#215"
complexity: "simple"
shortName: "hub-unwritable-config"
---

# Summary
The daemon must not crash at startup and must not misreport the cause when the neutral config dir (~/.config/se-llm-team) cannot be written. Today a read-only root filesystem made acquireHubLock's mkdirSync throw unhandled (daemon died) and made the lock write fail EROFS, logged as "hub lock held by another daemon, standing down".

# Specs


# Notes
