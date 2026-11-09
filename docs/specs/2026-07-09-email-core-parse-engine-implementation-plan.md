# Email parse core (`email-core`) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `crates/email-core` — a pure-Rust, parse-only email engine reading `.eml`, `.msg`, and mbox — expose it to the Worker through a WASM edge, and ship an **Email Inspector** tool that proves it end to end.

**Architecture:** The crate is the third engine on the engine-host seam (after `pdf-core` and `decryption-core`): I/O-free, threadless, serde-free, bytes in and a `ParsedMessage` out. It compiles to `wasm32-unknown-unknown` via a pinned Docker toolchain and is consumed by `apps/worker` as a pre-compiled `WebAssembly.Module`. Extraction is two-phase — `parse` returns part descriptors with byte ranges; `extract_part` materializes one part on demand.

**Tech Stack:** Rust 2021 · `mail-parser` 0.11.5 · `msg_parser` 0.3.6 · `thiserror` 2 · `wasm-bindgen` · `wasm-pack` (in Docker) · TypeScript · Hono + `@hono/zod-openapi` · Vitest.

**Spec:** [`2026-07-09-email-core-parse-engine-design.md`](2026-07-09-email-core-parse-engine-design.md) · **ADR fragment:** [`do../decisions/0173-email-core-parse-engine.md`](../decisions/0173-email-core-parse-engine.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Pure Rust only.** No C-backed crate or crate feature on any path — a C dependency breaks the wasm target and needs golden-rule-14 consent. The `engine-host` `r2` feature stays **off** (it pulls `reqwest` → `rustls` → `ring`).
- **The engine crate is I/O-free and serde-free.** It never depends on `axum`, `serde`, `tokio`, or the network. All marshalling lives in `wasm.rs` (wasm32-only) or the TypeScript wrapper.
- **`wasm.rs` is marshalling only.** No engine logic. Error codes are fixed `&'static str` values from a declared set, never file content (golden rule 4). Prove it with `engine_host::wasm_edge::allowed_code`.
- **Parse-only.** No rendering, no DKIM signature verification, no storage, no matter linkage. The conversion registry's `eml→pdf` / `msg→pdf` edges remain unimplemented after this plan.
- **No `console.*`** anywhere in `apps/worker/src` or `packages/*/src` — `packages/telemetry/test/console-ban.test.ts` fails the build. Log through the telemetry `Logger`.
- **No process references** in source, tests, config, or OpenAPI `description` strings — no `ADR-NNNN`, no "spec", no "slice N", no "Task N" (golden rule 13; `pnpm run lint:process-refs`). A forward-looking schedule reference is the sole exception.
- **No emoji** anywhere.
- **Fully written-out names** (golden rule 12): `identifier` not `id`, `message_identifier` not `msg_id`. The `.msg` / `.eml` / mbox tokens are format names, not shorthand, and stay as-is.
- **`cfb` is not a workspace dependency.** `crates/Cargo.toml` `[workspace.dependencies]` carries only `hayro`, `image`, `lopdf`; `decryption-core` pins `cfb = "0.10"` while `recovery-core` pins `0.14`. `email-core` does **not** depend on `cfb` directly — `msg_parser` owns the CFB layer. Do not "unify" these pins as a drive-by.
- **The container is deferred.** No `containers/email`, no `apps/email-worker`, no Durable Object, no service binding. The crate stays pure so the native lane remains a compile target away.

## File Structure

**New:**

| Path                                                                            | Responsibility                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `crates/email-core/Cargo.toml`                                                  | Crate manifest; `crate-type = ["cdylib", "rlib"]`                                        |
| `crates/email-core/src/lib.rs`                                                  | Public API: `parse`, `extract_part`, re-exports                                          |
| `crates/email-core/src/model.rs`                                                | `ParsedMessage`, `PartDescriptor`, `MessageIdentifier`, `Address`                        |
| `crates/email-core/src/error.rs`                                                | `EmailError` + its fixed `&'static str` code set                                         |
| `crates/email-core/src/limits.rs`                                               | Untrusted-input caps                                                                     |
| `crates/email-core/src/eml.rs`                                                  | RFC 5322 / MIME lane                                                                     |
| `crates/email-core/src/mbox.rs`                                                 | mbox framing iterator                                                                    |
| `crates/email-core/src/msg.rs`                                                  | CFB / MAPI lane                                                                          |
| `crates/email-core/src/wasm.rs`                                                 | wasm32-only JS marshalling edge                                                          |
| `crates/email-core/wasm.Dockerfile`                                             | Pinned wasm-pack build image                                                             |
| `crates/email-core/CLAUDE.md`                                                   | Local engine rules                                                                       |
| `crates/email-core/fuzz/`                                                       | `cargo-fuzz` targets, one per lane                                                       |
| `crates/email-core/tests/fixtures/`                                             | Committed corpus                                                                         |
| `packages/email/`                                                               | TypeScript wrapper (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`) |
| `apps/worker/src/routes/email/email-inspector.ts`                               | The Inspector route                                                                      |
| `apps/worker/test/seed-tools-email-inspector.test.ts`                           | Seed guard                                                                               |
| `packages/database/drizzle/per-firm/<timestamp>_seed-tools-email-inspector.sql` | Role seed                                                                                |

**Modified:** `crates/Cargo.toml` (members) · `vite.config.ts` (`rust-wasm-build`) · `apps/worker/wasm-modules.d.ts` · `apps/worker/package.json` · `apps/worker/src/app.ts` · `apps/worker/test/conformance.test.ts` · `packages/access-control/src/registry.ts` · `packages/tools/src/catalog.ts` · `apps/worker/src/per-firm-migrations.ts` · `packages/database/drizzle/per-firm/meta/_journal.json` · `docs/specs/2026-06-16-email-filing-design.md` · `ROADMAP.md`

---

### Task 1: Crate scaffold, record model, and error codes

No parsing yet. This task locks the types every later task consumes.

**Files:**

- Create: `crates/email-core/Cargo.toml`, `crates/email-core/src/lib.rs`, `crates/email-core/src/model.rs`, `crates/email-core/src/error.rs`
- Modify: `crates/Cargo.toml:3`

**Interfaces:**

- Produces: `ParsedMessage`, `PartDescriptor`, `MessageIdentifier`, `Address`, `SourceFormat`, `EmailError`, `EmailError::code() -> &'static str`, and the `ALLOWED_ERROR_CODES: &[&str]` constant.

- [ ] **Step 1: Add the crate to the workspace**

`crates/Cargo.toml` line 3 currently reads:

```toml
members = ["engine-host", "pdf-core", "pdf-eval", "recovery-core", "decryption-core"]
```

Change to:

```toml
members = ["engine-host", "pdf-core", "pdf-eval", "recovery-core", "decryption-core", "email-core"]
```

- [ ] **Step 2: Write `crates/email-core/Cargo.toml`**

`mail-parser` 0.11.5 ships **empty default features**, so charset breadth must be opted into explicitly.

```toml
[package]
name = "email-core"
version = "0.0.0"
edition.workspace = true
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
# Empty default features upstream; full_encoding buys the 41-charset decoder set
# (including the legacy encodings real correspondence still arrives in).
mail-parser = { version = "0.11.5", default-features = false, features = ["full_encoding"] }
# Reads .msg (CFB/OLE2 + MAPI property streams). Owns its own CFB layer, so this
# crate takes no direct `cfb` dependency.
msg_parser = "0.3.6"
thiserror = "2"
engine_host = { path = "../engine-host", package = "magna-carta-engine-host" }

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
```

- [ ] **Step 3: Write the failing model test**

Create `crates/email-core/src/model.rs` with only this test module at the bottom, then the types above it in Step 4.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_identifier_records_its_origin_not_just_a_string() {
        let from_header = MessageIdentifier::FromHeader("<a@b.example>".to_owned());
        let from_mapi = MessageIdentifier::FromMapi("<a@b.example>".to_owned());

        // Same bytes, different provenance: they must not compare equal, or
        // cross-source dedup would silently merge a synthesized identifier
        // with a real one.
        assert_ne!(from_header, from_mapi);
        assert_eq!(from_header.value(), Some("<a@b.example>"));
        assert_eq!(MessageIdentifier::Absent.value(), None);
    }
}
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml`
Expected: FAIL — `cannot find type MessageIdentifier in this scope`.

- [ ] **Step 5: Write the model**

Prepend to `crates/email-core/src/model.rs`:

```rust
//! The record every lane produces. No serde here — marshalling lives at the edges.

/// Which lane produced a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceFormat {
    Eml,
    Msg,
    MboxMember,
}

