# OCR engine — design

**Date:** 2026-07-09
**Status:** Design approved; implementation plan pending.
**Scope:** The OCR engine, its container, its worker, and the route that reaches it. Raw facts only — no searchable-PDF output, no ingest wiring, no user interface.

## Why now

OCR is named as a pipeline stage in four places in the white paper — discovery ingest, PDF services (scanned PDF to searchable PDF), the delivery-model parity table, and the performance model's heavy-compute placement — and three future subsystems depend on it: the PDF tool, conflicts and discovery, and search. None of them can be built against a seam that does not exist. This slice builds the engine so those consumers have one contract to target.

ADR-0060 already chose the engine class: PaddleOCR PP-OCR models consumed as ONNX through the Rust `ort` crate, never the PaddlePaddle framework, compiled native for both the server container and the desktop, so location is a deployment detail rather than a divergent implementation. That ADR deferred three questions to build time. This design answers them and corrects one overclaim.

## What changed since ADR-0060

**The model generation moved.** PP-OCRv6 shipped on 2026-06-11 with official first-party ONNX exports published by the PaddlePaddle organization under Apache-2.0. PP-OCRv5's ONNX artifacts were community conversions of Paddle-format weights, with license text that varied by republisher. Taking v6 is both an accuracy gain and a provenance gain, and it removes the need to trust or self-run a `paddle2onnx` export.

**The crate spike resolves without a spike.** `oar-ocr` (Apache-2.0, `ort` backend) provides detection, recognition, document-orientation classification, text-line orientation, and rectification in one crate, and can embed model bytes into the binary. Rectification and orientation are not optional extras for scanned legal exhibits; they are the difference between usable and useless output on a page fed crooked through a scanner. The alternatives are ruled out on their merits rather than by preference: `retto` is a single-developer work in progress, `ocrs` is Latin-script only, and the MNN-backed crates (`rust-paddle-ocr` and its relatives) would introduce a second C++ inference runtime with weaker provenance.

**Determinism was overclaimed.** ADR-0060 rests on "same input must yield same output regardless of where it ran," because OCR text feeds discovery evidentiary hashing. ONNX Runtime makes no cross-architecture bit-exactness guarantee, and cannot: floating-point addition is not associative, and SIMD reduction order differs between x86-64 and ARM64. In practice, argmax and CTC decoding quantize small logit differences away and the decoded text matches; near a decision boundary a marginal glyph may not. The corrected position is below.

## Golden rule 14 — the C++ consent

The only memory-unsafe code in this design is ONNX Runtime, reached through the Rust `ort` crate. The consent is granted on four grounds.

It adds no new C++ surface. `containers/scan/Cargo.toml` already pins `ort` to run Magika for file-type verification, under an existing consent. This is the same library, the same version line, the same statically-linked build, the same base image.

There is no Rust alternative at the required breadth. `ocrs`, on the pure-Rust RTen runtime, is the one credible memory-safe engine, and it recognizes Latin script only. Discovery will meet Chinese, Japanese, and Greek documents, all of which the chosen engine reads and `ocrs` cannot. It remains the named escape hatch should a C++-free build ever become a hard requirement.

The unsafe code never parses untrusted bytes. ONNX Runtime reads exactly two things: our own model file, pinned and baked in at build time, and a decoded pixel buffer. The untrusted document is parsed by pure Rust — `hayro` inside `pdf-core::render_page`, or the `image` crate — and what crosses into C++ is a flat array of pixel values with no structure left to exploit. This inverts the exposure golden rule 14 exists to prevent. Tesseract fails the same test, since its C++ reaches image decoding through Leptonica.

Accepting it lets us refuse worse C++. Saying yes to the ONNX Runtime already in the tree is what permits saying no to MNN without surrendering accuracy or language coverage.

Residual, disclosed: a future Tauri desktop build ships ONNX Runtime's C++ onto user machines. That is new surface relative to keeping inference server-side, and it is a decision for the desktop slice, not this one. Today the code runs only in a container with `enableInternet = false`, behind the harness's panic net, scaling to zero.

