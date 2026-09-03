---
worktree: C:/dev/magna-carta-worktrees/claude/dropdown-hover-activation-q49en9
area: Design system — DropdownMenu opens on hover
status: review
touches: packages/design-system/src/lib/components/dropdown-menu, packages/design-system/src/stories/dropdown-menu.stories.svelte, packages/design-system/test, changelog.d
---

Owner's direction of 2026-09-02: the menus on a matter — Money, Record, and the rest — open when the
pointer rests on them, not only on a click. Done once, in the design system, so every DropdownMenu
gets it: Root owns a hover controller shared with Trigger, Content, and SubContent, with the timing,
the focus rules, and the one-hover-menu-at-a-time arbitration pinned in a unit test and a story.
No screen in `apps/web` changes. Concurrent streams should not step on the DropdownMenu wrappers.