/// A message identifier that remembers where it came from.
///
/// A `.msg` file carries RFC 5322 headers only when `PidTagTransportMessageHeaders`
/// survived export, which Outlook frequently drops. An identifier synthesized from
/// MAPI properties is not the same bytes another recipient's `.eml` copy carries, so
/// collapsing both into a `String` would let dedup merge distinct messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageIdentifier {
    FromHeader(String),
    FromMapi(String),
    Absent,
}

impl MessageIdentifier {
    pub fn value(&self) -> Option<&str> {
        match self {
            MessageIdentifier::FromHeader(value) | MessageIdentifier::FromMapi(value) => Some(value),
            MessageIdentifier::Absent => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    pub display_name: Option<String>,
    pub address: Option<String>,
}

/// How a part presented itself. `Inline` covers `cid:`-referenced images.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    Attachment,
    Inline,
}

/// A part is described, never materialized, by `parse`. `byte_range` indexes the
/// original input buffer; `extract_part` turns one descriptor into bytes on demand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartDescriptor {
    pub filename: Option<String>,
    pub media_type: Option<String>,
    pub content_identifier: Option<String>,
    pub disposition: Disposition,
    pub size: usize,
    pub byte_range: core::ops::Range<usize>,
    pub is_embedded_message: bool,
}

/// Authenticity evidence, captured verbatim with no verdict attached. The engine
/// reports facts; whatever consumes it decides what they mean.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IntegrityFacts {
    pub dkim_signatures: Vec<String>,
    pub authentication_results: Vec<String>,
    pub received_chain: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMessage {
    pub message_identifier: MessageIdentifier,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub subject: Option<String>,
    pub date_raw: Option<String>,
    pub from: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    /// The full, ordered header list, verbatim. This is the evidentiary artifact and
    /// the signing input an external DKIM verifier requires.
    pub raw_headers: Vec<(String, String)>,
    pub text_bodies: Vec<String>,
    pub html_bodies: Vec<String>,
    /// Present when a `.msg` carries an RTF body and no plain-text alternative.
    /// Decompressed but not converted — conversion belongs to a renderer.
    pub rtf_body: Option<String>,
    pub parts: Vec<PartDescriptor>,
    pub integrity: IntegrityFacts,
    pub source_format: SourceFormat,
    /// Whether a body references remote content. A fact for a future renderer,
    /// not something this engine acts on.
    pub references_remote_content: bool,
}
```

- [ ] **Step 6: Write the failing error-code test**

Create `crates/email-core/src/error.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use engine_host::wasm_edge::{allowed_code, EdgeError};

    #[test]
    fn every_error_maps_to_a_declared_static_code() {
        let cases = [
            EmailError::Malformed,
            EmailError::Unsupported,
            EmailError::LimitExceeded,
            EmailError::PartNotFound,
        ];
        for error in cases {
            assert!(allowed_code(error.code(), ALLOWED_ERROR_CODES));
        }
    }

    #[test]
    fn a_content_bearing_string_is_rejected_by_the_guard() {
        assert!(!allowed_code("privileged-client-memo.msg", ALLOWED_ERROR_CODES));
    }
}
```

- [ ] **Step 7: Run it and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml`
Expected: FAIL — `cannot find type EmailError in this scope`.

- [ ] **Step 8: Write the error type**

Prepend to `crates/email-core/src/error.rs`:

```rust
use engine_host::wasm_edge::EdgeError;

/// The complete set of codes this engine may emit. Fixed `&'static str` values, so a
/// code can never carry file bytes across the edge.
pub const ALLOWED_ERROR_CODES: &[&str] = &["malformed", "unsupported", "limitExceeded", "partNotFound"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EmailError {
    #[error("malformed")]
    Malformed,
    #[error("unsupported")]
    Unsupported,
    #[error("limitExceeded")]
    LimitExceeded,
    #[error("partNotFound")]
    PartNotFound,
}

impl EdgeError for EmailError {
    fn code(&self) -> &'static str {
        match self {
            EmailError::Malformed => "malformed",
            EmailError::Unsupported => "unsupported",
            EmailError::LimitExceeded => "limitExceeded",
            EmailError::PartNotFound => "partNotFound",
        }
    }
}
```

- [ ] **Step 9: Write `crates/email-core/src/lib.rs`**

```rust
//! email-core: a pure, I/O-free email parse engine. Bytes in, a `ParsedMessage` out.
//!
//! Parse-only by construction. Rendering and DKIM signature verification stand on this
//! crate rather than inside it: the record carries authenticity evidence verbatim and
//! attaches no verdict to it.

pub mod error;
pub mod model;

pub use error::{EmailError, ALLOWED_ERROR_CODES};
pub use model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    SourceFormat,
};

#[cfg(target_arch = "wasm32")]
mod wasm;
```

- [ ] **Step 10: Run the tests and the repo Rust gate**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml`
Expected: PASS (2 tests).

Run: `cargo fmt --manifest-path crates/Cargo.toml --check && cargo clippy --manifest-path crates/Cargo.toml -p email-core -- -D warnings`
Expected: clean, no warnings.

- [ ] **Step 11: Commit**

```bash
git add crates/Cargo.toml crates/email-core
git commit -m "feat(email-core): scaffold the parse engine with its record model and error codes"
```

---

### Task 2: The `.eml` lane

**Files:**

- Create: `crates/email-core/src/eml.rs`, `crates/email-core/tests/fixtures/simple.eml`, `crates/email-core/tests/fixtures/with-attachment.eml`
- Modify: `crates/email-core/src/lib.rs`

**Interfaces:**

- Consumes: `ParsedMessage`, `EmailError` (Task 1).
- Produces: `pub fn parse_eml(bytes: &[u8]) -> Result<ParsedMessage, EmailError>`.

- [ ] **Step 1: Verify the upstream signature before writing against it**

`mail-parser`'s entry point is `MessageParser::default().parse(&[u8])`. Its return type differs across the 0.9–0.11 line (`Option<Message>` in recent releases, `Result` in older documentation). Do not guess — check the vendored source:

Run: `cargo add mail-parser@0.11.5 --no-default-features --features full_encoding --manifest-path crates/email-core/Cargo.toml --dry-run` then `cargo doc -p mail-parser --manifest-path crates/Cargo.toml --no-deps --open`

Confirm the exact signature of `MessageParser::parse` and of `Message::attachments()` / `text_bodies()` / `html_bodies()` before Step 3. Adjust the code below to match what you find; the compiler is the arbiter, not this document.

- [ ] **Step 2: Write the failing test**

Create `crates/email-core/tests/fixtures/simple.eml` with exactly this content (note: CRLF line endings, and a trailing blank line before the body):

```
Message-ID: <first@example.test>
From: Alice Attorney <alice@example.test>
To: Bob Client <bob@example.test>
Subject: Retainer
Date: Tue, 07 Jul 2026 10:00:00 -0700
DKIM-Signature: v=1; a=rsa-sha256; d=example.test; s=sel; b=AAAA
Content-Type: text/plain; charset=utf-8

The retainer is attached.
```

