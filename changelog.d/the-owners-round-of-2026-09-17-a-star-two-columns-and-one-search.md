---
category: Changed
audience: public
---

**The owner's round of 2026-09-17, in five parts.** The favourite star in every screen header no longer announces itself pressed (`favorite-control.svelte`): the ghost button recipe rings a pressed control with an accent hairline, which drew a box around a glyph that already carries the state by filling. The settings column folds by band and by group through a new `NavigationLayout.Group` part (`packages/design-system/.../navigation-layout/`), remembered per browser as departures from everything-open (`settings-navigation-folds.svelte.ts`), never folding away the page the reader is on; `NavigationLayout` caps its height against the canvas it sits in instead of guessing from the viewport, and the conflicts settings page is on `SettingsScrollRegion` like the other twenty-three. The Directory searches its own table: `GET /api/v1/directory/entities` takes `search`, answers with listing rows in the firm's relevance order and says when the answer is capped, and matching matters ride the same grid as rows of kind Matter while a query is live; the separate hit table is gone. A fourth rule in `lint:workspace-search`, `second-results-surface`, refuses a Workspace screen that draws one table under the query and another under the else. The calendar fits a laptop: one scroll region under the action row (the agenda is its own), the month sized by a cell minimum that fills its column, and a toolbar that fits one line by measure rather than wrapping — the controls stay over the grid, as the owner ruled in the same breath as naming the escape.
The next morning's corrections ride the same branch: `ScreenSearch` no longer takes a placeholder, so every screen's search field reads the one word "Search" (twenty-three per-screen hints struck). The office editor launch form now carries `ui_defaults=UIMode=tabbed`, so Collabora opens in its tabbed interface with the font and paragraph controls on the Home tab instead of behind the Format menu. The top bar holds one open panel at a time: `TopBar.Root` declares an overlay band (`packages/design-system/src/lib/internal/overlay-band.svelte.ts`) that every popover, menu and dialog seated in it joins, because a hover label counts as a dismissible layer in Bits UI and could keep a neighbour's panel from closing; the account menu is click-only and shows the member's name and firm from the cached session bootstrap.

## Public

**The favourite star is just a star.** Adding a screen to your favourites fills the star gold; nothing boxes it in.

**Settings folds.** My Settings, Firm Settings and Platform each fold on their heading, and so does every group inside them, the same way the left sidebar's groups fold. What you fold stays folded on this browser; the section you are reading is never hidden from you. Every settings page now scrolls in one place.

**The Directory searches the table you are looking at.** Typing narrows the directory table itself, with every column, sort and filter you had set still in place, in the firm's own best-match order. Matters that match are listed too, marked Matter, and open the matter. When the firm holds more matches than are shown, the line under the table says so.

**The calendar fits a smaller screen.** One scrollbar under the controls, a month that fills the height it has, and the controls in one line over the grid.

**Search says Search.** The search field on every screen reads the one word, since the screen is already named beside it.

**The document editor opens with its tabs.** Font and paragraph controls are on the Home tab at the top, where the compact toolbar kept them behind a menu. The editor's View menu still switches modes, and a mode chosen there is remembered by your browser.

**One panel at a time in the top bar.** Opening Uploads closes Downloads, and so on; the account menu opens on a click, never on hover, and now shows your name and your firm.
