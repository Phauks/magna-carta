---
category: Changed
---

**Conversion hops now resolve their engine per id, end to end.** The conversion queue consumer's
resolver seam passes each hop's engine id through (`resolveEnginePort` returns an `EngineResolver`
instead of one port for every hop), the service-binding adapter stamps `x-engine-id` on each request,
and the convert worker dispatches on that header to the executing Container — the raster Container
serves both raster interconversion and image-to-PDF; an engine id with no Container yet stays a typed
`engine-not-implemented` failure. This removes the single-engine assumption so the LibreOffice, email,
and FFmpeg engine Containers can each land as an additive dispatch entry with no orchestration change.
