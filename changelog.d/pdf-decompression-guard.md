---
category: Added
---

PDF engine: a crate-wide decompression-bomb guard. Every operation now rejects
oversize input and streams that inflate past safe caps, surfacing a typed
`DecompressionBombError` to callers.
