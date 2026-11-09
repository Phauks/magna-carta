---
worktree: claude cloud session (no local worktree)
area: the person screen — New Person and the directory record window as one scrolling page
status: review
touches: apps/web/src/lib/directory, apps/web/test/directory-*, docs/user/features/directory.md, docs/conventions/design-corrections.md
---

Redesigns the New Person dialog and the entity window so every section stacks on one scrolling page with a jump rail (`record-sections.svelte`), folds Pronouns and Dates into About, moves a record's facts into its header, and caps long lists with Show All. Overlaps PR #695 on the New Person button label (both say Save).
