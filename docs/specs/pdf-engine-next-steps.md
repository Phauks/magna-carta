# PDF engine — next steps & priorities

**Purpose:** a living handoff for whoever picks up the pure-Rust PDF engine (`crates/pdf-core` → WASM as `@magna-carta/pdf`; test harness `crates/pdf-eval`). It says what is built, what remains, and — with reasoning — what to do next. It is **not** the architecture home: read the design docs in [`docs/specs/`](.) (the `2026-*-pdf-*` files) and the white paper's _PDF render engine_ material for the "why/how". Live per-feature status is the **PDF render engine** row of [`STATUS.md`](../../STATUS.md); verify currency with `git`, not this file.

**Doctrine (unchanged, load-bearing):** compose pure-Rust crates, build only the gaps; off-PDFium, permissive licences; memory-safe by default (golden rule 14 — surface any C/C++ dependency and get consent before adopting). Surgery/redaction correctness rests on a **safe-flatten-on-any-doubt** model, never a guess.

## What is built (on main)

Render; rasterize-and-reassemble redaction + 3-layer gate; text-preserving **surgery** (now including the **byte-level fallback** for streams that cannot be re-encoded — inline images); whole-document scrub; bad-redaction detector (all categories); Bates numbering; AcroForm forms (read/fill/flatten); secure/encrypt (AES-256 write + decrypt-with-known-password); generate primitives (merge/split/rotate/watermark); the decompression-bomb guard. A reusable validation harness (`pdf-eval`) drives these against a corpus.

The safety net under surgery is four independent layers — **decode-first → tokenizer/lopdf count+name self-check → hayro outcome gate → surviving-text scan** — any of which forces a raster flatten rather than emit a doubtful result. Preserve this property in every change.

## Next steps, by priority

### Tier 1 — finish and stabilize what just landed (cheap, do first)

1. **Run the surgery corpus and settle "bar B".** The byte-level surgery merged with its `pdf-eval` shadow diagnostic (`SurgeryOperation`: `byte_path_recovers` = bar-A win, `byte_path_regresses` = bar-B blocker) but the corpus **numbers** were never produced — the corpus is not fetched in a local worktree (needs `corpus-fetch` + network). Fetch it, run the `validate` mode, and read the two signals. Expected: TAMReview flips flatten→surger (bar A confirmed). If **zero** `byte_path_regresses` across the corpus, execute **bar B**: delete the whole-stream op-path branch in `try_build_surgery` and route all surgery through `build_byte_splice`, keeping the outcome gate — one code path, less to reason about. If any regression appears, the report names the page; keep the op-path and investigate. _Why first: it closes the loop on shipped code and either simplifies the engine or surfaces a real defect, for little cost._

2. **Split `crates/pdf-core/src/surgery.rs` (~2600 lines, five responsibilities).** No defect from the size, but it is about to absorb more (signing/OCR touch the same file). Do the pure refactor on its own branch **before** the next big feature grows it further. Suggested modules, tests moving alongside each: `surgery/mod.rs` (orchestration, `content_roundtrips`, disposition types), `glyphs.rs` (glyph enumeration + text-state machine, `FontMetrics`/`page_fonts`, mediabox/rotate resolvers), `excise.rs` (`OpRewrite`, `rebuild_tj_array`, `op_replacements`, `fill_box_operations`, `apply_excision`), `splice.rs` (`encode_operations`, `build_byte_splice` — pairs with the already-separate `content_tokens.rs`), `diagnostic.rs` (`compare_surgery_paths`). _Why now: cheapest while the code is fresh in review; a refactor after PAdES/OCR land is more painful._

### Tier 2 — the next major capabilities (owner-set order: PAdES, then OCR)

3. **PAdES / e-signature core (Slice 2·5).** The chosen next feature; the engine substrate and the decrypt dependency it needed are in place. Real product value for a legal platform (signing, and verifying document authenticity). Start with a design pass (brainstorm → spec → plan) — signature validation and long-term-validation (LTV) semantics deserve their own spec. _Priority: the headline remaining feature._

