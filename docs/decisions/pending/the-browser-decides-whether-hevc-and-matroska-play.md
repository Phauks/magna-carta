---
slug: the-browser-decides-whether-hevc-and-matroska-play
status: Accepted
area: Documents
date: 2026-11-10
summary: "HEVC video and Matroska files whose tracks carry codecs a current browser can decode are judged playable, and the reader's own browser is the last word: the player offers the download when it reports a media error or a blank picture after the first frame. Formats no browser decodes (ProRes, MPEG-2, Dolby Digital sound and the like) stay download-only. Every stored download-only verdict is cleared once so it is judged again under the new rule. Narrows the HEVC and general-Matroska refusal in the-video-player-is-our-own-controls-over-the-native-video-element."
---

**A recording is refused by the server only when no browser could play it. Whether this reader's
browser can is the browser's call.**

**Context:** the owner requires MKV and HEVC recordings to be viewable without downloading
(2026-11-10). The first player refused both at the server, because HEVC plays in some browsers and
not others: Safari and Edge decode it, Chrome does where the computer has a hardware decoder,
Firefox mostly does not. Matroska was refused outright although Chromium plays a Matroska file of
browser codecs served as `video/x-matroska` (checked in Playwright Chromium: `loadeddata` fired with
the picture's real width).

**Decision.** The verdict in `packages/file-manager/src/inline-playable.ts` admits `hvc1`/`hev1` in
MP4 and QuickTime, and judges a Matroska DocType by its tracks: H.264, HEVC, VP8, VP9 and AV1
video with AAC, Opus, Vorbis or FLAC sound play. Dolby Digital and DTS sound stay refused, because a
recording that plays with no sound reads as one where nothing was said. The `VideoPlayer` reports
`onUnplayable` on a media error and also when the first frame arrives with no picture width, which
is how a browser without an HEVC decoder can fail silently. A data migration
(`20261110T083359_rejudge-download-only-recordings`) clears every stored `download-only` verdict once
so recordings judged under the old rule are judged again at their next preview.

**Rejected.** Probing the reader's browser with `canPlayType` before asking the server: its answers
are "maybe" for most strings, and the media element's own failure is the definitive answer at no
extra cost. Repackaging or converting in this change: that is the Rust transcode engine's, through
the derived-rendition seam in `decidePreview`.

**Consequences.** A reader on a browser without an HEVC decoder sees the player briefly before the
download is offered, rather than the download at once. The converter's "prepare a playable copy"
must be offerable from that browser-refused state as well as from a server refusal.
