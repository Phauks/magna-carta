# Rust PDF engine — whole-engine roadmap — design

**Status:** Draft (roadmap / decomposition) · **Date:** 2026-06-21 · **Owner:** Trevor Goldsmith
**White-paper home:** _PDF services_ (§18.5), _E-signature_ (§18.6)
**Research input:** in-cycle pure-Rust PDF ecosystem survey (this design cycle) — `hayro`, `krilla`, `pdf-writer`, `lopdf`, `pdf-rs`, `oxidize-pdf`, `pdf_oxide` (versions/licenses to re-verify at each slice build, golden rule 11)
**Relates to / revisits:** ADR-0088 (EmbedPDF/PDFium fork-as-given) · ADR-0030 (Stirling-PDF bundling rejected) · ADR-0045 (PAdES platform seal) · the in-flight EmbedPDF work (sanitize-completeness, OCG-removal, signing-options) · slice 2·3 (inline preview)
**ADRs to raise (at slice 1):** `pdf-engine-pure-rust-core` (adopt a composed pure-Rust core as the strategic successor to the PDFium fork) · `hayro-dependency-doctrine` (depend + upstream + fork-as-given)

This is a **decomposition spec**, not an implementation-grade design. It maps the whole-engine arc and pins the scope, sequencing, and dependency doctrine. Each slice it names gets its own spec → plan → build cycle; **slice 1 is specced next.**

---

## 1. Goal and drivers

Replace the forked-PDFium PDF stack (white paper _PDF services_; ADR-0088) with a **pure-Rust, permissively-licensed PDF engine** that reaches Adobe Acrobat-grade capability across the surface Magna Carta actually needs. Four drivers, all weighted (owner, this cycle):

1. **Escape the C++/PDFium fork.** Maintaining a fork of PDFium (a security-sensitive Chromium subtree) in C++ is the pain the signing analysis already surfaced. A Rust codebase the team can read, patch, and rebase cheaply removes it.
2. **Reach features PDFium can't.** Chiefly **true content-level redaction** — deferred in the white paper because the engines that do it well (MuPDF, Ghostscript) are AGPL — plus text/object editing, compare, preflight.
3. **Performance and control.** No opaque third-party engine on the hot path; tuned against the load-profile harness (golden rule 10).
4. **Licensing freedom.** No AGPL wall anywhere on the surface, so every feature is buildable in a commercial multi-tenant SaaS.

**Ownership is not itself a requirement.** The owner's clarification this cycle: the engine need not be built in-house if a permissively-licensed option covers the features and stays off PDFium. So the operating rule is **compose existing permissive pure-Rust crates wherever they suffice; build only the gaps.** What we own is the integration and the missing Acrobat layer — nothing more.

---

## 2. The reframe — a third path

The decision is **not** "from-scratch engine (multi-year) vs. keep the PDFium fork (status quo)." A pure-Rust **compose-and-fill-gaps** path became viable in late 2025 / early 2026, when pure-Rust _rendering_ — historically the missing piece — reached real fidelity. This path also **is** the "shared doc/discovery core → WASM for web + native for desktop" the stack already calls for (white paper _Delivery model_, _Stack at a glance_): client-side-by-default, identical bytes on web and Tauri, server/Container fallback only for batch/ingest scale.

| Approach                                                          | What it is                                                                                                                                                                            | Verdict                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A — Compose permissive pure-Rust crates + build only the gaps** | A `@magna-carta` Rust PDF core over `hayro` (render) + `krilla`/`pdf-writer` (write) + `lopdf`/`pdf-rs` (model); redaction/forms/sign built by us in Rust. Compiles to WASM + native. | **Chosen.** Only path that satisfies all four drivers at once.                                        |
| B — From scratch, no dependencies                                 | Write parser + renderer + writer ourselves.                                                                                                                                           | Rejected — multi-year; re-solves what `hayro`/`krilla` already solved.                                |
| C — Keep the forked PDFium, sharpen it                            | Stay on the EmbedPDF strategy (ADR-0088).                                                                                                                                             | Rejected as the destination — keeps every driver above unaddressed. Retained transitionally (see §8). |

This **revisits ADR-0088**: the fork-as-given doctrine was sound for its moment, but its premises (no pure-Rust render fidelity; PDFium the only realistic base) no longer hold. ADR-0088 is superseded _as the strategic destination_ by the slice-1 ADR, not deleted — the PDFium fork remains the transitional incumbent until the Rust core proves out (§8).

---

## 3. Landscape — the permissive pure-Rust ecosystem (2026)

The key finding: **no single crate is an "Acrobat,"** but the _primitives_ now exist as MIT/Apache crates, several by one author (Laurenz Stampfl) and designed to compose.

