---
category: Fixed
audience: public
---

**The work canvas lays its children out as a column, so a full-height screen shrinks under the platform notice.** `<main>` in `app-shell.svelte` is `flex flex-col`; `NavigationLayout`'s root is `min-h-0 shrink`. A two-sided screen sized itself to the whole canvas as a block child and kept that height whatever stood above it, so the platform notice pushed it past the bottom edge and the canvas grew a third scrollbar. The page-inset lint reads the canvas's class list, so its inert-grow rule retires itself on the same change. `personInitials` moves from the time sheet's column helpers to the design system's name formatters beside `personName`, which is the one home the account corner and the time ledger now share.

## Public

**No stray scrollbar under a platform notice.** When the platform is in trouble and the notice shows, Settings, the Calendar and Magnus fit beneath it instead of scrolling the whole page by the notice's height.
