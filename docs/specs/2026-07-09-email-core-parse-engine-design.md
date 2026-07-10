# Email parse core (`email-core`) — design

**Status:** Draft — pending owner acceptance · **Date:** 2026-07-09 · **Owner:** Trevor Goldsmith
**White-paper home:** _Communications layer_ (email) — this builds the parsing foundation the inbound-capture subsystem, in-app conversion, metadata inspection, and Discovery all stand on.
**Standard:** [`docs/conventions/engine-host-seam.md`](../conventions/engine-host-seam.md) — this is the third engine built to that seam, after `pdf-core` and `decryption-core`.
**ADR fragment:** [`docs/decisions/pending/email-core-parse-engine.md`](../decisions/pending/email-core-parse-engine.md) (number assigned at merge).

---

## 0. Why this exists

Email reaches the product in three roles. Two are settled; the third has no foundation.

1. **Platform → user system mail.** Built — the `sendEmail` port over Cloudflare Email Service.
2. **The company's own mailboxes.** Decided — Google Workspace, decoupled from product email.
3. **Firm email as matter data.** Designed in [`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md), unbuilt.

Underneath the third sits a gap nobody has filled: **nothing in this codebase can read an email.** The upload policy already accepts `message/rfc822` and `application/vnd.ms-outlook`; the conversion registry already declares `eml→pdf` and `msg→pdf` edges. Both are promises against an engine that does not exist. There is no MIME parser dependency anywhere in the workspace.

So a firm can upload a `.eml` today and the system stores an inert blob — no preview, no headers, no attachment extraction, no conversion.

This design builds that engine, and one visible consumer to prove it end to end.

## 1. Scope

**In scope.** A pure-Rust parse core reading `.eml` (RFC 5322 / MIME), `.msg` (CFB / MAPI), and mbox; its WASM edge and TypeScript wrapper; and an **Email Inspector** surface in the Tools area.

**Out of scope, deliberately.** Rendering (`email→pdf`), DKIM signature verification, storage, matter linkage, and classification. Each is a consumer standing on this core, not part of it. The conversion registry's `email` engine edges **remain unimplemented** after this slice — closing them is a render slice, and no reader of this document should expect PDFs from it.

## 2. Architecture

`crates/email-core` — I/O-free, threadless, `mmap`-free, serde-free. Bytes in, record out. It never reaches the network, never touches R2, never knows what a matter is. The `r2` cargo feature stays off, so no `reqwest` / `rustls` / `ring`, and therefore no C in the dependency closure: the crate is wasm-clean by construction and conforms to golden rule 14 without a consent exception.

**Two lanes, one crate**, per the engine-host seam:

- The **WASM edge** (`wasm.rs`, marshalling only — no engine logic) is the default lane. A Worker streams a message from R2 and parses it inline.
- The **native lane** is entered only when input size or CPU exceeds the Worker budget — a large mbox, or an attachment set too big to hold in an isolate.

**The native lane is deferred, not built here.** A container is not a subdirectory: it is a separate deployable Worker, a Durable Object class, a `new_sqlite_classes` migration tag, a service binding, and a Dockerfile with a repo-root build context. Nothing in this work consumes it — the Inspector reads one message at a time, and bulk mbox iteration belongs to Discovery. Because the crate is pure and I/O-free, the lane stays one compile target away. **Flip condition:** Discovery's bulk mbox parsing, or an attachment set that exceeds the isolate budget in practice.

Placement is therefore a routing decision, not a rewrite. This satisfies golden rule 10 (no heavy work in a request handler) and ADR-0039 (compute placement).

**Dispatch.** `engine_host::format::detect` already returns `Ole2` at the magic-byte level, which is the `.msg` container signature; the seam's convention text anticipates exactly this case. `email-core` composes on top of `detect` rather than re-reading magic bytes:

| Detection                          | Lane              |
| ---------------------------------- | ----------------- |
| `Ole2`                             | MAPI (`.msg`)     |
| mbox `From_` separator at offset 0 | mbox stream       |
| otherwise                          | RFC 5322 (`.eml`) |

**Dependencies**, all pure Rust:

| Crate         | Role                               | Note                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail-parser` | RFC 5322 + MIME 2045–2049          | 100% safe Rust, no external dependencies; zero-copy `Cow<str>`; 41 character sets; returns the RFC 8621 flattened body/attachment shape                                                                                                              |
| `cfb`         | OLE2 compound container for `.msg` | The `.msg` MAPI property-stream decoding ([MS-OXMSG] / [MS-OXPROPS]) is written on top of `cfb` by us, not delegated to a crate. Pinned per-crate at 0.14 (matching `recovery-core`); _not_ a workspace pin — `decryption-core` separately pins 0.10 |

mbox needs no crate: it is a `From_`-delimited concatenation of RFC 5322 messages, so it is a framing iterator over the `.eml` lane, not a parser.

### 2a. What this displaces

The capture design assumes **PostalMime** (TypeScript) parses the forward/CC path inside the Cloudflare Email Worker. Under this design that Email Worker calls `email-core` through its WASM edge instead.

This is a conscious override, taken now because it is cheap now. One parser and one output record serve capture, file upload, conversion, metadata, and Discovery alike; a TypeScript parser on the Worker path plus a Rust parser for bulk and desktop would give us two implementations and two records — the "one pipeline, one record" thesis broken at its foundation. The capture spec is still Draft, so the amendment costs a paragraph.

## 3. The record

One `ParsedMessage`, produced identically by all three lanes.

- **Envelope** — `message_id`, `in_reply_to`, `references[]`, `subject`, the date as both a parsed instant and the raw header string, and the address sets (`from`, `sender`, `reply_to`, `to`, `cc`, `bcc`) as `{display_name, address}` pairs.
- **Raw headers** — the full, ordered header list, verbatim. This is the evidentiary artifact, and it is the signing input an external DKIM verifier requires.
- **Bodies** — text parts and HTML parts, using `mail-parser`'s RFC 8621 flattening rather than a raw nested MIME tree.
- **Part descriptors** — `{filename, media_type, content_id, disposition, size, byte_range, is_embedded_message}`.
- **Integrity facts** — `DKIM-Signature`, `Authentication-Results`, and the `Received` chain, captured verbatim **with no verdict attached**. This follows the scan engine's rule: raw facts in the engine, the verdict in the app.
- **Provenance** — `source_format` (`eml` / `msg` / `mbox_member`) and the engine version.

### 3a. Two-phase extraction

`parse` returns the envelope and part **descriptors carrying byte ranges**. It does not return attachment bytes. `extract_part(index)` materializes one part on demand.

This is load-bearing, not an optimization. Without it a Worker parsing an mbox with a 400 MB attachment set must hold all of it in an isolate, and Discovery's bulk indexing — which wants headers and text and never the payloads — pays for bytes it immediately discards. The core stays zero-copy internally on `mail-parser`'s borrows; only the WASM edge and the container host materialize owned data.

### 3b. `message_id` provenance is typed, not flattened

A `.msg` file does **not** reliably carry RFC 5322 headers. They survive only when `PidTagTransportMessageHeaders` was preserved, and Outlook frequently drops it.

The capture design makes `Message-ID` the dedup identity and treats a content-hash fallback as the exception. For `.msg`-sourced files that fallback is closer to the **common case**, and any `Message-ID` synthesized from MAPI properties is not the same bytes another recipient's `.eml` copy carries.

So `message_id` is not a string. It records its origin — `from_header`, `from_mapi`, or `absent` — and consumers branch on that. Flattening it would let cross-source dedup silently emit duplicates, which is precisely the incumbent failure mode the capture design sets out to avoid.

### 3c. RTF-only bodies — an accepted gap

Many `.msg` files carry an RTF body and no plain-text alternative. Parse-only means the core decompresses and exposes the RTF part but does not convert it. Until the render engine exists, such a message yields no text body. This is accepted and belongs to the renderer, not here.

## 4. Untrusted-input safety

This engine eats attacker-controlled bytes, so it is built like the ones that already do.

A `limits.rs`, following the `pdf-core` `guard.rs` and `recovery-core` `limits.rs` precedent, caps: MIME nesting depth, part count, decoded size (base64 expands roughly 1.37×, so a declared length never sizes an allocation), embedded-`.msg` recursion depth, mbox member count, and mbox member size.

Every violation is a typed `Err` — never a panic, never a truncated success. Error codes are the seam's fixed `&'static str` set and carry no file content (golden rule 4), proven by the `wasm_edge::allowed_code` test. The container host catches panics and returns 500 rather than crashing or reporting a silently-wrong success.

Parse-only gives us one safety property for free: nothing is executed and no remote content is fetched. The record exposes whether a body references remote content as a **fact**, for the future renderer and preview surfaces to act on.

## 5. Email Inspector — the visible consumer

A Tools-area surface, following the tools-area ethereal principle (matter-grade work without committing to a matter) and mirroring the existing Metadata Inspector. It needs no matter, no Directory, and no capture subsystem.

Drop in a `.eml` or `.msg`; get back headers, participants, dates, the attachment list, and the integrity facts as raw structured data. Attachments are listed, not extracted onto a matter — extraction into the File Manager belongs to the capture subsystem, which owns the ingest chokepoint.

Shape follows the `decryption` precedent (the WASM engine, not the container one): the Rust crate, a `wasm-pack` build into a thin TypeScript package, and a worker route beside its siblings in `apps/worker/src/routes/`. The permission is seeded onto the default roles — otherwise it exists but nobody holds it and the tool is invisible in-product.

## 6. Verification

- **Per-lane unit tests** over a committed fixture corpus: real-world-shaped `.eml`; `.msg` both with and without `PidTagTransportMessageHeaders`; RTF-only bodies; embedded `.msg`; mbox with `From_`-in-body escaping.
- **`cargo-fuzz` targets** on all three lanes.
- **A `limits.rs` test per cap**, asserting a typed error rather than a panic or a partial result.
- **The `wasm_edge::allowed_code` test**, proving no file content escapes through an error string.
- **The container image must build _and_ boot in CI** — building alone has previously passed while the image failed to start.
- **The `.msg` dependency was chosen by audit, not by convenience.** `msg_parser` — the obvious crate — was audited and **rejected**: a release-profile out-of-bounds panic reachable from its entry point on crafted input (a sector-index loop bounded by the input length, not the array length), which on the unwind-less WASM runtime aborts the whole isolate; no fuzz target; a three-year dormancy followed by an eleven-release two-day burst; and `regex`/`serde` bundle weight. The `.msg` lane is built instead on `cfb` (panic-free on malformed input across a fuzz sweep, already a production dependency), with the MAPI decoding written and bounded by us — every input-derived index checked, no panic on malformed input, embedded-message recursion capped, and its own fuzz targets.

## 7. Documentation and decision deltas

Shipped in the same commits as the code (golden rules 5 and 8):

- **ADR fragment** — `docs/decisions/pending/email-core-parse-engine.md`. Records the pure-Rust parse core on the engine-host seam, the parse-only boundary with render and DKIM crypto outside it, and the PostalMime override. Numbered at merge under the fragment convention.
- **Amend [`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md)** — its §2 PostalMime line, and its reservation of ADR-0104/0105/0106, all three of which were subsequently assigned to unrelated decisions (fragment convention, worktree coordination, product-usage analytics).
- `changelog.d/` and `status.d/` fragments; `crates/email-core/CLAUDE.md` for local engine rules; `docs/active-work/email-core-parse-engine.md`.
- **ROADMAP** — place the parse core ahead of both the capture subsystem and Discovery, since both consume its record.

## 8. What this unblocks

| Consumer             | Gains                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File Manager         | `.eml`/`.msg` stop being inert blobs — headers, participants, attachments become inspectable                                                                      |
| Conversion           | `ParsedMessage` becomes the render engine's input; the registry edges stay unimplemented until that slice                                                         |
| Email capture        | The Email Worker and add-in both parse through one core; `ParsedMessage` is the raw material for the `email_message` / `email_thread` / `email_attachment` tables |
| Metadata & forensics | An email surface for the Inspector; verbatim headers and bodies make the capture design's tamper-diff tractable                                                   |
| Discovery            | Bulk mbox iteration with headers-and-text-only extraction — what the two-phase API buys                                                                           |
