---
category: Added
---

**Conversion — engine placement (local vs server).** `@magna-carta/conversion` now tags each engine with where it can run: libvips runs **locally** (browser wasm) and on the **server** (Container); the native engines (LibreOffice, email render, FFmpeg) are server-only. `canConvertLocally(from, to)` reports whether a conversion can run entirely on the user's device — letting a surface offer "convert on your device" (no upload) versus "send to servers."
