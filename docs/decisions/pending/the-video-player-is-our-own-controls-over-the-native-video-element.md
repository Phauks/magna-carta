---
slug: the-video-player-is-our-own-controls-over-the-native-video-element
status: Accepted
area: Documents
date: 2026-11-10
summary: "The in-app video player is the design system's own controls (Bits UI Slider and Select, Lucide icons, the token recipes) over the browser's native video element, with no player library, superseding the Vidstack-based player the inline-preview design named. Vidstack 1.x is in security-only maintenance and Video.js 10 would be a second skin to fork for frame steps and moment links. The inline-playable verdict is judged by the first reader of a version, from bounded ranged reads of the track table, rather than at ingest."
---

**The player is ours, over the browser's own video element, and whether a video plays is judged by
its first reader.**

**Context:** the inline-preview design named a Vidstack-based player. By 2026-11 Vidstack 1.x was
in security-only maintenance, its successor being Video.js 10. The owner reviewed three mockups
(Vidstack as shipped, Video.js 10, and our own controls) and chose our own controls with the bar
beneath the picture. Separately, the `file_version.inline_playable` column that gates inline media
had no writer, so every grant was download-only.

**Decision.** `VideoPlayer` in `@magna-carta/design-system` draws every control itself over a
native `<video>`: the browser already decodes, buffers and seeks, so a library would add only a skin,
and that skin would have to be forked to carry frame steps and a link to the moment. It composes a
new `Slider` (Bits UI) for seek and volume and the existing `Select` for speed. The verdict is
computed in the preview grant route the first time a version is previewed, not at ingest: the ingest
pipeline reads an object once with a 4 KiB head window, which cannot reach a track table a recorder
wrote at the end of a large file, and judging at first read also covers every video already stored.
Only `avc1`/`avc3`/`av01`/`vp09` video and `mp4a`/`Opus`/`fLaC` sound in MP4 or QuickTime, and VP8,
VP9, AV1, Opus and Vorbis in a WebM DocType, are `playable`; HEVC and general Matroska are
`download-only`; anything unreadable is `indeterminate`.

**Rejected.** Vidstack 1.x (security-only). Video.js 10 (a custom-element skin outside the design
system, to be forked for the controls a firm needs). Judging at ingest (cannot see a trailing track
table; needs a backfill for existing videos).

**Consequences.** No player dependency. The first preview of a large video costs a few ranged reads
once; later previews read a column. Production streaming still depends on a real cookieless files
host behind `FILES_ORIGIN`; until then the player offers the download.
