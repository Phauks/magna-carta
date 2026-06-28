# File corruption recovery — techniques, pure-Rust crate landscape, and coverage map

**Date:** 2026-06-27 · **Status:** Tentative analysis (owner-collaborative; pre-design) · **Owner:** Trevor Goldsmith

This is the research backing for a prospective **file repair / salvage** capability — recovering content from
structurally corrupted, truncated, or damaged files (broken archives, malformed PDFs, truncated images,
mangled email attachments) that the existing file-tool family can _diagnose_ but cannot _rescue_. The
_analysis and evidence_ live here; the _design and scope_ are settled in a separate brainstorm/spec (one home
per fact).

> **Tentative.** Crate facts below were checked against docs.rs / lib.rs / crates.io / GitHub on 2026-06-27.
> File repair is irregular and format-specific; the designs that build on this are expected to iterate, and
> any crate pin must be re-verified against docs.rs before use (golden rule 11).

## Relationship to what already exists

The platform already has a substantial "look at a file" family, but every member is **read-only inspection**
or **transformation of a healthy file** — none rescues a structurally broken one:

- **File Hash & Integrity** (built) — tells you a file _changed_, not how to fix it. Established the `file`
  context tag and the audit-receipt pattern that a repair tool should inherit.
- **File Type Verifier** (designed, Magika ML, co-located in scan) — flags an extension mismatch; needs a
  readable file. Its signature/ML substrate is the reusable base for carving (below).
- **Metadata Inspector & Scrubber** (built) — needs a _parseable_ file.
- **Scan engine** (merged, `containers/scan`) — malware verdict; rejects, never rescues. Already vendors the
  exact structural parsers a repair tool needs: `lopdf` 0.41, `cfb` 0.14, `zip` 8.6, `flate2`, RustCrypto
  hashes, `aho-corasick`. Detection-only by charter (no CDR).
- **File Decryption & Recovery Tool** (designed; `crates/decryption-core` built on branch) — **"Recovery"
  here means _password_ recovery** (hashcat-style), not corruption recovery. This is a naming collision to
  resolve: the password axis and the contents axis are different capabilities. Decision: rename to
  **File Unlock & Password Recovery**; the new contents-repair tool is **File Repair & Salvage**.
- **PDF engine** (merged) — pure-Rust, already does object **surgery** (xref/object-level rewrite): the one
  repair primitive that exists today.

The gap is real and legal-specific: opposing counsel sends a PDF that won't open; a discovery production has
truncated files; a client's scanned exhibit has a broken ZIP central directory; an email attachment arrives
mangled.

## The capability decomposes into four pillars

Deep repair is format-specific, but it rests on a broad **general-purpose base** — most of it permissive
pure-Rust we already vendor or can drop in. The format-specific list is the _deep-repair ceiling_, not the
coverage ceiling.

### Pillar 1 — Compression-stream salvage (highest leverage)

DEFLATE underlies ZIP, PDF `FlateDecode` streams, PNG IDAT, and _all_ OOXML. One technique — "decode up to
the point of corruption, keep the prefix" — recovers partial content across dozens of formats.

- **`zune-inflate`** is purpose-built: returns the decoded prefix _together with_ the error. `miniz_oxide`
  (already our `flate2` backend) also exposes partial output via `DecompressError.output`.
- Companions, all pure-Rust: **`ruzstd`** (zstd — _not_ the C-backed `zstd` crate), **`lzma-rs`** (XZ/LZMA),
  **`bzip2` 0.6** (C→Rust as of 2025).
- **Verdict: REUSE** + a thin "decode-as-far-as-possible" wrapper.

### Pillar 2 — Archetype-family container salvage (the coverage multiplier)

- **ZIP family** — one signature-scan engine (find `PK\x03\x04` local headers → re-derive entries →
  re-emit a fresh central directory + EOCD) covers **OOXML (docx/xlsx/pptx), ODF, EPUB, JAR, APK, XPS,
  KMZ**. Best _read_ foundation for damaged input is **`rc-zip`** (sans-io, Apache/MIT, _already_ reads
  entries from local headers ignoring the central directory) — the `zip` crate we vendor hard-requires the
  central directory, so keep `zip` 8.6 for _writing_ the repaired output. Caveats: EPUB/ODF require the
  `mimetype` entry re-emitted **first and STORED**; APK/JAR signature blocks are invalidated by a rebuild
  (chain-of-custody framing); data-descriptor/streamed entries (bit-3 flag) need decompress-to-boundary.