Append to `crates/email-core/src/eml.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MessageIdentifier, SourceFormat};

    const SIMPLE: &[u8] = include_bytes!("../tests/fixtures/simple.eml");

    #[test]
    fn parses_envelope_and_marks_identifier_as_header_sourced() {
        let message = parse_eml(SIMPLE).expect("fixture parses");

        assert_eq!(
            message.message_identifier,
            MessageIdentifier::FromHeader("first@example.test".to_owned())
        );
        assert_eq!(message.subject.as_deref(), Some("Retainer"));
        assert_eq!(message.from[0].address.as_deref(), Some("alice@example.test"));
        assert_eq!(message.to[0].display_name.as_deref(), Some("Bob Client"));
        assert_eq!(message.source_format, SourceFormat::Eml);
    }

    #[test]
    fn captures_the_dkim_signature_verbatim_without_a_verdict() {
        let message = parse_eml(SIMPLE).expect("fixture parses");
        assert_eq!(message.integrity.dkim_signatures.len(), 1);
        assert!(message.integrity.dkim_signatures[0].contains("d=example.test"));
    }

    #[test]
    fn preserves_the_full_ordered_header_list() {
        let message = parse_eml(SIMPLE).expect("fixture parses");
        let names: Vec<&str> = message.raw_headers.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names.first(), Some(&"Message-ID"));
        assert!(names.contains(&"DKIM-Signature"));
    }

    #[test]
    fn rejects_bytes_that_are_not_a_message() {
        assert!(parse_eml(&[0xFF, 0xFE, 0x00]).is_err());
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml eml`
Expected: FAIL — `cannot find function parse_eml`.

- [ ] **Step 4: Implement the lane**

Prepend to `crates/email-core/src/eml.rs`:

```rust
//! The RFC 5322 / MIME lane.

use crate::model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    SourceFormat,
};
use crate::EmailError;
use mail_parser::MessageParser;

pub fn parse_eml(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    let message = MessageParser::default().parse(bytes).ok_or(EmailError::Malformed)?;
    Ok(from_mail_parser_message(&message, SourceFormat::Eml))
}

/// Shared by the `.eml` lane and each mbox member.
pub(crate) fn from_mail_parser_message(
    message: &mail_parser::Message<'_>,
    source_format: SourceFormat,
) -> ParsedMessage {
    let raw_headers: Vec<(String, String)> = message
        .headers()
        .iter()
        .map(|header| {
            (
                header.name().to_owned(),
                String::from_utf8_lossy(
                    &message.raw_message()[header.offset_start()..header.offset_end()],
                )
                .trim()
                .to_owned(),
            )
        })
        .collect();

    let collect = |name: &str| -> Vec<String> {
        raw_headers
            .iter()
            .filter(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.clone())
            .collect()
    };

    let integrity = IntegrityFacts {
        dkim_signatures: collect("DKIM-Signature"),
        authentication_results: collect("Authentication-Results"),
        received_chain: collect("Received"),
    };

    let message_identifier = match message.message_id() {
        Some(value) => MessageIdentifier::FromHeader(value.to_owned()),
        None => MessageIdentifier::Absent,
    };

    let html_bodies: Vec<String> = message.html_bodies().filter_map(part_text).collect();
    let references_remote_content = html_bodies.iter().any(|body| {
        let lowered = body.to_ascii_lowercase();
        lowered.contains("src=\"http://") || lowered.contains("src=\"https://")
    });

    ParsedMessage {
        message_identifier,
        in_reply_to: message.in_reply_to().as_text().map(str::to_owned),
        references: message
            .references()
            .as_text_list()
            .unwrap_or_default()
            .into_iter()
            .map(str::to_owned)
            .collect(),
        subject: message.subject().map(str::to_owned),
        date_raw: collect("Date").into_iter().next(),
        from: addresses(message.from()),
        to: addresses(message.to()),
        cc: addresses(message.cc()),
        bcc: addresses(message.bcc()),
        raw_headers,
        text_bodies: message.text_bodies().filter_map(part_text).collect(),
        html_bodies,
        rtf_body: None,
        parts: message.attachments().map(descriptor).collect(),
        integrity,
        source_format,
        references_remote_content,
    }
}

fn addresses(group: Option<&mail_parser::Address<'_>>) -> Vec<Address> {
    group
        .map(|address| {
            address
                .iter()
                .map(|single| Address {
                    display_name: single.name().map(str::to_owned),
                    address: single.address().map(str::to_owned),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn part_text(part: &mail_parser::MessagePart<'_>) -> Option<String> {
    part.text_contents().map(str::to_owned)
}

fn descriptor(part: &mail_parser::MessagePart<'_>) -> PartDescriptor {
    let disposition = if part.is_inline() { Disposition::Inline } else { Disposition::Attachment };
    let byte_range = part.offset_body..part.offset_end;
    PartDescriptor {
        filename: part.attachment_name().map(str::to_owned),
        media_type: part.content_type().map(|ct| match ct.subtype() {
            Some(subtype) => format!("{}/{}", ct.ctype(), subtype),
            None => ct.ctype().to_owned(),
        }),
        content_identifier: part.content_id().map(str::to_owned),
        disposition,
        size: byte_range.len(),
        byte_range,
        is_embedded_message: matches!(part.body, mail_parser::PartType::Message(_)),
    }
}
```

Add to `crates/email-core/src/lib.rs`, after `pub mod model;`:

```rust
pub mod eml;
pub use eml::parse_eml;
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml eml`
Expected: PASS (4 tests). If accessor names differ from Step 1's findings, fix them here — the record shape is fixed, the upstream call sites are not.

- [ ] **Step 6: Commit**

```bash
git add crates/email-core
git commit -m "feat(email-core): read RFC 5322 messages, capturing headers and authenticity evidence verbatim"
```

---

### Task 3: The mbox lane

**Files:**

- Create: `crates/email-core/src/mbox.rs`, `crates/email-core/tests/fixtures/two-messages.mbox`
- Modify: `crates/email-core/src/lib.rs`

**Interfaces:**

- Consumes: `from_mail_parser_message` (Task 2), `Limits` is not yet available — caps arrive in Task 5.
- Produces: `pub fn parse_mbox(bytes: &[u8]) -> Result<Vec<ParsedMessage>, EmailError>` and `pub fn mbox_member_ranges(bytes: &[u8]) -> Vec<core::ops::Range<usize>>`.

- [ ] **Step 1: Check for an upstream mbox module before hand-rolling one**

`mail-parser` documents a `mailbox` module. Golden rule 1 is reuse-before-build, so check it first:

Run: `cargo doc -p mail-parser --manifest-path crates/Cargo.toml --no-deps --open` and inspect `mail_parser::mailbox`.

If it exposes an mbox reader over `&[u8]` that yields message byte ranges, use it and skip Steps 3–4, keeping the tests. If it only offers an `io::Read`-based reader (which would drag I/O into an I/O-free crate), hand-roll the framing iterator as below.

- [ ] **Step 2: Write the failing test**

Create `crates/email-core/tests/fixtures/two-messages.mbox`. The second message's **body** contains a line beginning `From ` — the classic framing trap, escaped as `>From ` per mboxrd:

```
From alice@example.test Tue Jul 07 10:00:00 2026
Message-ID: <one@example.test>
From: alice@example.test
Subject: First

Body one.

From bob@example.test Tue Jul 07 11:00:00 2026
Message-ID: <two@example.test>
From: bob@example.test
Subject: Second

>From the desk of Bob, this line must not split the message.
Body two.
```

Append to `crates/email-core/src/mbox.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MessageIdentifier, SourceFormat};

    const MBOX: &[u8] = include_bytes!("../tests/fixtures/two-messages.mbox");

    #[test]
    fn splits_on_the_separator_and_not_on_an_escaped_body_line() {
        let ranges = mbox_member_ranges(MBOX);
        assert_eq!(ranges.len(), 2, "an escaped >From line must not start a new member");
    }

    #[test]
    fn each_member_parses_and_is_tagged_as_an_mbox_member() {
        let messages = parse_mbox(MBOX).expect("fixture parses");
        assert_eq!(messages.len(), 2);
        assert_eq!(
            messages[0].message_identifier,
            MessageIdentifier::FromHeader("one@example.test".to_owned())
        );
        assert_eq!(messages[1].subject.as_deref(), Some("Second"));
        assert_eq!(messages[1].source_format, SourceFormat::MboxMember);
    }

    #[test]
    fn an_empty_buffer_yields_no_members() {
        assert!(mbox_member_ranges(b"").is_empty());
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml mbox`
Expected: FAIL — `cannot find function mbox_member_ranges`.

