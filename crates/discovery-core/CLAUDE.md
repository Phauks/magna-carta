# discovery-core (crates/discovery-core) — CLAUDE.md

**Purpose.** A pure, I/O-free discovery engine: bytes in, facts out. It identifies a document from
its bytes, extracts its text natively, normalizes that text, chunks it into passages, digests it five
ways, fingerprints it for near-duplicate work, and enumerates or expands an archive under hard
guards. It compiles to `wasm32-unknown-unknown` and to native `rlib`/`cdylib` alike.

## The vocabulary rule binds hardest here

**Nothing in this crate — or anywhere in the platform — is a bare `custodian`.** The physical
safekeeping register (`packages/custodian`) keeps the `custody*` family and its `custodyOwner`;
discovery's attribution is the **record custodian**, always two words, in code, in comments, and in
any consumer-facing string. The two are different real-world things that appear in the same matter,
sometimes on the same screen, and one word meaning both is a defect waiting to happen.

A source scan enforces both directions (`pnpm run lint:custodian-vocabulary`), so this is mechanical
rather than a rule anyone has to remember. Today this crate names neither — the review-set model that
carries record custodians is above it — and the scan is what keeps it that way as the area grows.

## Untrusted, privileged bytes — the rules that bind every line

This engine's entire input is files chosen by the party on the other side of a case, and its entire
output feeds material under privilege. That is the **worst case** the memory-safety rule exists for,
not an edge case.

- **Pure Rust, and every codec backend declared explicitly.** No C-backed crate feature on any path:
  `zip` on `deflate-flate2`, `flate2` on `rust_backend` (miniz_oxide). `manifest_declares_only_pure_rust_backends`
  in `src/lib.rs` reads this crate's own `Cargo.toml` at compile time and fails if a C-backed feature
  or crate ever appears — including through a well-meant edit that turns a default back on.
- **Never a panic as control flow.** Every malformed, truncated, encrypted, or absurd input becomes a
  `DiscoveryError`. This crate runs where the stack cannot unwind: a panic on a crafted document is
  not a caught error, it is an aborted isolate.
- **A declared length never sizes an allocation.** Read one byte past the ceiling to detect passing
  it; never `with_capacity(declared)`.
- **Guards precede parsing.** Size, depth, ratio, entry-count, and traversal checks all run before
  the decoder they protect, never after.
- **Error payloads carry stable codes, never content.** `DISCOVERY_ERROR_CODES` is a fixed set of
  `&'static str`; `error.rs`'s own tests assert the set matches the variants exactly and that no code
  can look like a file name, a path, or prose.
- **The hostile-input sweep is part of the suite.** `src/lib.rs`'s `hostile_input` module runs every
  fixture through truncation, bit-flip, and absurd-declared-length mutations against every entry
  point. Add a fixture there when you add a format.

## Identification reads bytes, and cannot read a name

`identify` takes bytes and nothing else — there is no parameter a file name could arrive through, so
"identified by extension" is a thing this module has no way to do. Comparing the two answers is a
separate call (`name_agreement`) whose result is REPORTED and never acted on. Keep it that way: a
production's file names are frequently wrong, and a name is the cheapest part of a hostile file for
an opposing party to control.

## Normalization is the determinism boundary

Everything derived — passages, the fingerprint, and therefore the splits and the near-duplicate
answer — is derived from `normalize`'s output and never from raw extracted text. The rules and their
ORDER are the contract, pinned by `src/normalize.rs`'s tests and by the committed cross-target
vectors in `src/determinism.rs`. Do not add a rule without a vector.

The vectors run twice, on purpose: natively under `cargo test` and on `wasm32` under `wasm-pack test`,
against the same fixed answers. The desktop client and the server run this same crate over the same
documents into one index — an engine that read them differently would build two indexes that disagree
about what a document says.

## The passage chunker is a moved rule, not a new one

`chunk.rs` reproduces `packages/search/src/extraction.ts`'s page-as-chunk rule **byte for byte**,
down to the `page-<index>` chunk identifier and the empty-page-contributes-nothing rule. Its test
carries that suite's own corpus with the expected values copied rather than recomputed, so a
divergence fails instead of agreeing with itself. If the rule ever changes, it changes in both places
in one commit or the two implementations have silently forked.

## What is deliberately NOT here

- **Recognition** stays `crates/ocr-core` and its container. Pulling it in would couple this engine's
  version to a model set's version, and the load manifest has to record them separately.
- **Legacy binary conversion** stays the LibreOffice container — the consented, network-isolated C++
  engine. This crate reports `NeedsConversion` and never reaches it.
- **Tantivy and the split format** stay `crates/search-core`.
- **Anything that knows what a review set is.** This crate has no idea a matter exists.

## Commands

```
cargo test --manifest-path crates/Cargo.toml -p discovery-core
cargo build --manifest-path crates/Cargo.toml -p discovery-core --target wasm32-unknown-unknown
cargo fmt --manifest-path crates/Cargo.toml --check
cargo clippy --manifest-path crates/Cargo.toml -p discovery-core --all-targets -- -D warnings
```

The clippy gate runs `--all-targets`, so it lints test code too.

## Gotchas

- After any `Cargo.toml` dependency change, regenerate and commit `crates/Cargo.lock` — a stale lock
  fails `cargo build --locked` and CI with it. Changing a dependency also means re-reading the
  manifest assertion in `src/lib.rs`: it is the golden-rule-14 gate, and it only holds if it is kept
  honest about what a C-backed selection looks like.
- `src/test_support.rs` BUILDS its fixtures rather than committing them. That is deliberate twice
  over: a constructed fixture states in code which structural feature it exercises, and a corpus of
  hostile archives is not a thing to leave in a repository as files. The one exception is the PDF
  corpus, embedded from `crates/pdf-core/tests/fixtures/` with `include_bytes!` so it works on the
  wasm target, which has no file system.
- `src/wasm.rs` is marshalling only. Logic that lives only on one target is logic the native build
  never runs and the desktop client therefore never gets.