- **CFB / OLE2 family** — `cfb` 0.14 (vendored) reads well-formed files but errors on a damaged
  FAT/directory; FAT/directory reconstruction is ours to build. Covers **legacy .doc/.xls/.ppt, Outlook
  .msg, MSI**.
- **OOXML-specific** — generic ZIP salvage recovers the parts; Office still refuses to open unless the
  **Open Packaging Conventions** skeleton is intact (`[Content_Types].xml`, the `_rels` graph, well-formed
  primary part XML). No crate does this; it is bespoke logic over `quick-xml`. Partial recovery is genuinely
  useful (salvage body text even if media/styles are lost).
- **Verdict: REUSE parsers, BUILD the salvage orchestration.**

### Pillar 3 — File carving (universal fallback)

Extract embedded known-type files from any blob, ignoring host structure. No off-the-shelf permissive Rust
_carver_ exists, but the **~70% substrate does**: signature ID via **`infer`** / **`file-format`**
(MIT/Apache), ML fallback via **Magika** (Apache-2.0, pure-Rust — _already on the File Type Verifier
roadmap, so it is shared substrate_), `aho-corasick` for the multi-pattern scan, in-house decoders to
validate candidates. The **author-it ~30%** is a curated header/footer signature table + the
scan/bound/validate loop.

- **Licensing:** reference carvers are GPL (**PhotoRec, Scalpel** — study-only) or public domain
  (**foremost** — friendliest to study). We reimplement the technique and ship none of their code;
  signatures are facts, freely reusable. **Avoid `tree_magic*`** — its code is MIT but its bundled magic
  database is GPL.
- **Limits:** fragmentation is the central enemy; carving cannot recover filenames/paths/timestamps (those
  live in the destroyed metadata); it relocates intact byte runs, it does not regenerate lost bytes.

### Pillar 4 — Format-specific deep repair (the genuinely bespoke part)

- **PDF xref/trailer rebuild** — the single biggest custom build. Scan for `N M obj`, reconstruct
  xref + trailer, walk the page tree, drop/replace dangling refs with null. **Critical finding:** `lopdf`
  _silently skips_ unparseable objects — an **evidentiary hazard** for legal files; any repair path must
  report exactly which objects were lost, never silently emit a "clean" file. `pdf_oxide` ships a real
  `xref_reconstruction` module (read-only) — a useful reference, not a shippable re-emitter. Build on
  `lopdf`'s object parser (reuse tokenizer/`Object`, bypass its xref loader), or extend the existing PDF
  engine's surgery.
- **Image partial decode** — mostly REUSE: **`zune-jpeg`/`zune-png`** decode truncated images best-effort
  (leave `strict` off). Build only JPEG restart-marker (RSTn) resync and PNG IDAT/CRC chunk salvage for rows
  past the first break. Avoid `jpeg-decoder` (maintenance mode, errors on truncation).
- **Text / XML / JSON** — REUSE `chardetng` + `encoding_rs` (encoding salvage) and `jsonrepair`; light build
  for lenient XML well-formedness recovery over `quick-xml` (no off-the-shelf Rust XML repairer exists).

## Crate landscape — reuse vs. build

| Already vendored (org) | New permissive crates to add | Build ourselves |
| --- | --- | --- |
| `lopdf`, `cfb`, `zip`, `flate2`/`miniz_oxide`, RustCrypto hashes, `aho-corasick` (scan); `office-crypto`, RustCrypto (decryption-core); `sevenz-rust2` (bundling); pure-Rust PDF engine + object surgery; Magika (planned) | `zune-inflate`, `rc-zip`, `ruzstd`, `lzma-rs`, `bzip2` 0.6, `infer`/`file-format`, `zune-jpeg`/`zune-png`, `chardetng` + `encoding_rs`, `jsonrepair`, (`rust-par2` for protect-ahead) | ZIP signature-scan re-index · OPC/OOXML part + rels reconstruction · CFB FAT rebuild · **PDF xref rebuild (biggest)** · carving signature DB + scan loop · JPEG/PNG deep salvage · lenient XML |

All listed crates are permissive (MIT / Apache-2.0 / Zlib), pure-Rust (WASM-friendly, no C toolchain), no
external service. The confidentiality-by-default, no-upload, no-GPL posture is fully achievable. Notable
avoids: the C-backed `zstd` crate (use `ruzstd`), `jpeg-decoder` for general use, `tree_magic*`'s GPL DB, and
relying on `lopdf`/`hayro`/`pdf-rs` for damaged-xref recovery (none rebuild xref).

## The honest boundary — what recovery cannot promise