- **Render (the historical blocker, now solved):** **`hayro`** — pure-Rust PDF interpreter + renderer (raster + SVG), tested against 1400+ PDFs scraped from the pdf.js and PDFBox regression suites; dual MIT/Apache; alpha but _very_ active (≈1.7k commits, 30 releases). Same author as `krilla`, and integrated into Typst. Peers: Zed's `Hydro` (shipped pure-Rust preview, Jan 2026), `fop-pdf-renderer`.
- **Write / generate (mature):** **`krilla`** (high-level; OpenType, gradients, blend modes; powers Typst's rewritten PDF export), **`pdf-writer`** (low-level), **`printpdf`**.
- **Parse / object model:** **`lopdf`**, **`pdf-rs` (`pdf`)** — read/manipulate/write the PDF object graph and content streams.
- **Extraction (adjacent):** `oxidize-pdf`, `pdf_oxide` — fast text/structure extraction; useful for discovery/search, not the core.
- **OCR (adjacent, separate engine):** `ocrs` (pure Rust) or a Tesseract sidecar.

All MIT/Apache. The render+write+model triad is a coherent, composable foundation.

---

## 4. Capability coverage map

Scoped to what Magna Carta needs (white paper _PDF services_, _Discovery_, _Document Automation_, _E-signature_), not all of Acrobat.

| Capability                                         | Permissive pure-Rust option                             | Status                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parse + object model                               | `lopdf`, `pdf-rs`                                       | ✅ Covered                                                                                                                                             |
| Render to raster/canvas (preview, flatten)         | `hayro`                                                 | ✅ Newly covered — fidelity/perf maturing                                                                                                              |
| Generate / write PDFs                              | `krilla`, `pdf-writer`, `printpdf`                      | ✅ Mature                                                                                                                                              |
| Merge / split / rotate / stamp / watermark / Bates | model + render/write layers                             | 🟡 Assembly on top of the above                                                                                                                        |
| Encrypt / secure (password, AES-256)               | `lopdf` (partial)                                       | 🟡 Build missing modes                                                                                                                                 |
| **True content redaction**                         | _none_                                                  | 🔴 **Gap — we build it.** The headline differentiator; now feasible because the model crates expose the content-stream layer the AGPL engines guarded. |
| Forms — AcroForm fill                              | partial in `lopdf`/`pdf-rs`                             | 🟡 Build the form layer                                                                                                                                |
| Forms — **XFA**                                    | _none_ (Adobe/PDFium-only)                              | ⛔ **Out of scope** (§5).                                                                                                                              |
| Text / object editing ("Edit PDF")                 | _none_                                                  | 🔴 Gap — hardest; deferred to far-future slice or scoped down                                                                                          |
| Sign / seal (PAdES)                                | `krilla`/`pdf-writer` write structure; crypto host-side | 🟡 Build structure + embed; crypto already host-side in current design                                                                                 |
| OCR (scanned → searchable)                         | `ocrs` / Tesseract sidecar                              | ✅ Separate engine, not the PDF core                                                                                                                   |
| Compare / preflight / accessibility tagging        | _none_                                                  | 🔴 Gaps — low priority, far future                                                                                                                     |

---

## 5. Scope decisions

- **XFA forms — out of scope.** XFA is a deprecated, ISO-32000-2-removed, PDF/A-banned second document format (XML template + dynamic reflow engine + FormCalc/JS scripting) embedded inside the PDF. No pure-Rust crate touches it; even PDFium supports it only in a special build that Chrome ships disabled. The real need — US court/government fillable forms — is overwhelmingly **AcroForm**, which we build. We will **detect XFA and fall back** (fill the AcroForm shadow of hybrid XFAF forms if present; otherwise render-and-flatten or route to the server/LibreOffice path with a clear "needs Adobe" notice) rather than implement the XFA engine. Revisited only if a target court ships dynamic-only XFA forms — with a concrete form in hand.
- **Text/object editing — deferred.** The hardest gap; not in the v1 arc. Scoped down or scheduled far-future after the core proves out.
- **Compare / preflight / accessibility tagging — far future**, behind the value-bearing slices.

---

## 6. Slice roadmap

Each is a vertical slice (schema → firm-scoped data-access → API → UI → tests → docs) with its own spec and load-profile measurement, per _How we work_.

1. **Core + render** _(the wedge — specced next)._ The `@magna-carta` Rust PDF core: `lopdf`/`pdf-rs` model + `hayro` render, compiled to WASM (web, client-side-by-default) and native (Tauri/Container). Stood up as a **measured parallel-evaluation track** against the in-flight EmbedPDF preview (slice 2·3) — apples-to-apples fidelity, speed, and WASM-bundle-size on a regression corpus of real firm PDFs. Carries the `hayro` dependency doctrine (§7) and the go/no-go gate for everything after it. **Begins with a feasibility spike** (§10) before committing the slice.
2. **True redaction — safe route.** The malpractice-critical differentiator (white paper _Discovery_). Rasterize-and-reassemble (flatten each affected page to an image, strip text/annotations) + the lopdf **verification gate** (does the redacted text still extract?). **Retires the white paper's AGPL-driven deferral** — the feasibility spike proved both redaction strategies are pure-Rust-feasible. Own spec: `2026-06-22-pdf-slice-2-redaction-design.md`.
3. **Text-position primitive + bad-redaction detector + surgery.** A thin `hayro-interpret` `Device::draw_glyph` shim yields per-glyph page-space positions (feasibility-proven), which powers two features on one foundation: (a) the **bad-redaction detector** _(owner-requested)_ — scan a PDF and flag _failed_ redactions (extractable text under an opaque fill/image/removable annotation, hidden OCG layers, metadata leaks) for vetting outbound productions, validated against a synthetic + real bad-redaction corpus and cross-checked against an LLM reading; (b) **content-stream surgery** — region-precise, text-preserving redaction (keeps the rest of the page selectable).
4. **Generate + stamp / Bates / watermark / merge / split.** Feeds _Document Automation_ and _Discovery_ production.
5. **Forms (AcroForm) + secure/encrypt.** Court/government form fill; password/permissions/AES-256.
6. **Sign / seal (PAdES).** Folds in the existing `@magna-carta/signing` design (host-side crypto unchanged; the Rust core owns the PDF structure end-to-end — the "one engine owns the bytes" thesis, now in Rust).
7. **OCR integration**, then the far-future gaps (text/object editing, compare, preflight, tagging).

---

## 7. The `hayro` dependency doctrine

Mirrors ADR-0088's "fork-as-given, never gate on merge," but **cheaper** here — the language is Rust and the license is MIT/Apache:

- **Depend on the published crate.** It's pure Rust, dual MIT/Apache, very active, and authored by the same person as `krilla` (Typst's writer) — credible and ecosystem-embedded, not a hobby project.
- **Contribute fixes upstream in good faith.** Young and active → PRs are plausibly accepted; we close the fidelity gaps we find.
- **Carry patches in our own fork if upstream is slow.** The permissive license makes this clean; we never gate a release on a merge.

