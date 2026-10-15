# merger: append project-specific guidance for this role below (e.g. how to run the project, how to live-test) so future agents of your kind start faster.

- SPECS.md in the worktree is a symlink to .kanban/<NNN>_<slug>.md, and .kanban itself symlinks to the main checkout's .kanban dir. Edits through SPECS.md already land on the main checkout's task file; do not copy the file.
- Conflicts usually hit test files from merged feature commits replaying over a newer base. Base branch wins unless the task Specs mention the file; one edit per conflict hunk, then `git add <file> && GIT_EDITOR=true git rebase --continue`.
