---
category: Added
audience: public
---

**Videos play in the browser.** Opening a video on a matter's files plays it in a new tab, and its
row's Preview tab plays it in the details panel. The controls are Magna Carta's own, in a bar beneath
the picture: seek with how much has loaded, one-frame and ten-second steps, sound, playback speed,
picture in picture, full screen, keyboard keys while the player is selected, and **Copy Link at**,
which copies an address that opens the video at that moment. A video a browser cannot decode — the
HEVC most phones record, or sound in a format browsers lack — says so and offers the download.

**How a video is judged.** The first time a version is previewed, the server reads its track table
through bounded ranged reads (MP4 and QuickTime boxes, WebM elements, at most 16 MiB of headers) and
records `playable`, `download-only` or `indeterminate` on the version, so every later preview reads
the column; videos uploaded before this change are judged the same way, with no backfill. A failed
read records nothing and the next preview tries again. New design-system components: `Slider` and
`VideoPlayer`.

## Public

**Watch videos without downloading them.** Open a video on a matter's files and it plays in a new tab;
select it and it plays in the details panel too. Step a frame at a time, jump ten seconds, change the
speed, and copy a link that opens the video at the exact moment you are on. A video your browser
cannot play, such as the format many phones record in, says so and offers the download.
