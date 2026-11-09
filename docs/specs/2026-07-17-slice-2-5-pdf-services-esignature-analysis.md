# Slice 2·5 — PDF services + e-signature core — analysis & development-prep

**Status:** Analysis (pre-design; seeds the design cycle) · **Date:** 2026-07-17 · **Owner:** Trevor Goldsmith
**White-paper home:** _PDF services_ (§18.5), _E-signature_ (§18.6)
**Governing ADRs:** ADR-0045 (in-house PDF services + e-signature, **Proposed**) · ADR-0046 (PQC posture — signatures seamed, deferred) · the pure-Rust PDF-engine ADRs (`pdf-engine-pure-rust-core`, `hayro-dependency-doctrine`)
**Supersedes as guidance:** [`2026-06-13-embedpdf-signing-options.md`](2026-06-13-embedpdf-signing-options.md) — its A-vs-B analysis is over the **retired** EmbedPDF/PDFium stack (see §2); the product-layer reasoning it records still holds.
**Living engine handoff:** [`pdf-engine-next-steps.md`](pdf-engine-next-steps.md) (Tier 2, item 3)

This is a **pre-design analysis**, not an implementation-grade spec. It consolidates where slice 2·5 actually stands, names the concrete gaps a build must close, and recommends how to decompose and sequence the design cycle. Per golden rule 8 (design before code) and the engine handoff, PAdES/e-signature "starts with a design pass (brainstorm → spec → plan)"; this brief is the input to that pass. Nothing here is a decision — it is the map that lets the design cycle start from evidence rather than a blank page.

---

## 1. What slice 2·5 is, and where it actually stands

Slice 2·5 has two halves under one white-paper home:

- **PDF services** (_§18.5_) — fill, draw, stamp/watermark, merge/split, rotate, flatten, secure, redact, Bates, and seal/sign, unified behind one engine.
- **E-signature core** (_§18.6_) — first-party e-signature (ESIGN/UETA model, **not** per-signer PKI), a **PAdES platform seal**, a server-observed **audit trail**, a **Certificate of Completion**, and an **attribution spectrum** keyed to document risk.