- [ ] **Step 4: Implement the framing iterator**

Prepend to `crates/email-core/src/mbox.rs`:

```rust
//! The mbox lane. An mbox is not a message — it is a `From_`-delimited concatenation
//! of RFC 5322 messages, so this is a framing iterator over the `.eml` lane, not a parser.

use crate::eml::from_mail_parser_message;
use crate::model::{ParsedMessage, SourceFormat};
use crate::EmailError;
use mail_parser::MessageParser;

const SEPARATOR: &[u8] = b"From ";

/// True when `position` begins a line that is an mbox separator. A separator is only
/// recognised at the start of a line; `>From ` in a body is an escaped literal, not a frame.
fn is_separator_at(bytes: &[u8], position: usize) -> bool {
    if !bytes[position..].starts_with(SEPARATOR) {
        return false;
    }
    position == 0 || bytes[position - 1] == b'\n'
}

pub fn mbox_member_ranges(bytes: &[u8]) -> Vec<core::ops::Range<usize>> {
    let mut starts: Vec<usize> = Vec::new();
    for position in 0..bytes.len() {
        if is_separator_at(bytes, position) {
            starts.push(position);
        }
    }

    starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = starts.get(index + 1).copied().unwrap_or(bytes.len());
            start..end
        })
        .collect()
}

pub fn parse_mbox(bytes: &[u8]) -> Result<Vec<ParsedMessage>, EmailError> {
    let parser = MessageParser::default();
    mbox_member_ranges(bytes)
        .into_iter()
        .map(|range| {
            // Skip the separator line itself; the RFC 5322 message starts after it.
            let member = &bytes[range];
            let body_start = member
                .iter()
                .position(|&byte| byte == b'\n')
                .map(|newline| newline + 1)
                .unwrap_or(member.len());
            let message = parser.parse(&member[body_start..]).ok_or(EmailError::Malformed)?;
            Ok(from_mail_parser_message(&message, SourceFormat::MboxMember))
        })
        .collect()
}
```

Make `from_mail_parser_message` reachable: it is already `pub(crate)` in Task 2.

Add to `crates/email-core/src/lib.rs`:

```rust
pub mod mbox;
pub use mbox::{mbox_member_ranges, parse_mbox};
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml mbox`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add crates/email-core
git commit -m "feat(email-core): frame mbox members without splitting on escaped From lines"
```

---

### Task 4: The `.msg` lane and identifier provenance

**Files:**

- Create: `crates/email-core/src/msg.rs`, `crates/email-core/tests/fixtures/README.md`
- Modify: `crates/email-core/src/lib.rs`

**Interfaces:**

- Consumes: `ParsedMessage`, `MessageIdentifier`, `EmailError`.
- Produces: `pub fn parse_msg(bytes: &[u8]) -> Result<ParsedMessage, EmailError>`.

- [ ] **Step 1: Audit `msg_parser` before adopting it**

This is the one dependency taking untrusted bytes whose maturity is unestablished. Gate adoption on evidence, not on the crates.io blurb.

Run:

```bash
cargo tree -p email-core --manifest-path crates/Cargo.toml | grep -i msg_parser
```

Then review `https://github.com/marirs/msg-parser-rs`: last commit date, open issue count, whether it has tests, and — critically — whether it panics or returns `Err` on truncated input.

Record the verdict in `crates/email-core/CLAUDE.md` (Task 8). **If it panics on malformed input**, wrap every call site in `std::panic::catch_unwind` is _not_ available on wasm32 — instead, reject the dependency and read the MAPI property streams directly over `cfb = "0.14"` (the version `recovery-core` already pins). Do not adopt a panicking parser on the wasm edge.

- [ ] **Step 2: Generate the `.msg` fixtures**