Recovery = **(a) salvage what survives** + **(b) repair via redundancy laid down beforehand.** Mid-stream
bit-rot (a flipped/lost byte inside a compressed stream) is **unrecoverable from the file alone** — the
information is not present, and everything downstream of the damage in a compressed stream is lost. No tool
beats that without _pre-existing_ parity. This delimits the product claim honestly and points to a separate,
optional **"protect-ahead"** feature: lay down **PAR2** parity at ingest (`rust-par2` verifies + repairs in
pure Rust; creation we would build) so future damage _is_ repairable. A distinct slice, not part of a v1
recovery tool. The other hard wall is opaque proprietary single-stream formats — carving can extract embedded
media, but semantics cannot be reconstructed.

## Coverage verdict

Not limited to ZIP/OOXML/PDF. Those three plus a CFB family, a carving pass, and the compression-salvage
primitive give broad coverage of essentially everything that lands in a legal practice — modern Office,
legacy Office, Outlook email, PDF, images, text, plus EPUB/ODF for free — and the general-purpose layer
degrades gracefully on _unknown_ formats by rescuing whatever intact content is inside.

## Architecture fit

Same **raw-facts-in-container → verdict-in-app** pattern as scan / type-verifier; pure-Rust → WASM (browser)
+ native (container); shares the Magika substrate with the File Type Verifier; reuses the PDF engine's
surgery and decryption-core's vendored parsers; no GPL ships, no upload. Co-locates with the existing
file-tool family and honors the Tools "ethereal principle" (core-first, pullable into a matter) and the
evidentiary-receipt model the Hash tool established. The pure-Rust core + WASM(worker)/native(container)
hosting is provided by the shared `engine-host` harness (see
`docs/specs/2026-06-28-engine-host-framework-design.md`).

## Open items to settle in the File Repair & Salvage design (SP2)

1. **Diagnosis vs. repair layering** — read-only "what's wrong / is repair possible" as a first, low-risk
   layer; mutating repair as a second. (Decided: one tool, diagnose-then-repair internal flow.)
2. **Runtime placement** — Worker(WASM) default lane + Container(native) heavy lane, routed by size/CPU.
   (Decided; see engine-host design.)
3. **Format/slice sequencing** — ZIP-family + OOXML/OPC first (highest discovery-file value), CFB second,
   PDF xref third, carving as the cross-cutting fallback.
4. **Evidentiary model** — never overwrite; emit a new derived artifact + a receipt of exactly what was
   recovered and what was lost; never overclaim. (Open: where the artifact lands; matter-attachment seam.)
5. **Protect-ahead (PAR2)** — whether/when to lay down parity at ingest.

## Sources

Archive/container: [rc-zip](https://github.com/bearcove/rc-zip) · [zip](https://docs.rs/zip) ·
[cfb](https://github.com/mdsteele/rust-cfb) · [tar](https://crates.io/crates/tar) ·
[sevenz-rust2](https://github.com/hasenbanck/sevenz-rust2) ·
[OOXML repair](https://www.brandwares.com/bestpractices/2016/02/xml-hacking-document-repair/) ·
[EPUB OCF mimetype rule](https://www.w3.org/publishing/epub32/epub-ocf.html).
PDF/stream/image: [lopdf](https://github.com/J-F-Liu/lopdf) ·
[pdf_oxide xref_reconstruction](https://docs.rs/pdf_oxide/latest/pdf_oxide/xref_reconstruction/index.html) ·
[zune-inflate](https://docs.rs/zune-inflate) · [miniz_oxide](https://docs.rs/miniz_oxide) ·
[ruzstd](https://lib.rs/crates/ruzstd) · [lzma-rs](https://lib.rs/crates/lzma-rs) ·
[bzip2 C→Rust](https://trifectatech.org/blog/bzip2-crate-switches-from-c-to-rust/) ·
[zune-image](https://github.com/etemesi254/zune-image) · [png](https://docs.rs/png) ·
[encoding_rs](https://crates.io/crates/encoding_rs) · [jsonrepair](https://crates.io/crates/jsonrepair).
Carving/reference: [PhotoRec (GPL)](https://www.cgsecurity.org/wiki/photoRec) ·
[Scalpel (GPL)](https://github.com/sleuthkit/scalpel) ·
[foremost (public domain)](https://foremost.sourceforge.net/) ·
[bulk_extractor](https://github.com/simsong/bulk_extractor) · [infer](https://github.com/bojand/infer) ·
[file-format](https://docs.rs/file-format) · [Magika (Apache-2.0)](https://github.com/google/magika) ·
[rust-par2](https://github.com/AusAgentSmith-org/rust-par2).