**The PDF-services half is substantially built** — as the cross-cutting _PDF render engine_ program (`crates/pdf-core` → WASM `@magna-carta/pdf`), not under the 2·5 label. On `main` today (`crates/pdf-core/src/`): render (`hayro`), rasterize-and-reassemble **redaction** + the 3-layer gate, text-preserving **surgery** (incl. byte-level fallback), whole-document **scrub**, the **bad-redaction detector**, **Bates** numbering, **AcroForm forms** (read/fill/flatten), **secure/encrypt** (AES-256 write + decrypt-with-known-password), **generate** primitives (merge/split/rotate/**watermark**), an invisible **searchable-text-layer** writer, and the **decompression-bomb guard**. A reusable corpus harness (`crates/pdf-eval`) drives them.

**The e-signature half is not started.** `crates/pdf-core/src/lib.rs` exports no signing module; there is **no `@magna-carta/signing` package** (`packages/` confirms); there is no signature dictionary / `/ByteRange` / CMS path anywhere. STATUS marks slice 2·5 `[~]` across the board precisely because the substrate is up but the e-sign/PAdES surface and consumer surfaces are absent.

**So "prepare for development" on 2·5 = prepare the e-signature core.** The PDF-services operations are done or tracked under the engine program; the open, headline work is signing/sealing + the ESIGN/UETA product layer + verification. Everything below is scoped to that.

---

## 2. The strategic supersession every design-cycle reader must know

The white paper (§18.5/§18.6) and ADR-0045 still describe the e-signature seal running on **`@signpdf` + `@cantoo/pdf-lib` + PDFium/EmbedPDF**. **That stack is retired.** The engine program replaced the forked-PDFium/EmbedPDF path with the **pure-Rust `pdf-core`** engine (drivers: escape the C++ fork, licensing freedom, one engine owns the bytes). Consequences for 2·5:

- **The seal structure is built in Rust, in `pdf-core`**, not by `@signpdf`/pdf-lib. The roadmap is explicit: "Sign / seal (PAdES) — the Rust core owns the PDF structure end-to-end; host-side crypto unchanged." The "one engine owns the bytes" thesis, now realized in Rust.
- **`2026-06-13-embedpdf-signing-options.md` is historical.** Its Option A (external `@signpdf`) and Option B (in-engine PDFium C++ export) are both moot — there is no PDFium and no `@signpdf`. What **survives** from it, and should be carried forward, is the product-layer analysis: the crypto stays host-side (private key never enters a WASM engine), the seal is applied as an **isolated incremental append** (not a core-saver rewrite), signing lives in its **own package** behind a stable `sealDocument(bytes, options) → sealedBytes` interface, and the ESIGN/UETA workflow + Certificate of Completion are ours in-tree regardless of the crypto backend.
- **The white-paper §18.5/§18.6 engine roster is stale** and should be corrected in the same cycle that specs 2·5 (its `> Needs development` block already flags every specific as provisional).

The **prepare → (host signs) → embed** shape stays exactly right; only the engine under it changed from PDFium-C++ to Rust `pdf-core`.

---

## 3. Concrete gaps a build must close (grounded in the code)

### 3.1 The incremental-update primitive — the critical engine gap

PAdES requires the signed content to be a `/ByteRange` in which **the original document bytes are preserved as a literal prefix**, with the signature added by a **PDF incremental update** (appended objects + a new xref section whose `/Prev` chains to the old `startxref` + a new `startxref`), and a single contiguous **zero-filled `/Contents` gap** excluded from the range and later spliced with the detached CMS.

The engine does **not** have this today. Its "additive" writers (`bates.rs`, `searchable.rs`) are additive **at the object-graph level** but serialize with **lopdf `doc.save_to()` — a full re-serialization** (verified in `searchable.rs:129`, `bates.rs:442`). "Byte-identical output" there means _deterministic across runs_, **not** _original bytes preserved as a prefix_. lopdf re-numbers/re-lays-out objects, so a Bates/searchable output is **not** a valid incremental update of its input and cannot carry a PAdES `/ByteRange`.

**Therefore the slice must build a true incremental-update writer in `pdf-core`** (or a signing-specific writer that: appends the signature dictionary + AcroForm `/Sig` field + `/ByteRange` array + reserved `/Contents` placeholder as an incremental section, leaving input bytes untouched, then computes the digest over the two `/ByteRange` spans and splices the CMS into the reserved gap). This is the single most load-bearing technical item and belongs at the front of the spec. It pairs naturally with the existing byte-level surgery machinery (`content_tokens.rs`, `surgery.rs`'s `build_byte_splice`) — the same "splice exact bytes into a reserved region, self-verify" discipline.

### 3.2 Crypto placement + CMS construction — the second open primitive

The seal is a **detached PKCS#7 / CMS** signature over the `/ByteRange` digest, using the platform (firm) certificate (ADR-0045). Two unresolved questions:

- **Where does the crypto run?** The white paper's own `> Needs development` item (2) flags "confirm the PAdES seal must run in a Container (reported Worker crypto limits)". Workers Web Crypto can do RSASSA-PKCS1-v1_5 / RSA-PSS / ECDSA raw signing, but **CMS/PKCS#7 ASN.1 structure assembly** is not primitive — it needs a library or in-house builder, and PAdES adds signed attributes (message digest, signing-certificate-v2/ESS, signing time). Decide: assemble CMS in a Worker (WebCrypto sign + a minimal ASN.1/CMS builder — pure-TS or Rust/WASM), or in a Container. Prefer the Worker if the CMS builder is tractable; the digest+sign is small and on no hot path.
- **What library, if any?** Golden rule 11 (verify current docs) + golden rule 14 (memory-safe): survey the pure-Rust/pure-TS CMS landscape (e.g. `rasn`/`rasn-cms`, `cms`/`x509-cert` RustCrypto crates, or a pure-TS PKI builder) **before** committing. Any C/C++ dependency needs explicit owner consent (none is expected here — this is pure ASN.1 + a WebCrypto/RustCrypto signature).

PAdES **level** is a scope decision: **PAdES-B-B** (basic, no timestamp) is the MVP; **B-T** (RFC 3161 timestamp token) and **B-LT/LTV** (validation material embedded) are named seams — ADR-0046 already versions the signature for a later ML-DSA rotation, so the algorithm/level is a versioned field, not a rewrite.

### 3.3 The product layer — `@magna-carta/signing`

New pure-domain package (the natural Fable-owned unit per the signing-options doc + the model-split policy — e-signatures are legal instruments → **foundational rigor**). It owns, independent of the crypto backend:

- The **ESIGN/UETA** four-element model — **intent, consent** (disclosure + checkbox), **association**, **attribution** — as a recorded signing act, not per-signer PKI.
- The **signing-session / envelope** state model (fields placed → sent → signer acts → sealed → completed), the field-placement model (signature/initial/date/text fields with page-space rects), and signature **adoption** (type/draw/upload).
- The **audit trail** — server-observed signer IP, timestamp, consent record, document hash at each step — written to the immutable `audit_log` (never client-self-reported).
- The **Certificate of Completion** — assembled from the authoritative log, stored as a versioned R2 sibling of the signed document.
- **Signature verification** — re-extract + validate the seal and the `/ByteRange` integrity (reuses the engine's extraction primitives, mirroring the redaction verification gate).
- The **attribution spectrum** binding: internal (Better Auth) strongest → external tokenized-email link → email/SMS access code → ID/KBA; **client-portal** signers sign while authenticated. Binds to the _Client portal_ per-share-assurance model (§18-portal) — a named integration point, likely partly deferred until the portal slice.
- The **plugin e-signature port seam** kept for the PKI/notarial long tail (certified filing, RON) — a named seam, not built.

### 3.4 Delivery + data model

Per-firm schema for envelopes/fields/signing-events/certificates (through the firm-scoped data-access layer, golden rule 3; bulk artifacts to R2, never D1). Worker routes through the slice 0·5 chokepoint (audited, RBAC-gated — a new `esign:*` permission namespace), the `signing.*` OpenAPI surface, and the completion→_Tasks/workflows_ + _Communications layer_ notification seams. Load-profile extension in-area (ADR-0078 accretion rule) — envelopes/events at volume. **UI is deferred** (0·7 design-system gate + the model-split policy makes UI a Fable matter) — the client-side field-placement/signing surfaces (§18.6 "client-side except the seal") land with the portal/0·7 work.

---

## 4. Reuse map — build on, don't reinvent (golden rule 1)

| Need                                                           | Reuse                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Splice exact bytes into a reserved region + self-verify        | `pdf-core` `content_tokens.rs` + `surgery.rs` `build_byte_splice` discipline                                                             |
| Additive object-graph write (sig dict, AcroForm field, widget) | the `bates.rs`/`searchable.rs` append patterns (but **replace** the `save_to` full-serialize tail with a true incremental append — §3.1) |
| Detached signature over a digest                               | Workers Web Crypto (RSA/ECDSA) or a RustCrypto signer in `pdf-core`/WASM                                                                 |
| Verification (does content survive / is the range intact)      | the redaction **verification-gate** pattern (re-extract, refuse on doubt)                                                                |
| Corpus-driven correctness measurement                          | `crates/pdf-eval` — add a `sign`/`verify` operation, as every capability does                                                            |
| Immutable audit + Error-ID correlation                         | `@magna-carta/telemetry` + the per-firm `audit_log` (golden rule 4)                                                                      |
| Money/scaling, identifiers, idempotency, outbox                | the 0·2 foundational packages (envelope IDs, idempotent send)                                                                            |
| Host-side key handling                                         | `@magna-carta/encryption` seams (the platform cert is a Worker-secret-rooted anchor, not a per-firm envelope key — confirm placement)    |

---

## 5. Open questions for the design cycle (carry these into the spec)

From the white paper's `> Needs development` block (§18.6) and ADR-0045's "verify before build", re-scoped to the pure-Rust reality:

1. **CMS/PAdES library** — pure-Rust or pure-TS CMS builder? Level B-B vs B-T/LTV for MVP? (§3.2)
2. **Crypto placement** — Worker (WebCrypto + ASN.1 builder) vs Container. Confirm Worker crypto limits empirically, not from memory. (§3.2)
3. **Incremental-update writer** — new `pdf-core` primitive vs signing-specific writer; how it self-verifies the prefix-preservation + `/ByteRange` exactness. (§3.1)
4. **Platform certificate** — how the firm/platform signing cert + key are provisioned, stored (Worker secret vs external KMS seam, ADR-0026/0046), and rotated; one platform cert vs per-firm.
5. **ESIGN/UETA specifics** — consent-disclosure wording, retention, per-jurisdiction divergence beyond Nevada (NRS Ch. 719).
6. **Certificate of Completion** — exact contents/format and the tamper-evidence/hash-chain scheme to a defensible standard.
7. **Attribution binding** — the spectrum ↔ _Client portal_ per-share-assurance mapping; what's in-slice vs deferred to the portal slice.
8. **Client-side vs server boundary** — which operations run client-side (field placement, signing UI, adoption) vs server (seal, audit); how the four server-only cases (§18.5) are triggered and audited.
9. **Port-adapter scope** — the PKI/notarial long-tail port shape (named seam, not built).
10. **White-paper/ADR correction** — §18.5/§18.6 engine roster + ADR-0045 must be updated to the pure-Rust reality in the same cycle (raise the ADR that moves ADR-0045 from Proposed → the built design).

---

## 6. Recommended decomposition & sequencing

The engine handoff sets owner order: **PAdES, then OCR** (OCR has since landed). Recommended sub-slice arc for 2·5's e-signature core:

**Tier 0 — cheap prep, do first (from the engine handoff, before the feature grows the code):**

- **(a)** Run the surgery corpus and settle "bar B" (`pdf-eval validate`) — closes the loop on shipped surgery, and either simplifies the engine or surfaces a defect **before** signing touches the same files. Needs `corpus-fetch` + network.
- **(b)** Split `crates/pdf-core/src/surgery.rs` (~2600 lines) on its own branch — signing will touch the same byte-splice machinery; cheapest to refactor while fresh.

**Sub-slice 1 — the seal primitive (engine).** The incremental-update writer (§3.1) + the signature dictionary / AcroForm `/Sig` field / `/ByteRange` / reserved `/Contents` layout, with a `pdf-eval` `sign` + `verify` operation and the prefix-preservation self-check. **Feasibility spike first**: prove a real PDF signs, `/ByteRange` is exact, and a standard verifier (or our verifier) validates it. No crypto backend commitment yet — sign with a throwaway key.

**Sub-slice 2 — CMS + crypto placement.** The detached-CMS builder + host signer (Worker WebCrypto or Container per §3.2), the platform-cert provisioning/storage seam, PAdES-B-B end-to-end. Algorithm/level as a versioned field (ADR-0046).

**Sub-slice 3 — the product layer (`@magna-carta/signing`).** ESIGN/UETA workflow, envelope/session model, audit trail, Certificate of Completion, verification, attribution spectrum (portal binding partly deferred). Schema + firm-scoped data-access + worker routes + OpenAPI + load-profile + the completion→Tasks/Comms seams.

**Deferred / named seams (do not build without a driver):** B-T/LTV timestamps, the PKI/notarial port adapter, the client-side signing/field-placement **UI** (0·7 + portal gate), the encrypted-ObjStm bounded loader (engine handoff Tier 3 — slot in before any firm ingesting encrypted PDFs onboards).

---

## 7. Risks

- **Incremental-update correctness** — a mis-laid `/ByteRange` or a non-prefix-preserving append silently produces an invalid or forgeable seal. Mitigate with the spike-first + `pdf-eval` verify op + a prefix-preservation self-check that refuses to emit on doubt (the redaction-gate discipline).
- **CMS/PAdES conformance** — signed-attribute correctness (ESS signing-cert-v2, message digest) is fiddly and verifier-sensitive. Mitigate by validating against an independent verifier (e.g. a reference PAdES validator) in the harness, not by eye.
- **Legal defensibility** — the firm owns the burden the first time a signature is challenged (§18.6 honest limit). This is why signing is **Fable-built AND reviewed** with extra rigor (model-split policy).
- **Engine build gotchas** — native `pdf-core` test builds OOM without `CARGO_BUILD_JOBS=1 RUSTFLAGS="-C debuginfo=0 -C codegen-units=1"`; do not `cargo fmt` the crate; Rust workspace root is `crates/Cargo.toml` (engine handoff).
- **Provisional white-paper claims** — every license/legal/crypto specific in §18.5/§18.6 is flagged provisional; verify each at build (golden rule 11).

---

## 8. Recommended next action

1. **Bootstrap + Tier-0 prep** — `vp run bootstrap`, then fetch the corpus and run the surgery `validate` (settle bar B), and land the `surgery.rs` split. Small, and they de-risk the file signing will touch.
2. **Open the design cycle for sub-slice 1** (the seal primitive) with a feasibility spike on the incremental-update writer + `/ByteRange` — the go/no-go gate for the rest of 2·5. Output: a spike note, then the sub-slice-1 spec raising the ADR that moves ADR-0045 to its built form and corrects §18.5/§18.6.
3. Keep the crypto backend decision (§3.2) **out** of sub-slice 1 — decide it in sub-slice 2 on evidence, so the engine primitive is provable without a crypto commitment.

Design and brainstorming stay collaborative (golden rules) — this brief is the map into that conversation, not a substitute for it.