`.msg` is a binary CFB container and cannot be authored by hand. Create two fixtures with Outlook (or `msg_parser`'s own test corpus, license permitting):

- `crates/email-core/tests/fixtures/with-transport-headers.msg` — exported so `PidTagTransportMessageHeaders` is present.
- `crates/email-core/tests/fixtures/no-transport-headers.msg` — a draft saved from Outlook, which drops that property.

Document their provenance in `crates/email-core/tests/fixtures/README.md`, stating that neither contains real client content.

- [ ] **Step 3: Write the failing test**

Append to `crates/email-core/src/msg.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MessageIdentifier, SourceFormat};

    const WITH_HEADERS: &[u8] = include_bytes!("../tests/fixtures/with-transport-headers.msg");
    const WITHOUT_HEADERS: &[u8] = include_bytes!("../tests/fixtures/no-transport-headers.msg");

    #[test]
    fn a_msg_with_transport_headers_yields_a_header_sourced_identifier() {
        let message = parse_msg(WITH_HEADERS).expect("fixture parses");
        assert!(matches!(message.message_identifier, MessageIdentifier::FromHeader(_)));
        assert_eq!(message.source_format, SourceFormat::Msg);
        assert!(!message.raw_headers.is_empty());
    }

    #[test]
    fn a_msg_without_transport_headers_never_claims_a_header_sourced_identifier() {
        let message = parse_msg(WITHOUT_HEADERS).expect("fixture parses");
        assert!(
            !matches!(message.message_identifier, MessageIdentifier::FromHeader(_)),
            "a synthesized identifier must not masquerade as one read from a header"
        );
        assert!(message.raw_headers.is_empty());
    }

    #[test]
    fn truncated_compound_file_bytes_return_an_error_and_do_not_panic() {
        let truncated = &WITH_HEADERS[..WITH_HEADERS.len() / 3];
        assert!(parse_msg(truncated).is_err());
    }
}
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml msg`
Expected: FAIL — `cannot find function parse_msg`.

- [ ] **Step 5: Implement the lane**

Prepend to `crates/email-core/src/msg.rs`:

```rust
//! The CFB / MAPI lane. `engine_host::format::detect` identifies the Ole2 container;
//! this module decides what kind of Ole2 it is and reads the MAPI property streams.

use crate::model::{
    Address, Disposition, IntegrityFacts, MessageIdentifier, ParsedMessage, PartDescriptor,
    SourceFormat,
};
use crate::EmailError;
use msg_parser::Outlook;

pub fn parse_msg(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    let outlook = Outlook::from_slice(bytes).map_err(|_| EmailError::Malformed)?;

    // RFC 5322 headers survive a .msg only when PidTagTransportMessageHeaders was
    // preserved. Outlook frequently drops it, so an absent header block is ordinary,
    // not an error — and the identifier must say which world it came from.
    let transport_headers = outlook.transport_headers();
    let raw_headers: Vec<(String, String)> = transport_headers
        .map(parse_header_block)
        .unwrap_or_default();

    let message_identifier = match header_value(&raw_headers, "Message-ID") {
        Some(value) => MessageIdentifier::FromHeader(value),
        None => match outlook.internet_message_identifier() {
            Some(value) => MessageIdentifier::FromMapi(value),
            None => MessageIdentifier::Absent,
        },
    };

    let html_bodies: Vec<String> = outlook.html.clone().into_iter().filter(|b| !b.is_empty()).collect();

    Ok(ParsedMessage {
        message_identifier,
        in_reply_to: header_value(&raw_headers, "In-Reply-To"),
        references: header_value(&raw_headers, "References")
            .map(|value| value.split_whitespace().map(str::to_owned).collect())
            .unwrap_or_default(),
        subject: Some(outlook.subject.clone()).filter(|s| !s.is_empty()),
        date_raw: Some(outlook.message_delivery_time.clone()).filter(|d| !d.is_empty()),
        from: vec![person_to_address(&outlook.sender)],
        to: outlook.to.iter().map(person_to_address).collect(),
        cc: outlook.cc.iter().map(person_to_address).collect(),
        bcc: outlook.bcc.iter().map(person_to_address).collect(),
        integrity: IntegrityFacts {
            dkim_signatures: headers_named(&raw_headers, "DKIM-Signature"),
            authentication_results: headers_named(&raw_headers, "Authentication-Results"),
            received_chain: headers_named(&raw_headers, "Received"),
        },
        raw_headers,
        text_bodies: Vec::new(),
        // An RTF-only body is decompressed and exposed, never converted. Conversion is a
        // renderer's job, so such a message legitimately carries no text body here.
        rtf_body: outlook.rtf().map(str::to_owned),
        html_bodies,
        parts: outlook.attachments.iter().map(attachment_descriptor).collect(),
        source_format: SourceFormat::Msg,
        references_remote_content: false,
    })
}

fn parse_header_block(block: &str) -> Vec<(String, String)> {
    block
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_owned(), value.trim().to_owned()))
        .collect()
}

fn header_value(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

fn headers_named(headers: &[(String, String)], name: &str) -> Vec<String> {
    headers
        .iter()
        .filter(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
        .collect()
}
```

Write `person_to_address` and `attachment_descriptor` against the real `msg_parser::Person` / `msg_parser::Attachment` field names discovered in Step 1 — they are `pub` fields, not accessors. `attachment_descriptor` sets `disposition: Disposition::Attachment`, `is_embedded_message` from whether `as_message()` succeeds, and a `byte_range` of `0..size` (a `.msg` attachment is a MAPI stream, not a slice of the input buffer, so the range is stream-relative; note this in a comment).

Add to `crates/email-core/src/lib.rs`:

```rust
pub mod msg;
pub use msg::parse_msg;
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml msg`
Expected: PASS (3 tests).

- [ ] **Step 7: Add the dispatching entry point**

Append to `crates/email-core/src/lib.rs`:

```rust
use engine_host::format::{detect, Format};

/// Parse a single message, choosing the lane from its container magic. An mbox holds
/// many messages and has its own entry point (`parse_mbox`) rather than pretending to
/// be one message.
pub fn parse(bytes: &[u8]) -> Result<ParsedMessage, EmailError> {
    if bytes.is_empty() {
        return Err(EmailError::Malformed);
    }
    match detect(bytes) {
        Some(Format::Ole2) => parse_msg(bytes),
        Some(Format::Pdf) | Some(Format::Zip) => Err(EmailError::Unsupported),
        None => parse_eml(bytes),
    }
}
```

Add a test asserting `parse` routes a PDF to `Unsupported` and an `.eml` fixture to `SourceFormat::Eml`.

- [ ] **Step 8: Run the full crate suite and commit**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml`
Expected: PASS.

```bash
git add crates/email-core
git commit -m "feat(email-core): read .msg via MAPI, keeping synthesized identifiers distinguishable from header-sourced ones"
```

---

### Task 5: Untrusted-input limits, two-phase extraction, and fuzz targets

**Files:**

- Create: `crates/email-core/src/limits.rs`, `crates/email-core/fuzz/Cargo.toml`, `crates/email-core/fuzz/fuzz_targets/parse_eml.rs`, `crates/email-core/fuzz/fuzz_targets/parse_msg.rs`, `crates/email-core/fuzz/fuzz_targets/parse_mbox.rs`
- Modify: `crates/email-core/src/lib.rs`, `crates/email-core/src/eml.rs`, `crates/email-core/src/mbox.rs`

**Interfaces:**

- Produces: `Limits` (with `Default`), `parse_with_limits`, `parse_mbox_with_limits`, `extract_part(bytes, &PartDescriptor) -> Result<Vec<u8>, EmailError>`.

- [ ] **Step 1: Write the failing limits tests**

Create `crates/email-core/src/limits.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_mbox_with_limits, parse_with_limits, EmailError};

    #[test]
    fn default_limits_are_conservative() {
        let limits = Limits::default();
        assert_eq!(limits.max_mime_depth, 32);
        assert_eq!(limits.max_part_count, 512);
        assert_eq!(limits.max_embedded_message_depth, 8);
        assert_eq!(limits.max_mbox_member_count, 100_000);
    }

    #[test]
    fn a_message_exceeding_the_input_cap_is_rejected_before_parsing() {
        let limits = Limits { max_input_bytes: 16, ..Limits::default() };
        let oversized = vec![b'A'; 64];
        assert_eq!(parse_with_limits(&oversized, &limits), Err(EmailError::LimitExceeded));
    }

    #[test]
    fn an_mbox_exceeding_the_member_cap_is_rejected() {
        let limits = Limits { max_mbox_member_count: 1, ..Limits::default() };
        let two_members = b"From a@b Tue Jul 07 10:00:00 2026\nSubject: One\n\nx\n\nFrom c@d Tue Jul 07 11:00:00 2026\nSubject: Two\n\ny\n";
        assert_eq!(parse_mbox_with_limits(two_members, &limits), Err(EmailError::LimitExceeded));
    }

    #[test]
    fn a_deeply_nested_multipart_is_rejected_rather_than_recursed() {
        let limits = Limits { max_mime_depth: 3, ..Limits::default() };
        let mut nested = String::from("Content-Type: multipart/mixed; boundary=b0\n\n");
        for depth in 0..10 {
            nested.push_str(&format!("--b0\nContent-Type: multipart/mixed; boundary=b{depth}\n\n"));
        }
        assert_eq!(parse_with_limits(nested.as_bytes(), &limits), Err(EmailError::LimitExceeded));
    }
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml limits`
Expected: FAIL — `cannot find type Limits`.

- [ ] **Step 3: Implement the caps**

Prepend to `crates/email-core/src/limits.rs`:

```rust
//! Caps for attacker-controlled input. A declared length never sizes an allocation;
//! every violation is a typed error, never a panic and never a truncated success.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_input_bytes: usize,
    pub max_mime_depth: usize,
    pub max_part_count: usize,
    /// Base64 expands roughly 1.37x, so a part's decoded size is bounded independently
    /// of whatever length the message claims.
    pub max_decoded_part_bytes: usize,
    pub max_embedded_message_depth: usize,
    pub max_mbox_member_count: usize,
    pub max_mbox_member_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_input_bytes: 128 * 1024 * 1024,
            max_mime_depth: 32,
            max_part_count: 512,
            max_decoded_part_bytes: 64 * 1024 * 1024,
            max_embedded_message_depth: 8,
            max_mbox_member_count: 100_000,
            max_mbox_member_bytes: 128 * 1024 * 1024,
        }
    }
}
```

Then add `parse_with_limits` / `parse_mbox_with_limits` to `lib.rs`, redefining `parse` and `parse_mbox` as `parse_with_limits(bytes, &Limits::default())` and its mbox twin. Enforce `max_input_bytes` before touching the parser; enforce `max_part_count`, `max_mime_depth`, and `max_embedded_message_depth` while walking parts; enforce the mbox caps against `mbox_member_ranges` before parsing any member.

- [ ] **Step 4: Write the failing `extract_part` test**

Append to `crates/email-core/src/lib.rs`'s test module:

```rust
#[test]
fn extract_part_returns_bytes_for_a_descriptor_and_rejects_a_foreign_range() {
    const WITH_ATTACHMENT: &[u8] = include_bytes!("../tests/fixtures/with-attachment.eml");
    let message = parse(WITH_ATTACHMENT).expect("fixture parses");
    let descriptor = &message.parts[0];

    let bytes = extract_part(WITH_ATTACHMENT, descriptor).expect("part extracts");
    assert_eq!(bytes.len(), descriptor.size);

    let mut foreign = descriptor.clone();
    foreign.byte_range = 0..(WITH_ATTACHMENT.len() + 1);
    assert_eq!(extract_part(WITH_ATTACHMENT, &foreign), Err(EmailError::PartNotFound));
}
```

Create `crates/email-core/tests/fixtures/with-attachment.eml` — a `multipart/mixed` message with one small base64 `text/plain` attachment named `retainer.txt`.

- [ ] **Step 5: Implement `extract_part`**

```rust
/// Materialize one part's bytes on demand. `parse` returns descriptors carrying byte
/// ranges rather than payloads, so a caller that wants only headers and text — bulk
/// indexing, the Inspector's listing — never pays for attachment bytes it discards.
pub fn extract_part(bytes: &[u8], descriptor: &PartDescriptor) -> Result<Vec<u8>, EmailError> {
    let range = descriptor.byte_range.clone();
    if range.end > bytes.len() || range.start > range.end {
        return Err(EmailError::PartNotFound);
    }
    Ok(bytes[range].to_vec())
}
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml`
Expected: PASS (all lanes + limits + extraction).

- [ ] **Step 7: Add the fuzz targets**

Create `crates/email-core/fuzz/fuzz_targets/parse_eml.rs`:

```rust
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // The contract is total: any byte string yields Ok or Err, never a panic.
    let _ = email_core::parse_eml(data);
});
```

Mirror it for `parse_msg` and `parse_mbox`. Write `crates/email-core/fuzz/Cargo.toml` per `cargo fuzz init` conventions, with `email-core = { path = ".." }` and `libfuzzer-sys = "0.4"`.

- [ ] **Step 8: Run each target briefly**

Run: `cargo +nightly fuzz run parse_eml -- -max_total_time=60`
Expected: no crashes in 60 seconds. Repeat for `parse_msg` and `parse_mbox`.

If `parse_msg` panics, `msg_parser` failed the Task 4 Step 1 audit — stop and switch to the `cfb` fallback.

- [ ] **Step 9: Commit**

```bash
git add crates/email-core
git commit -m "feat(email-core): bound untrusted input with typed limits and extract parts on demand"
```

---

### Task 6: The WASM edge and the Docker build

**Files:**

- Create: `crates/email-core/src/wasm.rs`, `crates/email-core/wasm.Dockerfile`
- Modify: `vite.config.ts` (the `rust-wasm-build` task)

**Interfaces:**

- Produces the JS-visible functions `parse(bytes) -> object`, `parseMbox(bytes) -> array`, `extractPart(bytes, byteStart, byteEnd) -> Uint8Array`.

- [ ] **Step 1: Write the failing allowed-code test**

Append to `crates/email-core/src/error.rs`'s test module:

```rust
#[test]
fn the_declared_code_set_is_exactly_the_engines_error_variants() {
    assert_eq!(ALLOWED_ERROR_CODES.len(), 4);
    for code in ALLOWED_ERROR_CODES {
        assert!(!code.contains('.'), "a code must never look like a filename");
        assert!(!code.contains('/'), "a code must never look like a path");
    }
}
```

Run: `cargo test -p email-core --manifest-path crates/Cargo.toml error`
Expected: PASS (this guards Step 2's edge).

- [ ] **Step 2: Write `crates/email-core/src/wasm.rs`**

Marshalling only. Use `engine_host::wasm_edge::{bytes_out, to_js_error, ObjectBuilder}`. Mirror `crates/decryption-core/src/wasm.rs`.

```rust
//! Thin JS marshalling edge — compiled only for wasm32. No engine logic here.

