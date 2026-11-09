---
category: Added
audience: public
---

**About Magna Carta opens a window.** The profile menu's Websites > About Magna Carta entry, previously disabled as Soon, and its command-palette twin now open an About window (`apps/web/src/lib/about/about-window.svelte`), mounted once in the app shell. The left column states the build's commit (linked to the source), release date, the signed-in member and firm from the cached session read, the build environment and the browser, with Copy Version Details putting the same lines on the clipboard (`aboutFacts`/`aboutDetailsText` in `about-facts.ts`). The right column links to the Changelog, Settings > Versions, the status page and Report an Issue; Documentation, Terms of Service, Privacy Policy and open-source licenses render as Soon. The ecosystem-site registry gains `opensWindow`, an in-application window that stands in for a site with no address yet, beside `route`.

## Public

**About Magna Carta now opens.** Choose About Magna Carta under Websites in your profile menu to see which version you are running, when it was released, who and where you are signed in, and your browser. Copy Version Details puts all of that on your clipboard for a support request, and the same window links to the Changelog, the full version report, service status and Report an Issue.
