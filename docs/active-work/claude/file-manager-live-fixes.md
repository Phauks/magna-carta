---
worktree: claude/file-manager-live-fixes
area: apps/web (matter Files) + tooling
status: in-review
touches:
  - apps/web/src/lib/file-manager/
  - tooling/lint-icon-sizes.mjs
  - package.json
---

# Two defects only the running app could show

The file-manager port merged with `pnpm check:scoped` green, 15 tests passing and a clean build. It
also shipped a 56px icon in a 32px button and a three-pane layout occupying a quarter of the window.
Running it locally against a seeded firm found both in one screenshot.

**`size-14` is 56px.** The theme sizes in pixels; 14 is not one of the sizes it defines, so the class
resolved against Tailwind's default rem scale. Now pinned by `lint:icon-sizes`, which reads the
sanctioned set from the generated theme rather than repeating it — the first draft of that check
carried a guessed list that was wrong in both directions, which is the failure it exists to prevent.

**The panes had no height.** The shell's `<main>` is a block container, and a block parent does not
stretch a flex child, so `flex: 1` had nothing to stretch against.

The lesson is the one this surface keeps teaching: a gate that reads source cannot see a rendered
size. Run the screen.