use crate::{extract_part as core_extract_part, model::PartDescriptor, EmailError};
use engine_host::wasm_edge::{bytes_out, to_js_error};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn parse(bytes: &[u8]) -> Result<js_sys::Object, JsError> {
    let message = crate::parse(bytes).map_err(|error| to_js_error(&error))?;
    Ok(message_to_object(&message))
}

#[wasm_bindgen(js_name = parseMbox)]
pub fn parse_mbox(bytes: &[u8]) -> Result<js_sys::Array, JsError> {
    let messages = crate::parse_mbox(bytes).map_err(|error| to_js_error(&error))?;
    let array = js_sys::Array::new();
    for message in &messages {
        array.push(&message_to_object(message));
    }
    Ok(array)
}

#[wasm_bindgen(js_name = extractPart)]
pub fn extract_part(bytes: &[u8], byte_start: usize, byte_end: usize) -> Result<js_sys::Uint8Array, JsError> {
    let descriptor = PartDescriptor {
        filename: None,
        media_type: None,
        content_identifier: None,
        disposition: crate::Disposition::Attachment,
        size: byte_end.saturating_sub(byte_start),
        byte_range: byte_start..byte_end,
        is_embedded_message: false,
    };
    let part = core_extract_part(bytes, &descriptor).map_err(|error: EmailError| to_js_error(&error))?;
    Ok(bytes_out(&part))
}
```

Write `message_to_object` with `ObjectBuilder`, emitting camelCase keys: `messageIdentifier` as `{ value, provenance }` where provenance is `"header" | "mapi" | "absent"`; `subject`, `dateRaw`, `from`/`to`/`cc`/`bcc` as arrays of `{ displayName, address }`; `rawHeaders` as an array of `{ name, value }`; `textBodies`, `htmlBodies`, `rtfBody`; `parts` as `{ filename, mediaType, contentIdentifier, disposition, size, byteStart, byteEnd, isEmbeddedMessage }`; `integrity` as `{ dkimSignatures, authenticationResults, receivedChain }`; `sourceFormat`; `referencesRemoteContent`.

- [ ] **Step 3: Write `crates/email-core/wasm.Dockerfile`**

Copy `crates/decryption-core/wasm.Dockerfile` verbatim and change three things: the header comment (describe the email engine and that the artifact is never deployed), `wasm-pack build decryption-core` → `wasm-pack build email-core`, and the `--output` destination in the comment.

- [ ] **Step 4: Wire the build into `vite.config.ts`**

The `rust-wasm-build` task currently chains two `docker build` invocations (around lines 125-128), one per crate. Append a third, following the existing shape exactly:

```
&& docker build --output type=local,dest=packages/email/src/pkg -f crates/email-core/wasm.Dockerfile crates
```

Missing this step does not fail here — it fails later, at worker bundle time, with `ENOENT` on the absent `.wasm`.

- [ ] **Step 5: Build the artifact**

Run: `vp run rust-wasm-build`
Expected: `packages/email/src/pkg/email_core.js`, `email_core_bg.wasm`, and `email_core.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add crates/email-core vite.config.ts
git commit -m "feat(email-core): marshal the parse record across the wasm edge"
```

---

### Task 7: The `@magna-carta/email` TypeScript package

**Files:**

- Create: `packages/email/package.json`, `packages/email/tsconfig.json`, `packages/email/vitest.config.ts`, `packages/email/src/index.ts`, `packages/email/.gitignore`, `packages/email/test/parse.test.ts`
- Modify: (generated) `packages/email/tsconfig.build.json`, root + worker `tsconfig.build.json`

**Interfaces:**

- Consumes: the wasm-pack output from Task 6.
- Produces: `ensureReady(wasmInput?)`, `parseMessage(bytes)`, `parseMailbox(bytes)`, `extractPart(bytes, byteStart, byteEnd)`, `EmailError`, `EmailErrorCode`, `ParsedMessage` (TS interface mirroring the Rust record).

- [ ] **Step 1: Write `packages/email/package.json`**

The `_bg.wasm` export entry is what lets the Worker bundler hand the module in pre-compiled.

```json
{
  "name": "@magna-carta/email",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./src/pkg/email_core_bg.wasm": "./src/pkg/email_core_bg.wasm"
  },
  "scripts": {
    "test": "vp test run",
    "build:wasm": "wasm-pack build ../../crates/email-core --target web --out-dir ../../packages/email/src/pkg --release --no-opt"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vite-plus": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Write `packages/email/tsconfig.json`**

It must carry its own `compilerOptions` — an `{extends, include}`-only file breaks `.ts` imports under `tsc` with TS5097.

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022", "WebWorker"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Copy `packages/decryption/.gitignore` and `packages/decryption/vitest.config.ts` verbatim.

- [ ] **Step 3: Write the failing package test**

Create `packages/email/test/parse.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureReady, parseMessage } from "../src/index.ts";

const wasm = readFileSync(new URL("../src/pkg/email_core_bg.wasm", import.meta.url));

describe("parseMessage", () => {
  it("returns a header-sourced identifier for an eml message", async () => {
    await ensureReady(wasm);
    const eml = readFileSync(
      new URL("../../../crates/email-core/tests/fixtures/simple.eml", import.meta.url),
    );
    const message = await parseMessage(new Uint8Array(eml));

    expect(message.messageIdentifier.provenance).toBe("header");
    expect(message.subject).toBe("Retainer");
    expect(message.sourceFormat).toBe("eml");
  });

  it("throws a coded EmailError on bytes that are not a message", async () => {
    await ensureReady(wasm);
    await expect(parseMessage(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `pnpm --filter @magna-carta/email test`
Expected: FAIL — cannot resolve `../src/index.ts`.

- [ ] **Step 5: Write `packages/email/src/index.ts`**

Mirror `packages/decryption/src/index.ts` exactly: the module-level `ready` promise, the `ensureReady(wasmInput?)` dual Node/Workers loader passing `init({ module_or_path })`, an `EmailError extends Error` carrying `.code`, a `KNOWN_ERROR_CODES` set, and a `wrapEngineError` that maps an unrecognised throw to `"malformed"`. Export the `ParsedMessage` / `PartDescriptor` / `MessageIdentifier` TypeScript interfaces mirroring the camelCase object the edge emits.

```ts
export type EmailErrorCode = "malformed" | "unsupported" | "limitExceeded" | "partNotFound";

export class EmailError extends Error {
  public readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode) {
    super(code);
    this.name = "EmailError";
    this.code = code;
  }
}
```

Callers branch on `.code` — never string-match `.message`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @magna-carta/email test`
Expected: PASS (2 tests).

