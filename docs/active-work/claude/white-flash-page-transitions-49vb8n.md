---
worktree: C:/dev/magna-carta-worktrees/claude/white-flash-page-transitions-49vb8n
area: The white flash between screens — the root painted from the surface token, and the colour scheme written before the stylesheet arrives
status: review
touches: packages/design-system/src/lib/styles/base.css, packages/design-system/src/lib/internal/theme-preference.ts, apps/web/src/app.html, docs/conventions/design-corrections.md, docs/conventions/ui-design.md
---

The last two steps of the document base #535 landed. That stylesheet declared the colour scheme and the root ink; this adds the root's own paint (`--mc-surface-default`, so the browser's generic canvas for the mode is never what shows through) and the inline `color-scheme` write in `applyThemeToDocument`, mirrored in the boot script, which is the one window a stylesheet cannot reach — with `ssr = false` behind an index.html fallback, the served document has an empty body until the application mounts.

Rebased onto #535 rather than landing beside it: this branch first carried its own `page-canvas.css` doing overlapping work, which would have merged cleanly into duplication because the filenames differed. All of that is dropped; what is left is three lines and their gates, added to files #535 owns.

Touches `base.css`, `theme-preference.ts` and the `app.html` boot script — all of them shared, none of them contended by another note in the registry. Nothing in `app-shell.svelte` or any screen.
