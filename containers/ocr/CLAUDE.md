# containers/ocr — local rules

The OCR engine container. Bytes in, per-page raw facts out. It never learns which firm it serves.

- **Never fabricate a result.** An inference fault is a 503 with a stable code. An empty text layer
  and a failed recognition must never be indistinguishable to a caller who is about to file something.
- **A skipped page is reported as skipped**, with a reason — never as a page with no words.
- **Memory-safety posture.** Two C/C++ dependencies are linked into the binary this container ships,
  both consented:
  - **ONNX Runtime (C++)** reaches this container through the Rust `ort` crate, pulled in by
    `ocr-core`'s `oar-ocr` dependency. It parses exactly two things: our own pinned model files, and
    a decoded pixel buffer. The untrusted document is parsed by pure Rust — `hayro` inside
    `pdf-core`, or the `image` crate — before anything reaches C++. Keep it that way: never hand raw
    document bytes to the engine.
  - **Oniguruma (`onig_sys`, C)** is also linked in, pulled in by `tokenizers` via `oar-ocr` ->
    `oar-ocr-core` (`tokenizers = { ..., features = ["onig"] }`); Cargo feature unification cannot
    remove it. `tokenizers` exists to serve vision-language models this pipeline does not use —
    detection and recognition never construct a tokenizer — so Oniguruma is believed unreachable on
    this code path and never receives document bytes. That is reasoning from `tokenizers`' purpose,
    **not a proof**: the shipped binary has not been symbol-scanned to confirm the tokenizer code,
    and Oniguruma with it, is eliminated at link time. Removing it outright would require forking
    `oar-ocr-core` to make `tokenizers` optional.

  `oar-ocr`'s `download-binaries` feature (needed to fetch the ONNX Runtime archive at build time)
  forces `ort/tls-native`, which reaches the build only through `ort-sys`'s `[build-dependencies]` —
  `native-tls` compiles for the host to make that one HTTPS fetch during the build, and is never
  linked into the binary this container ships. Do not read that as "no native-TLS anywhere in the
  graph"; it is real, it is just confined to the build script rather than the runtime.

- **The base image must be trixie.** ONNX Runtime's prebuilt binaries need glibc 2.38; bookworm's
  2.36 fails to link, and only the cloud build catches it. The runtime stage needs `libstdc++6`
  and `libgomp1`.
- **Sessions are single-threaded and sequential.** ONNX Runtime's thread count and execution mode are
  the run-to-run sources of divergence, and a re-run of a production must reproduce its own output.
- **Models are baked at build time and verified by SHA-256.** Nothing is fetched at request time; the
  container runs with outbound networking disabled.
- The engine cannot run under the local worker test pool, so the proxy is exercised against a fake
  container and the real image is built and booted in a container CI job.
