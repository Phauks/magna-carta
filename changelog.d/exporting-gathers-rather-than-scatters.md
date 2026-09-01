---
category: Changed
audience: public
---

Exporting no longer saves a file. It GENERATES the item onto the member's download shelf, so several
can be gathered over a morning and taken together — the owner's direction, and the reason the shelf
existed in the first place. The format menu stays on the export control, because the format is what
the item is made for and what its download defaults to; that choice is kept on the new
`download_item.requested_format` column, distinct from `downloaded_formats_json`, since "what this
was made for" and "what has actually left the platform" answer different questions and are both true
at once.

The register learns the difference: `POST /api/v1/downloads/snapshots` takes `taken`, defaulting to
false, so a format asked for is not recorded as a format downloaded. Claiming otherwise would tell a
member they already hold a file that was never made.

**Multi-select and one archive.** `/downloads` gains row selection and a bulk action that appears
only while a selection is in play. Snapshots render and travel in a single `client-zip` archive
rather than firing a download each — several simultaneous downloads make the browser prompt and then
scatter the files, which is the mess the gathering exists to avoid. An artifact cannot join the
archive and that is structural, not an omission: its bytes reach the member over a presigned URL the
browser downloads directly, and pulling them through the tab to repack them is what
`network-resilience.md` rule 2 forbids. Those open on their own, and a partial result is always
reported as partial.

**`Settings · Downloads`** carries the one preference: save a file as soon as I export. A user-tier
scoped setting, so it follows the member between machines, audited on the
`notificationPreferences.update` precedent, and written to the member's own tier and nothing else.

Where a file LANDS is deliberately absent, and stays absent: a page cannot choose the folder, the
local-disk pickers are Chromium-only, and they could never apply to a bundle whose bytes never pass
through the page. The browser's own "ask where to save each file" already covers every download; the
platform-side answer belongs to the desktop app.

Also repaired, and not from this stream: the matter-notes routes landed without their conformance
entries, so `main` was failing two fitness assertions — the six `notes.*` operations are added to the
committed operation list and the `notes:` namespace bound to the matter resource.

## Public

**Exporting now gathers instead of scattering.** Choosing a format adds the report to your Downloads
rather than dropping a file straight into your downloads folder. Gather as many as you like, then
tick the ones you want and take them all at once — they arrive as a single zip, each in the format
you made it for. If you preferred the old way, **Settings · Downloads** has a switch to save the file
as soon as you export, and the item still lands in Downloads either way.
