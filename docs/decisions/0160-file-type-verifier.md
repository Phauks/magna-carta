---
number: 160
slug: file-type-verifier
status: Accepted
date: 2026-06-28
area: Tools / Scan
summary: The File Type Verifier identifies a file's true content type by running the Magika ML engine in the sealed scan Container, returning raw identification facts; the app Worker assembles the extension-match verdict and recommendation via `@magna-carta/file-type`. Key decisions: Magika over a signature table or `file-type` (text/source coverage); co-located in the scan subsystem (shared containment and deployment cadence); raw-facts-in-Container / verdict-in-app split; probabilistic-with-confidence framing; `ort`/ONNX Runtime (C++) accepted as a contained golden-rule-14 exception.
---

**File Type Verifier — architectural decisions.**

**(1) Magika over a hand-maintained signature table or the `file-type` npm package.** Magic-byte tables (and `file-type`) cannot identify text-based content — `.txt`, `.csv`, `.json`, source code, Markdown — because these formats carry no signature bytes. Google's Magika ML model covers 200+ types, including every text and source-code category that defeats a signature detector. It closes the identification gap in one engine, at ~99% precision, with a confidence score that lets the system express and surface uncertainty rather than fabricating a wrong definitive answer.

**(2) Co-located in the scan subsystem.** Scored against the container-extraction rubric in `docs/conventions/operations.md`: Magika is a heavy native runtime that processes untrusted bytes in a sealed, no-egress environment and holds no firm state — the same profile as malware scanning. Co-locating reuses the already-warm container instance (no second `standard-1` bill) and exploits a real synergy: knowing the true type improves malware analysis. The module is built as its own route inside the scan service so it can be lifted into a dedicated worker if its cadence or scaling diverges — the measured-trigger extraction the rubric anticipates.

**(3) Raw facts in the Container; verdict in the app.** Mirrors the established scan split (`RawScanResult` → app-side `computeVerdict`). The Container returns `RawIdentifyResult` (`label`, `score`, `group`, `magikaVersion`, `modelVersion`) — raw facts only, no comparison. `@magna-carta/file-type` in the app Worker runs `buildFileTypeReport(raw, filename)`, a pure deterministic function, to assemble the extension-match verdict and recommendation. The testable decision logic stays in TypeScript; the container stays a thin engine.

**(4) Probabilistic-with-confidence framing.** Magika is a probabilistic model. The report always surfaces `confidence` (`0..1`); there is no score gate today — `buildFileTypeReport` keys only on the Magika label, never on a threshold. Confidence-threshold UX (presenting identification as hedged rather than definitive when confidence falls below a configurable floor) is deferred to the widget.

**(5) `ort`/ONNX Runtime (C++) — owner-consented golden-rule-14 exception.** The Magika Rust crate performs inference via `ort`/ONNX Runtime (C++), not a pure-Rust implementation. This introduces a C++ dependency. Accepted as a contained exception: ONNX Runtime is fetched at container build time and statically linked; the scan container is sealed (no public surface, `enableInternet = false`, no runtime egress). The containment posture is consistent with the existing clamd and vectorscan precedents in the same container, both of which carry native C/C++ code for the same reason — running a heavy engine over untrusted bytes inside a sealed boundary.

**Considered and rejected.** A second deterministic signature detector alongside Magika — rejected in favour of a single trusted engine with a confidence score as the hedge; a fallback engine adds complexity without adding reliability for the text-format gap. Client-side identification — rejected because all untrusted-byte work runs in the sealed container, consistent with the containment posture across the scan subsystem.

**Consequences.** The `@magna-carta/file-type` pure package is independently testable and re-usable by any future consumer (matter-action ingest flag, production file-type audit). `RawIdentifyResult` carries `magikaVersion` and `modelVersion` separately, enabling future re-identify-after-model-update audit trails that can reason about which model produced a finding. The tool is stateless and record-less (the Tools-area ethereal principle); the only open seam is a matter-action consumer that would stream per-file identifications across a document set.