## Architecture

Three units, following `containers/file-repair` — the first container built on the engine host — as the reference shape.

**`crates/ocr-core`** is the engine: pixels in, OCR facts out. No I/O, no HTTP, no serde, no knowledge of firms or PDFs. It owns the `oar-ocr` pipeline, the session configuration, and the model handle. Same posture as `crates/recovery-core`.

**`containers/ocr`** is an axum service on port 8080, built with `engine_host::host` (`ready_app` for the `/ready` probe and body limit, `with_panic_net` so a panic becomes a 500 rather than a dead container, `serve` for the port contract). It links `ocr-core` and `pdf-core`, exposes one work route, and marshals engine output to a JSON response body that matches a TypeScript type exactly.

**`apps/ocr-worker`** is the four-file worker wrapper: a `wrangler.jsonc` declaring the container and its Durable Object, an `OcrEngineContainer` class (`defaultPort = 8080`, `sleepAfter = "5m"`, `enableInternet = false`, `pingEndpoint = "ready"`), a verbatim forwarding proxy, and an `index.ts` that exports the Durable Object class. No public surface, reached only through a service binding. No warm cron: the container scales to zero, and the idle-cost lesson from the scan container's warm-poke is not repeated.

The container base image must be `rust:1-trixie` building to `debian:trixie-slim`, not bookworm. ONNX Runtime's prebuilt binaries reference glibc 2.38 symbols; bookworm's 2.36 fails to link, and that failure appears only in the cloud build. The runtime stage additionally needs `libstdc++6` and `libgomp1`.

## The engine contract

One route, `POST /ocr`, accepting an image or a PDF as a raw request body.

For an image, the `image` crate decodes it under explicit `image::Limits` — the decompression-bomb posture the raster container already established — and the pixels go to the engine.

For a PDF, the container walks pages. Each page is first tested with `pdf-core`'s public `page_text_rects`: a page that already carries visible glyphs already has a text layer, and is skipped with a recorded reason. This check is cheap and it is the difference between OCR-ing a four-hundred-page production and OCR-ing the twelve scanned pages inside it. Pages that need OCR are rasterized through the public `render_page` at 300 DPI and passed to the engine as pixels.

The response is per-page raw facts and nothing else: recognized text, word-level bounding boxes expressed in PDF user space, per-word confidence, detected page orientation, and for skipped pages the reason they were skipped. The container writes no file, stores nothing, and never learns which firm it is serving — the worker resolves the firm from the session, reads the bytes, and streams them in, exactly as the existing scan and file-type routes do.

The container returns raw facts and never a judgment. A fault is a retryable 503, never a fabricated empty result: an empty text layer and a failed inference must not be indistinguishable to a caller who is about to file something.

## Provenance and determinism

Every result carries three separable version fields. Collapsing them is a mistake this codebase has already made once, in the scan engine, where `engineVersion` conflates engine code with ruleset versions.

- `engineVersion` — the `ocr-core` code that ran.
- `modelVersion` — the pinned ONNX artifact, by revision.
- `platform` — the architecture that produced the result.

The server is canonical. The x86-64 container is the single source of evidentiary truth, running with pinned session options — one intra-op thread, one inter-op thread, sequential execution mode, a fixed graph-optimization level — so that it is reproducible against itself, which is the property that actually matters for re-running a production. A future desktop path is a speed and privacy accelerator whose output is marked provisional and never enters a production or a privilege log without a server run confirming it. A model upgrade triggers re-OCR rather than a silent divergence between documents processed before and after.

This preserves what ADR-0060 wanted — reproducible discovery output, accurate search, defensible hashes — while stating honestly what ONNX Runtime does and does not guarantee.

## The model artifact

The official `PaddlePaddle/PP-OCRv6_*_onnx` repositories, pinned to an exact revision and verified by SHA-256 during the Docker build, baked into the image. This mirrors how the scan container fetches YARA Forge rules and runs `freshclam` at build time: the build stage has network access, the runtime stage has none. Weights never enter git, and nothing is fetched at request time.

