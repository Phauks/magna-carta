---
slice: PDF render engine
group: cross-cutting
order: 8
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: n/a
load-profile: n/a
tested: todo
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

Pure-Rust engine (`crates/pdf-core` → WASM): render, redaction, scrub, bad-redaction detector, surgery (v1, 3/10 corpus), Bates, AcroForm forms, secure/encrypt, generate-primitives, decompression-bomb guard (raw-bytes pre-flight; deflate-rigorous, encrypted-stream bodies a disclosed residual). Remaining: surgery completion → OCR → PAdES. Tool UIs gated on wasm-opt + 0·7.
