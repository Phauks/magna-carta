---
number: 29
slug: file-preview-inline-file-preview-video-first
status: Accepted
date:
area: File preview
---

**Inline file preview (video-first):** stream originals from **R2 via authorization-gated signed URLs** into a **Vidstack** player (Lucide), with an `inlinePlayable` verdict computed at ingest and rolled up in Reports; download always available. **Cloudflare Stream rejected** (≈10x storage + metered delivery); transcoding deferred to **self-hosted FFmpeg (Queues + Container)**, the player already HLS-capable.