**The artifact is two files per model, not one.** Alongside `inference.onnx`, each repository ships an `inference.yml` carrying the pre- and post-processing transform configuration and, for the recognition model, the character dictionary. That dictionary is not decoration: without it the model emits class indices with nothing to map them onto. Both files are pinned by revision and verified by SHA-256.

**Compatibility is verified, not assumed.** Reading the operator-set declarations directly out of the published protobufs: detection is opset 14 (IR version 10), recognition is opset 11 (IR version 6). Every operator across all four graphs is a standard ONNX core operator — `Conv`, `ConvTranspose`, `Resize`, `MatMul`, `Softmax`, and the like — with no custom domain, and none of the `deformable_conv` or `fake_quantize_*` operators that are the documented failure mode for PaddlePaddle exports on ONNX Runtime. ONNX Runtime supports every opset back to 7 and never drops support, so opset 14 loads on the ONNX Runtime 1.24 the pinned `ort` ships, with wide headroom. No self-export fallback is needed.

**Tier: measured, not asserted.** PP-OCRv6 publishes three tiers, and medium is the ceiling — there is no larger model hiding in v5, since v6 medium is both smaller than and more accurate than v5's server-tier recognizer.

| tier   | detection | recognition | total    |
| ------ | --------- | ----------- | -------- |
| tiny   | 1.8 MB    | 4.5 MB      | 6.2 MB   |
| small  | 9.9 MB    | 21.2 MB     | 31.0 MB  |
| medium | 62.0 MB   | 76.6 MB     | 138.6 MB |

