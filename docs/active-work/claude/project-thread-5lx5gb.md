---
worktree: C:/dev/magna-carta-worktrees/claude/project-thread-5lx5gb
area: Pure-Rust audio/video transcode engine (documents.conversion.av-transcode)
status: building
touches: containers/transcode, apps/convert-worker, packages/conversion, apps/api-worker/src/conversions, roadmap.d/documents.md, docs/Magna-Carta-White-Paper.md, tooling/gate/classify.mjs
---

Builds the Rust transcode engine (MP4, QuickTime and Matroska with H.264 or HEVC in; a faststart
H.264/AAC MP4 out) and registers it as the `transcode` engine in the convert worker and the conversion
registry, replacing the never-built FFmpeg placeholder. The playable-copy adapter (SafeRenditionPort)
follows in a second pull request; the video player thread owns the preview decision and the UI.