- [ ] **Step 7: Regenerate the project-reference graph**

The generator auto-discovers any `packages/*` directory holding both a `@magna-carta/*` `package.json` and a `tsconfig.json` — but its output is committed and CI gates on staleness.

Run: `node tooling/tsconfig-refs/index.mjs`
Then: `node tooling/tsconfig-refs/index.mjs --check`
Expected: exit 0. A new `packages/email/tsconfig.build.json` appears.

- [ ] **Step 8: Commit**

```bash
git add packages/email tsconfig.build.json apps/worker/tsconfig.build.json
git commit -m "feat(email): wrap the parse engine for TypeScript consumers"
```

---

### Task 8: Permission, catalog row, and the engine's local rules

**Files:**

- Modify: `packages/access-control/src/registry.ts`, `packages/tools/src/catalog.ts`
- Create: `crates/email-core/CLAUDE.md`

**Interfaces:**

- Produces: the permission key `tools:emailInspector` and the catalog id `email-inspector`.

- [ ] **Step 1: Register the permission**

In `packages/access-control/src/registry.ts`, inside the `tools:` block (around lines 40-64), add one entry in the existing style:

```ts
"tools:emailInspector", // Inspect an email file's headers, participants, attachments, and authenticity evidence
```

Note this file already shows as modified in the working tree — rebase onto whatever is there rather than overwriting it.

- [ ] **Step 2: Add the catalog row**

In `packages/tools/src/catalog.ts`, append to `CATALOG`, mirroring the `file-type-verifier` row:

```ts
{
  id: "email-inspector",
  name: "Email Inspector",
  icon: "mail-search",
  subjectGroup: "files",
  permission: assertPermission("tools:emailInspector"),
  contextTags: ["file", "none"],
  // The parse engine is in-house WebAssembly, not a connected third-party service.
  backing: { kind: "library" },
  // Stateless: bytes in, a report out. Nothing is stored, so no matter is involved.
  matterContext: "none",
},
```

`assertPermission` validates at module load — an unregistered key fails loud here, so Step 1 must land first.

- [ ] **Step 3: Run the gates that this touches**

Run: `pnpm --filter @magna-carta/access-control test && pnpm --filter @magna-carta/tools test`
Expected: PASS, including `packages/tools/test/purity.test.ts` (the catalog must import no tool logic or UI).

- [ ] **Step 4: Write `crates/email-core/CLAUDE.md`**

Cover: the parse-only boundary and why rendering and DKIM verification live outside; the pure-Rust / no-C rule and that `r2` stays off; that `wasm.rs` is marshalling only and error codes are a fixed set; that `MessageIdentifier` provenance must never be flattened to a string; that `.msg` RTF-only bodies yield no text body by design; and the recorded verdict of the Task 4 `msg_parser` audit.

- [ ] **Step 5: Commit**

```bash
git add packages/access-control packages/tools crates/email-core/CLAUDE.md
git commit -m "feat(tools): register the Email Inspector permission and catalog row"
```

---

### Task 9: The Email Inspector route

**Files:**

- Create: `apps/worker/src/routes/email/email-inspector.ts`
- Modify: `apps/worker/package.json`, `apps/worker/wasm-modules.d.ts`, `apps/worker/src/app.ts`

**Interfaces:**

- Consumes: `@magna-carta/email` (Task 7), `tools:emailInspector` (Task 8).
- Produces: operationId `emailInspector.inspect` at `POST /api/v1/email/inspect`.

- [ ] **Step 1: Declare the dependency and the ambient wasm module**

`apps/worker/package.json` — add `"@magna-carta/email": "workspace:*"` to `dependencies`.

`apps/worker/wasm-modules.d.ts` — add, beside the decryption block:

```ts
declare module "@magna-carta/email/src/pkg/email_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
```

- [ ] **Step 2: Write the route**

Create `apps/worker/src/routes/email/email-inspector.ts`, modelled on `apps/worker/src/routes/files/file-type.ts`. Key points: import the wasm module and pass it to `ensureReady`; cap the body with `readInspectableSizeCap`; return `413` when over cap after `body.cancel()`; map `EmailError` codes onto Problem responses (`unsupported` → 415, `limitExceeded` → 413, `malformed` → 422).

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { EmailError, ensureReady, parseMessage } from "@magna-carta/email";
import emailWasmModule from "@magna-carta/email/src/pkg/email_core_bg.wasm";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const emailWasm = emailWasmModule as unknown as WebAssembly.Module;

export const emailInspectMeta: RouteMeta = {
  operationId: "emailInspector.inspect",
  surface: "app",
  authenticated: true,
  permission: "tools:emailInspector",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};
```

Define the response schema mirroring `ParsedMessage` — `messageIdentifier: z.object({ value: z.string().nullable(), provenance: z.enum(["header", "mapi", "absent"]) })`, the address arrays, `rawHeaders`, `textBodies`, `htmlBodies`, `rtfBody`, `parts`, `integrity`, `sourceFormat`, `referencesRemoteContent`.

The route `description` must state what it does without citing any process artifact, and must end with **"Nothing is stored."** — matching the other stateless tools. Do not name a slice, ADR, or spec in it.

The handler:

```ts
const firm = requireChokepointFirmContext(c);
const body = c.req.raw.body;
if (body === null) {
  /* 400 problemJson, type: "validation" */
}
const sizeBytes = Number(c.req.header("content-length") ?? "0");
const cap = await readInspectableSizeCap(firm.firmDatabase);
if (sizeBytes > cap) {
  await body.cancel(); /* 413 problemJson */
}

await ensureReady(emailWasm);
try {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return c.json(await parseMessage(bytes), 200);
} catch (thrown) {
  if (thrown instanceof EmailError) {
    // Branch on .code — the engine's codes are a fixed set and carry no file content.
  }
  throw thrown;
}
```

Never log the file bytes or a filename into telemetry, and never use `console.*`.

- [ ] **Step 3: Mount it**

`apps/worker/src/app.ts` — add the import beside the sibling tool routes (near lines 53-59):

```ts
import { registerEmailInspectorRoutes } from "./routes/email/email-inspector.ts";
```

and the registration inside `createApp()` (near lines 412-421), in the same block:

```ts
registerEmailInspectorRoutes(app, chokepoint);
```

Every `/api/v1` route must go through the chokepoint or startup throws.

- [ ] **Step 4: Typecheck and run the worker suite**

Run: `node tooling/tsconfig-refs/index.mjs && pnpm --filter @magna-carta/worker test`
Expected: the conformance suite FAILS on an unknown operationId — that is Task 10's job. Every other test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): expose the Email Inspector route over the parse engine"
```

