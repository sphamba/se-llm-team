---
name: "feat: installable as a pi package with pi install from git"
priority: "medium"
state: "backlog"
worktree: ""
---

# Summary
Make the repo satisfy the pi package contract so `pi install git:github.com/sphamba/se-llm-team` works on a fresh machine: a pi manifest for the root-level extension and the skills dir, plus peerDependencies for the host-provided packages. Keep the local symlink untouched.

# Specs
# Change (package.json, README.md only)

The repo is a pi coding agent extension today via the local symlink ~/.pi/agent/extensions/se-llm-team (KEEP IT - do not touch). For `pi install git:github.com/sphamba/se-llm-team` to work on another machine, the package contract needs:

1. **pi manifest** (package.json): the extension is index.ts at the REPO ROOT - pi's package discovery for a directory package only looks in conventional dirs (extensions/, skills/, prompts/, themes/), so without a manifest the extension is never discovered. Add:
   ```json
   "pi": { "extensions": ["./index.ts"], "skills": ["./skills"] }
   ```
   agents/*.md are not a pi resource type (the orchestrator reads them at runtime) - not in the manifest.

2. **peerDependencies** (package.json): index.ts imports the host-provided packages @earendil-works/pi-ai (StringEnum, runtime value), typebox (Type, runtime value) and @earendil-works/pi-coding-agent (types only). Declare all three with a "*" range. Do NOT list host-provided packages in dependencies and do not bundle them - a physical copy bypasses pi's extension module mapping and breaks.

3. **Keep**: name "se-llm-team", private: true (not published on npm - private only blocks publish, git installs work), type: module, the pnpm packageManager pin (task #89).

4. **README install section**: `pi install git:github.com/sphamba/se-llm-team` (the https URL form also works), what it provides (the kanban/orchestrator tools, the se-llm-team skill, the agent prompts), and the local dev alternative (symlink into ~/.pi/agent/extensions/). A node >= 24 note (the daemon runs .ts directly through node's type stripping).

# Facts already verified

- Position-independent already: index.ts:17 resolves extDir from import.meta.url and spawns src/orchestrator.ts from its own copy; src/orchestrator.ts:23 reads agents/ from its own tree. No path fixes needed.
- src/*.ts import only node stdlib and relative files - no runtime dependencies to install.

# Complexity

simple. package.json manifest + README section, no logic.

# Notes
