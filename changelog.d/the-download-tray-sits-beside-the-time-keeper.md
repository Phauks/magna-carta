---
category: Added
audience: public
---

The download tray: a Download control in the top-bar actions cluster, seated beside the Time Keeper
on the owner's direction, whose panel gives the overview of what the platform has made for this
member and links to the full register at the bottom. The register shipped as a sidebar destination
only, which was the wrong reach for it — a download is something you look up for, not something you
go looking through the rail for.

It is deliberately NOT a transfer manager and must not become one: bytes move over a presigned URL
that the browser's own download manager drives
([`network-resilience.md`](../docs/conventions/network-resilience.md) rules 1 and 2), so there is no
progress for this component to show and no transfer for it to own.

Its dot is real state rather than decoration — the shelf holds something that arrived since this
browser last opened the tray, kept per browser in `localStorage` and read defensively so a private
window degrades to "nothing is new" rather than throwing. One 16px corner holds one mark, so while
something is new the arrival dot takes the slot from the maturity dot; the stage stays stated on the
sidebar row. A shared revision signal (`download-shelf-signal.svelte.ts`) is what makes a download
appear in the tray at once instead of at the next page load — the export menu and the tray never
meet, since one is rendered by whichever screen is exporting and the other is seated once in the
shell. The Downloads destination moves to `alpha`.

## Public

**Your downloads are now at the top of the screen.** A download button sits beside the timer in the
top bar: it marks itself when something new arrives, and clicking it shows what the platform has
recently made for you, with a link to the full list at the bottom. Taking one from the panel gives
you it back in the format you took it as; the full page is where you can choose a different one.
