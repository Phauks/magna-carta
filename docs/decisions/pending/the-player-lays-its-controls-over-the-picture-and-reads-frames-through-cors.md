---
slug: the-player-lays-its-controls-over-the-picture-and-reads-frames-through-cors
status: Accepted
area: Documents
date: 2026-11-12
summary: "The video player lays its controls over the picture and fades them while it plays (the owner's look A), keeps only the often-pressed controls on the bar and moves speed (a submenu), the moment link, a screenshot and the download into a settings menu, and drops picture in picture. To take a screenshot the player reads a decoded frame back from a canvas, so the cookieless files host now grants CORS read access to the app's own pages (an https origin under the same parent domain, reflected, never a wildcard), the step the inline-preview design reserved for the player. Sound files (MP3, M4A, AAC, WAV, FLAC, Ogg) are judged and played in the same player."
---

**The controls lie over the picture, the rarely pressed ones live behind a cog, and the player may
read back the frames it shows.**

**Context:** the owner found the first player, with its bar beneath the picture, old-fashioned. Of
three working mockups he chose the overlay (A), asked for a screenshot, for the moment link and the
other settings to move into a cog menu with speed as a submenu, and judged picture in picture
unused (2026-11-12). He also asked whether sound files play; they did not, because the server never
judged them and the app routed no viewer to them.

**Decision.** `VideoPlayer` draws its controls on the chrome ink over a gradient at the picture's
lower edge and fades them once the pointer rests while it plays; a paused recording, an open menu
or focus inside the controls keeps them up. The bar keeps play, frame and ten-second steps, sound
and the time; the cog holds speed, Copy Link at, Save Screenshot and Download. Save Screenshot draws
the decoded frame into a canvas and reads it back as a PNG, which a browser allows only for a
picture it may read: the player loads the recording with `crossorigin="anonymous"`, and the files
host answers an app page under its own parent domain with that origin in
`Access-Control-Allow-Origin` (`readerOriginFor` in `apps/api-worker/src/files/preview-serve.ts`).
The token in the address already lets that page download the same bytes, so the grant adds no
reach; another origin gets nothing. Sound files are judged by `inline-playable.ts` (MP3, AAC and
FLAC by container, M4A by its track, WAVE by its sample encoding, Ogg by its first packet) and open
in the same player as a panel of controls.

**Rejected.** Taking the still on the server (it needs a decoder the platform does not have yet).
A wildcard CORS grant (it would let any site read a recording whose address it obtained).
Keeping picture in picture (the owner judged it unused).

**Consequences.** A screenshot is saved on the reader's machine through the app's save path and is
not recorded the way a download is. The hover thumbnail loads a second copy of the recording's
early bytes on the first hover of the timeline.
