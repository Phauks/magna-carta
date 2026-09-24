---
category: Changed
audience: public
---

Live mode in the Safe Website Viewer streams the remote browser instead of returning a screenshot per step, on the owner's ruling that live websites should be streaming. `GET /api/v1/safe-browse/live/stream` upgrades to a WebSocket (same-origin only, through the chokepoint on `tools:safeBrowse`) and hands it to the member's `SafeBrowseSession` object, which holds the socket and a CDP connection to their browser: `Page.startScreencast` JPEG frames go out one in flight at a time, paced by the page's acknowledgements, and pointer, wheel, key and pasted-text input comes back through one shared, bounded protocol (`@magna-carta/safe-browse/live-stream-protocol`). The SSRF guard now covers every document the browser requests for the whole session through CDP's Fetch domain, not one navigation at a time. Popups fold into the visible tab, downloads are denied, the file chooser is intercepted, dialogs are dismissed and reported. A second tab opening Live takes the browser over; idle is now three minutes without input. `POST /api/v1/safe-browse/live/navigate` is retired. The cross-origin upgrade check the meetings socket carried moved to `chokepoint/same-origin-upgrade.ts` so both sockets share it.

## Public

Live mode in the Safe Website Viewer now shows the isolated browser's screen as it happens, and you can use it: click buttons and links, scroll, open menus, and type into search boxes, while the site still runs on the isolated computer and never on yours. The address bar follows where the page goes, back and forward move through the pages you visited, and the tabs on the right update with each new page. Pop-ups open in the same screen, downloads and uploads are blocked, and messages a page pops up are closed for you. Never type a real password into a page you are checking.