4. **OCR.** High value for discovery and search over scanned documents, and the validation harness is already positioned to test it. **Caveat before committing:** most OCR engines (Tesseract) are C/C++ — golden rule 14 requires a memory-safe alternative where one exists, and explicit owner consent otherwise. Research the pure-Rust / memory-safe OCR landscape (and whether a consented, network-isolated container like the malware scanner's clamd is the right containment) as the **first** task of this effort, not an afterthought. _Priority: high value, larger investment, gated on the dependency decision._

### Tier 3 — confidentiality & robustness (slot in before onboarding firms)

5. **Encrypted-ObjStm bounded loader.** The decompression-bomb guard left encrypted stream bodies as a **disclosed residual** (the guard sees ciphertext, so an encrypted object stream can still inflate unbounded after lopdf decrypts it). This is a confidentiality/DoS gap for firms that handle encrypted PDFs. Forking lopdf is off-charter, so it needs a bounded loader design. Do it before a firm that ingests encrypted PDFs onboards. _Priority: the one open security residual in the engine._

6. **Post-splice untouched-byte verification (deferred hardening).** `build_byte_splice`'s self-check aligns operator names/count but not span exactness; a name-aligned-but-span-misaligned tokenization could in principle corrupt **adjacent unmarked** content (not a redaction leak — the outcome gate still catches marked-glyph survival). Extremely unlikely given maximal-munch tokenizing, and accepted by the design, but a cheap post-splice pass confirming every non-replaced byte is identical to the input would close it fully. _Priority: low; nice defense-in-depth._

### Tier 4 — coverage & delivery (gated or low value)

7. **Form-XObject text recursion** — recurse surgery into `Do`-invoked Form XObjects (compose CTM × Matrix; mind that a **shared** XObject cannot be rewritten per-invocation). Medium effort, ~one more corpus doc. Coverage, not correctness (exotic pages safe-flatten today).
8. **`wasm-opt`** — the current wasm is `--no-opt` (~4–6 MB). Needed before the in-app Tool UIs and inline viewer ship; a build/packaging task, gated on the 0·7 design-system shell.
9. **Consumer surfaces** — the detector Tool, in-matter inspection + LLM cross-check, the Bates Tool, and the inline preview / safe-delivery host — all gated on the 0·7 design system, after the engine work.

### Explicitly deferred (do NOT spend effort here without a driver)

- **CJK / non-Identity Type0 fonts in surgery** — needs CMap parsing and has **zero** value on the current corpus. Skip until a real document demands it.
- **Position-math tightening beyond the whitespace fix** — the remaining imprecision only ever **over**-flattens (safe); not worth chasing.

## How to work on the engine

- **Measure with `pdf-eval`, not by eye.** It has isolated per-document runs (panic/timeout-safe), a forms operation, a `surgery-coverage` mode, and the new shadow `surgery` operation. Add an operation per capability you build (OCR especially). Corpus fetch is feature-gated (reqwest/rustls); the full corpus needs network.
- **Build gotchas (real, will bite):** native `pdf-core` test builds OOM this machine without `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1"`. Do **not** `cargo fmt` the crate — local rustfmt drift churns unrelated files; format only your lines. The Rust workspace root is `crates/Cargo.toml`, not the repo root. `src/pkg` wasm is git-ignored (CI rebuilds); a fresh worktree lacks the decryption package's built WASM, which breaks the worker Miniflare suite (unrelated to the engine).
- **lopdf 0.41 sharp edges:** its `content::Content` decode/encode is **lossy for inline images** (the reason byte-level surgery exists); encrypted-doc load must use `load_mem_with_options(.., LoadOptions::with_password(pw))` then `trailer.remove(b"Encrypt")`, not `load_mem` + `decrypt`; `Document::clone` is deep. More in the engine memory notes.
- **Never weaken the safe-flatten nets.** Any new surgery/redaction path must keep: decode-first, a self-check that flattens on divergence, and the outcome gate. A wrong result must degrade to a raster flatten, never to a leak or silent corruption.

## Priority summary (my recommendation)

Do **Tier 1** immediately (corpus run + bar-B decision, then the `surgery.rs` split) — small, and they either simplify the engine or pay down debt before it compounds. Then **PAdES** as the next real feature (owner-set), with the **encrypted-ObjStm loader** slotted in before any firm handling encrypted PDFs onboards. **OCR** is high-value but starts with a memory-safe-dependency decision, so scope that research first. Everything in Tier 4 is gated on the 0·7 UI or is low value; ignore the "deferred" list until something concrete needs it.