---

### Task 10: Contract regeneration and conformance

**Files:**

- Modify: `apps/worker/openapi/openapi.json` (generated), `packages/api-client/src/*` (generated), `apps/worker/test/conformance.test.ts`

- [ ] **Step 1: Add the operationId to the non-vacuous list**

`apps/worker/test/conformance.test.ts` asserts the exact sorted set of committed operationIds (around lines 508-510). Add `"emailInspector.inspect"` in sorted position. Without this, conformance fails.

- [ ] **Step 2: Regenerate the OpenAPI snapshot**

Never hand-edit it.

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Expected: `apps/worker/openapi/openapi.json` gains the `/api/v1/email/inspect` path.

- [ ] **Step 3: Regenerate the typed client**

Run: `pnpm generate-client`
Expected: `packages/api-client/src/types.gen.ts`, `sdk.gen.ts`, and `@tanstack/svelte-query.gen.ts` gain the operation. These files are formatter-ignored — do not reformat them.

- [ ] **Step 4: Run the worker suite**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS, including the byte-exact OpenAPI drift test, the `errorId` coverage check (your Problem responses inherit `errorId` from the shared `Problem` schema), and conformance.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/openapi apps/worker/test/conformance.test.ts packages/api-client/src
git commit -m "feat(worker): publish the Email Inspector operation in the API contract"
```

---

### Task 11: Seed the permission onto the default roles

Without this the permission exists but nobody holds it, so the tool is invisible in-product. This is the only database change — there are no tables.

**Files:**

- Create: `packages/database/drizzle/per-firm/<timestamp>_seed-tools-email-inspector.sql`, `apps/worker/test/seed-tools-email-inspector.test.ts`
- Modify: `apps/worker/src/per-firm-migrations.ts`, `packages/database/drizzle/per-firm/meta/_journal.json`

- [ ] **Step 1: Read the precedent**

Read `packages/database/drizzle/per-firm/20260908T000000_baseline.sql` and `apps/worker/test/seed-tools-file-repair.test.ts` end to end. Mirror both. Note the migration-id convention is a monotonic UTC timestamp, not a sequential number.

- [ ] **Step 2: Write the failing seed guard**

Create `apps/worker/test/seed-tools-email-inspector.test.ts` as a copy of the file-repair guard, asserting `tools:emailInspector` is granted to each of the five default role identifiers.

Run: `pnpm --filter @magna-carta/worker test seed-tools-email-inspector`
Expected: FAIL — the permission is granted to no role.

- [ ] **Step 3: Write the migration**

Create `packages/database/drizzle/per-firm/<timestamp>_seed-tools-email-inspector.sql` with one `INSERT INTO role_permission` row per default role, exactly as the file-repair seed does. Use a fresh monotonic timestamp greater than every existing entry.

- [ ] **Step 4: Register it in both places**

`packages/database/drizzle/per-firm/meta/_journal.json` — add the entry with the matching tag.

`apps/worker/src/per-firm-migrations.ts` — add the import and the map entry (the map "fails loud when the journal gains a migration this map does not carry"):

```ts
import seedToolsEmailInspectorSql from "@magna-carta/database/drizzle/per-firm/<timestamp>_seed-tools-email-inspector.sql";
...
"<timestamp>_seed-tools-email-inspector": seedToolsEmailInspectorSql,
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @magna-carta/worker test`
Expected: PASS, including the new seed guard.

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/worker
git commit -m "feat(database): grant the Email Inspector permission to the default roles"
```

---

### Task 12: Documentation, spec reconciliation, and the full gate

**Files:**

- Modify: `docs/specs/2026-06-16-email-filing-design.md`, `docs/specs/2026-07-09-email-core-parse-engine-design.md`, `ROADMAP.md`
- Create: `changelog.d/email-core-parse-engine.md`, `status.d/` fragment

- [ ] **Step 1: Amend the capture design**

In `docs/specs/2026-06-16-email-filing-design.md`:

- §2 — replace the PostalMime assumption: the forward/CC Email Worker parses through `email-core`'s wasm edge.
- Header — its reserved **ADR-0104 / ADR-0105 / ADR-0106** were all subsequently assigned to unrelated decisions (the fragment convention, worktree coordination, and product-usage analytics). Strike the reservation and note the numbers are assigned at merge.

- [ ] **Step 2: Correct two claims in this slice's own design**

In `docs/specs/2026-07-09-email-core-parse-engine-design.md`:

- §2 dependency table — `cfb` is **not** a workspace pin. `crates/Cargo.toml` carries only `hayro`, `image`, `lopdf`; `decryption-core` pins `0.10` and `recovery-core` pins `0.14`. `email-core` takes no direct `cfb` dependency because `msg_parser` owns the CFB layer.
- §2 and §5 — the native container lane (`containers/email`) is **deferred**, not built here. A container is a separate deployable Worker plus a Durable Object class and a service binding, and nothing in this work consumes it. The crate stays pure, so the lane remains a compile target away. Record the flip condition: Discovery's bulk mbox parsing.

- [ ] **Step 3: Write the changelog fragment**

Create `changelog.d/email-core-parse-engine.md`. Never hand-edit `CHANGELOG.md` on a branch — it is assembled on `main`.

- [ ] **Step 4: Write the status fragment and the ROADMAP entry**

Edit only this slice's own `status.d/` fragment. Before touching `ROADMAP.md` (a cross-cutting file), run `vp run worktrees` to see what else is in flight, and sync `main` if it has drifted.

- [ ] **Step 5: Run the complete gate**

Run: `pnpm check`
Expected: green. This chains `vp check` (fmt/lint/typecheck), `vp run typecheck`, `node tooling/tsconfig-refs/index.mjs --check`, `svelte-check`, and `vp run rust-check` (`cargo fmt --check && cargo clippy -- -D warnings && cargo test`).

Run: `pnpm run lint:process-refs`
Expected: clean — no `ADR-NNNN`, no "spec", no "slice N" in any source, test, config, or OpenAPI `description`.

Run: `vp test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(email): reconcile the capture design with the parse core and defer the container lane"
```

---

## Self-Review

**Spec coverage.** §2 architecture → Tasks 1, 6. §2a PostalMime override → Task 12. §3 record → Task 1. §3a two-phase extraction → Task 5. §3b identifier provenance → Tasks 1, 4. §3c RTF gap → Task 4. §4 safety → Task 5. §5 Inspector → Tasks 8, 9. §6 verification → Tasks 2–5, 10 (`msg_parser` audit is Task 4 Step 1; build-and-boot does not apply now that the container is deferred). §7 doc deltas → Task 12.

**Two spec claims are corrected in Task 12** rather than silently ignored: the `cfb` "one workspace pin" line is false, and the container lane is deferred by the decision recorded above.

**Type consistency.** `ParsedMessage`, `PartDescriptor`, `MessageIdentifier`, `Address`, `Disposition`, `IntegrityFacts`, `SourceFormat`, `EmailError`, `ALLOWED_ERROR_CODES`, `Limits` are defined in Tasks 1 and 5 and used under those exact names in Tasks 2–7. Rust `snake_case` (`message_identifier`, `byte_range`, `extract_part`) crosses the edge as camelCase (`messageIdentifier`, `byteStart`/`byteEnd`, `extractPart`) — stated once in Task 6 Step 2 and honoured in Tasks 7 and 9.

**Known-unverified upstream signatures.** `mail-parser`'s `MessageParser::parse` return type and `msg_parser`'s field names are not asserted from memory: Task 2 Step 1 and Task 4 Step 1 make verifying them an explicit step, and the compiler arbitrates. The record shape is fixed; the upstream call sites are not.
