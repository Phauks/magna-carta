---
category: Changed
audience: public
---

**The favourite star moves into the page menu.** `page-actions-menu.svelte` now opens with Add to Favorites (Remove from Favorites, with the star glyph filled gold, once the page is saved), ahead of Copy Link and Open in New Tab, and `ScreenHeader` no longer draws a separate star. `favorite-control.svelte` is removed; the favourites store is unchanged, so every saved favourite carries over. `favoritable={false}` still drops the whole menu. The ruling is updated in `docs/conventions/design-corrections.md`.

## Public

**Favorites are now saved from the page menu.** The star beside each page's title has moved into the menu next to it: choose Add to Favorites there, and on a page you have already saved the same entry shows a gold star and reads Remove from Favorites. Everything you had saved is still in your sidebar.
