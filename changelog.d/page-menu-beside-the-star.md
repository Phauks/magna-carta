---
category: Added
audience: public
---

**A page menu beside the favourite star on every screen header.** `ScreenHeader` draws `page-actions-menu.svelte` next to `FavoriteControl` whenever the screen is favoritable: Copy Link and Open in New Tab on every page, then a screen's own items passed through the new `pageMenu` snippet. Notifications moves What You Hear About, Shipping & Postage moves Postage Account, and Uploads moves Clear History into it. The star stays on the row, so the favourite state stays visible; the ruling is in `docs/conventions/design-corrections.md`.

## Public

**Every page has a menu beside its title.** The three dots next to the star let you copy the page's link or open it in a new tab, and some pages add their own entries there: What You Hear About on Notifications, Postage Account on Shipping & Postage, and Clear History on Uploads. The star stays where it was, so you can still see at a glance which pages are favorites.
