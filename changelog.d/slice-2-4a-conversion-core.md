---
category: Added
---

**In-app conversion — the substrate-independent core (in-house only).** New pure `@magna-carta/conversion` package: a `ConversionPort` (typed, never-throws result), a format registry of single-engine weighted edges, multi-hop pathfinding, and a working libvips image adapter over `wasm-vips` (PNG/JPEG/WebP/TIFF/GIF, tested in Node). LibreOffice/FFmpeg/email edges are registered but their bodies are deferred to the execution substrate (they return `engine-not-implemented`). The converter is **in-house only** — confidentiality absolute, one engine per edge; a pluggable external-engine model was considered and rejected because in a law practice nearly all content is privileged, so any classifier that permits egress is a one-mistake leak of privileged material. The conversion orchestrator, Worker routes, Container/Durable-Object execution, the LibreOfficeKit fork-pool, and the FFmpeg sandbox remain gated on the slice 2·1/2·2 execution substrate.
