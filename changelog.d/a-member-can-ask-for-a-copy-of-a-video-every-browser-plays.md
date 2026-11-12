---
category: Added
audience: internal
---

**A copy of a video every browser plays, asked for and made in the background.**
`POST /api/v1/files/{id}/playable-copy` asks for a copy of a file's current version converted by the
Rust transcode engine to H.264 and AAC in a faststart MP4, and `GET` on the same path reports where
it stands, with a short-lived signed address on the cookieless files host once it is ready. The
request is accepted whatever the version's playability verdict, because the browser that refused
the original is the one that matters. The conversion runs on the conversion queue and streams the
original from the firm's bucket through the engine and back without buffering it; the copy is
recorded on the version it came from (five new `playable_copy_*` columns, an additive migration),
stamped `playable-copy`, and destroyed with that version's bytes. A file the engine cannot convert is
recorded with the engine's reason so it is not attempted again. The player's button for it is not
built yet.