**Honest risks to hold:** `hayro` is **alpha** ("still in a very development stage"); **performance is explicitly not yet optimized** ("has not been a focus at all so far") — a direct hit on driver 3, and the reason slice 1 is _measured_, not a blind switch; **bus-factor 1**; known render gaps (knockout groups, non-embedded CID fonts). These are why slice 1 leads with a spike and runs as a parallel track.

---

## 8. Relationship to the in-flight EmbedPDF / PDFium work

The EmbedPDF fork is **not retired on day one.** It stays the **transitional incumbent** — slice 2·3 preview and the sanitize/OCG/signing work continue to ship on it — while the Rust core is built and measured beside it. The switch is **evidence-gated:** the Rust core replaces EmbedPDF for a capability only once it meets or beats it on fidelity, speed, and bundle size on the regression corpus. This keeps risk bounded (driver-3 perf and `hayro` maturity are unproven) and gives every upstream contribution a concrete target. ADR-0088 is superseded _as the destination_, honored _as the bridge_.

---

## 9. Risks

- **`hayro` maturity / perf** (§7) — primary risk; mitigated by spike-first + parallel-track + measurement + upstream contribution.
- **Fidelity tail** — the long tail of malformed real-world PDFs PDFium handles from years of hardening. Mitigated by a large regression corpus and the EmbedPDF fallback staying live.
- **Gap-build underestimate** — redaction/forms/sign are bounded but non-trivial Rust. Mitigated by slicing and by the model crates exposing the right primitives.
- **Bus-factor on the upstream crates** — mitigated by fork-as-given and the permissive license.
- **WASM bundle size** — a pure-Rust core in the client bundle must be measured against the PDFium WASM it replaces (part of slice 1's gate).

---

## 10. Next steps

1. **Feasibility spike (pre-slice-1):** run a regression corpus of real firm PDFs through `hayro` (render fidelity vs PDFium, render speed, WASM size) and through `lopdf`/`pdf-rs` (parse coverage). Decide build-vs-stay on evidence. Output: a spike note with the go/no-go.
2. **Slice 1 spec:** if go, the implementation-grade design for the core + render parallel-evaluation track, raising the two ADRs (`pdf-engine-pure-rust-core`, `hayro-dependency-doctrine`).
3. Subsequent slices (2–6) each spec → plan → build in turn.

**Open items to confirm at build (golden rule 11):** re-verify every crate's license + version + maintenance at each slice; confirm the WASM toolchain and bundle-size budget; confirm the firm-PDF regression corpus source (discovery fixtures? load-profile fixtures?); confirm redaction's verification-gate standard against the _Discovery_ malpractice bar.