The vendor publishes no clean CPU benchmark separating these tiers on documents shaped like ours, so the tier was pinned by measurement rather than by the marketing numbers. Swept over 13 born-digital documents rendered to raster and degraded, the three tiers landed within one character-error-rate point of each other (tiny 0.520, small 0.516, medium 0.510 — noise, not a real ranking), while small led on word-box overlap against the true glyph boxes (0.754 vs. medium's 0.750) at a quarter of medium's baked size (31.0 MB vs. 138.6 MB) and a comparable cold-load time. **Small is the tier the image bakes.** The absolute error rate is understated by the benchmark's own ground-truth limitations — the glyph text the observer path extracts carries no word-spaces, and follows PDF paint order rather than visual reading order — so these numbers are read as a relative ranking between tiers, not an absolute accuracy claim; the harness remains the committed regression baseline for every later model upgrade.

**Ground truth without a labelled corpus.** We have no corpus of scanned legal exhibits with known-correct text, and hand-labelling one is not proportionate. The PDF engine can manufacture ground truth instead: take born-digital documents that already carry real text layers — the court forms and government filings already in the validation corpus — render each page to raster at 300 DPI through `render_page`, degrade it the way a scanner does (skew, noise, JPEG artefacts, resampling), then OCR the raster and compare against the text and glyph boxes the observer path extracts from the _original_. That gives exact per-glyph ground truth on our own document shapes, at zero labelling cost, and it exercises the whole rasterize-and-recognize path rather than the model alone.

The benchmark reports character error rate, word-box overlap against the true glyph boxes, pages per second, cold-start model-load time, and image size, for each of the three tiers. With error rate landing within noise across all three, word-box overlap and image size became the deciding measurements — see above. The measurement is worth having beyond this choice: it is the regression baseline for every later model upgrade, which is what makes the re-OCR discipline enforceable rather than aspirational.

**Recognition covers Latin, CJK, and Greek — and nothing else.** Read directly from the v6 recognition dictionary: 18,707 entries, of which 15,565 are CJK ideographs, the remainder Latin, Greek, Japanese kana, and punctuation. Cyrillic, Arabic, Hebrew, Devanagari, Hangul, and Thai are absent entirely — zero codepoints from each. PP-OCRv6's "50 languages" means fifty Latin-script and CJK languages. PaddlePaddle ships per-script recognizers (`korean_`, `cyrillic_`, `arabic_`, `devanagari_`, `th_`, `latin_`, `el_`, Tamil, Telugu) only for **v5**; there is no v6 equivalent.

Detection is script-agnostic, so the recognizer — not the detector — is the component that varies. The engine treats the recognizer as a swappable unit selected per text line, and registers exactly one today. When a matter demands Cyrillic or Arabic, a v5 per-script recognizer is registered behind the same seam and stamps its own `modelVersion`, so a document is never silently read by a model that cannot represent its script. Building the seam now is cheap; retrofitting it around a hardcoded recognizer is not.

The scripts absent from the v6 dictionary — Cyrillic, Arabic, Hebrew, Devanagari, Hangul, and Thai — are accepted as out of scope for now; the per-script seam stays dormant until a matter needs one of them.

## Reachability

The container is reached through a `POST /api/v1/ocr` route on the main worker, which brings the standard tool-registration surface: a `tools:ocr` permission in the access-control registry, a tool-catalog entry, a per-firm role-grant seed migration registered in both the drizzle journal and `per-firm-migrations.ts`, and an OpenAPI contract regeneration. The user interface is deferred, exactly as it was for the file-type verifier and the metadata tool.

The route validates the container's JSON at the trust boundary with zod before mapping it, and returns a clean 503 when the service binding is absent — so the local test pool, which cannot bind a container, and a pre-deploy production both degrade honestly rather than fabricating a result.

## Validation

`pdf-eval`'s `ValidationOperation` trait already names OCR as a future operation in its own doc comment, so an `operations/ocr.rs` drops in beside `forms` and `surgery`. Robustness comes free from the runner: it executes each operation under `catch_unwind` with a timeout, so a panic becomes `Panicked` and a hang becomes `TimedOut` rather than taking down the run.

The safety invariant is that OCR is strictly additive and non-destructive. A page that already carried real text still carries it afterward. No privileged content reaches a log, an error label, or a `Problem` response. A page we declined to process is reported as `Skipped` with a reason rather than silently returning empty text — because a caller cannot distinguish "this page has no words" from "we gave up" unless we tell them.

Because the OCR container cannot run under the worker test pool (the same constraint the scan container has, where `ort` linkage fails outside the image), the acceptance gate is a container CI job that builds the image and boots it, plus the worker proxy tested against a fake container.

The model benchmark is part of this slice and lives beside the validation harness, since it reuses the same corpus and reporting core. It sweeps the three tiers over the degraded-render corpus and reports character error rate, word-box overlap, pages per second, cold-start model-load time, and image size. Its output pins the tier, and its baseline is committed so that a later model upgrade must demonstrate it did not regress rather than assert it.

## Explicitly out of scope

No invisible text-layer writer, and therefore no searchable-PDF output. Nothing in the codebase emits the `3 Tr` render-mode operator today; the writer belongs in `pdf-core` beside the Bates content-append path, whose WinAnsi glyph-advance tables and non-destructive `/Resources` merge it would reuse. That is the natural next slice, and it consumes exactly the word boxes this slice produces.

No ingest-time OCR, no queue, no job-coordinator Durable Object, no per-page progress. No search index. No Tauri desktop path. No user interface.

## Consequences

The three subsystems that depend on OCR gain one contract to build against. Discovery ingest, the PDF tool's searchable-PDF operation, and conflicts search all consume per-page facts with explicit provenance, and none of them needs to know where inference ran. The cost is carrying an ONNX model artifact through the build, the discipline of stamping and honoring three version fields, and re-OCR on model upgrade.

ADR-0060 is amended rather than superseded: the engine class, the ONNX-not-PaddlePaddle stance, the CPU-only and permissive-license constraints, and the one-engine-two-locations goal all stand. The model generation moves to v6, the crate is settled as `oar-ocr`, and the determinism claim is narrowed from cross-architecture to server-canonical.
