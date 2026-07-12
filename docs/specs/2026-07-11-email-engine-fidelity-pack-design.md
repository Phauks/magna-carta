# Email engine fidelity pack — design

> **Status:** draft, not yet Accepted or sliced. ADR fragment authored at merge under the fragment
> convention. Companion to the review ledger
> [`2026-07-11-email-engine-adversarial-review-findings.md`](2026-07-11-email-engine-adversarial-review-findings.md).

## 0. Why this exists

The parse engine (`crates/email-core`) is total and safe, but the adversarial review found it returns
**wrong or incomplete data for ordinary real-world mail** — not for hostile input. These are cheap to
fix now and expensive to fix later, because the email-filing record model
([`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md)) is about to freeze its
`email_message` columns (sent-at, dedup key, participants) around whatever the engine emits. A wrong
shape adopted into the schema is a migration to undo; a right shape costs one focused pass on the
engine while we are still in it. This slice closes the fidelity gaps and adds the two forward-looking
record fields the capture subsystem will otherwise retrofit.

## 1. Scope

**In:** engine-and-wasm-edge changes, plus the `@magna-carta/email` wrapper and the Email Inspector
projection. **Out:** the filing schema, capture routing, DKIM verification, RTF/HTML rendering, and the
`eml/msg→pdf` edges — all downstream, all tracked elsewhere. Parse-only boundary unchanged: still no
rendering, no crypto, no I/O.

## 2. The changes

Each item cites the finding it closes and the `file:line` it lands at.

### 2a. Decodable part bytes, one contract across lanes (closes C1)

`extract_part` on an `.eml` part returns the still-**encoded** span (base64/quoted-printable) with no
Content-Transfer-Encoding on the descriptor, while the `.msg` lane returns decoded bytes
(`eml.rs:265-277`, `lib.rs:100-107`). A caller cannot tell which it got. Fix: make `extract_part`'s
contract "the part's **decoded** bytes" for both lanes — decode the CTE for an `InputRange` part before
returning — and record the part's `content_transfer_encoding` on `PartDescriptor` so a caller that
wants the raw span can still ask. The decode honours `max_decoded_part_bytes` (the size check moves to
post-decode, still allocation-safe: quoted-printable and base64 both shrink, so the encoded-span bound
already caps the decode input).

### 2b. Charset-correct `.msg` string decode (closes C3)

`PT_STRING8` and `PidTagHtml` are decoded UTF-8-lossy today (`msg.rs:809-813,647`), mangling every
windows-1252 message with an accented character. Fix: read `PidTagInternetCodepage` (0x3FDE) /
`PidTagMessageCodepage` (0x3FFD), map the code page, and decode ANSI string and HTML-body bytes through
it, falling back to windows-1252 (the de-facto Outlook default) when absent rather than to lossy UTF-8.
Pure-Rust `encoding_rs` (already in the tree via other engines — confirm, else it is pure-Rust and
wasm-safe) covers the code pages; no C.

### 2c. Parsed instant alongside the raw date (closes C2, closes the design §3 gap)

`.msg` yields `date_raw: None` unless `PidTagMessageDeliveryTime` is present, dropping the date of
every Sent-Items/draft export that carries only `PidTagClientSubmitTime` (`msg.rs:210,305,337-353`).
And the original design promised "the date as both a parsed instant and the raw header string"; only
`date_raw` shipped. Fix: add `date: Option<i64>` (Unix seconds, UTC) to `ParsedMessage` beside
`date_raw`, populated by parsing the `.eml` `Date:` header and by converting the best-available `.msg`
FILETIME (delivery time, else submit-time, else a `Date:` recovered into `raw_headers`). The parsed
instant is the timeline-ordering and dedup key; `date_raw` stays the evidentiary verbatim.

### 2d. Full `In-Reply-To` list (closes C6)

`In-Reply-To` with multiple ids keeps only the last (`eml.rs:213`), breaking the thread join against
the dropped parent. Fix: parse it as the same angle-addr list `references` already uses; keep
`in_reply_to: Option<String>` as the first/primary for compatibility, or widen to a `Vec` — decide at
build against how the filing DAG keys threads.

### 2e. Embedded-message sub-parse (closes C7)

A `.msg`-in-`.msg` (forward-as-attachment) is parsed then discarded and is not extractable
(`msg.rs:508-523`) — yet the forwarded original is the evidentiary artifact the forward/CC capture path
files, and the message whose DKIM the verifier must check. Fix: add
`parse_embedded(bytes, descriptor) -> Result<ParsedMessage, EmailError>` that re-opens the container,
descends into the named sub-storage, and parses it as a message, plus its wasm-edge export. This is the
one item that is M-sized rather than S.

### 2f. Cross-lane dedup fingerprint (new record field)

The filing design needs a content-hash fallback when a Message-ID is stripped or rewritten across
mailbox imports. Rather than hash in the engine (keeps crypto out of the wasm artifact), the engine
emits a **canonical dedup basis**: a deterministic byte string of normalized headers + normalized body,
identical for the same logical message parsed from its `.eml` and its `.msg` form. The worker hashes it
with WebCrypto. Determinism across lanes is the hard requirement and the test target.

### 2g. Signed / encrypted classification (new record field)

`multipart/signed` parses as ordinary parts and `application/pkcs7-mime` yields an empty body with no
signal that content is **encrypted, not absent**. Add a `security: SecurityFraming` fact
(`None` / `Signed` / `Encrypted` / `OpaqueSigned`, plus which part carries the signature) — **evidence
capture, not verification or decryption**, matching the crate's verdict-free posture. Verification and
firm-key decryption stay downstream.

## 3. Companion robustness items (fold in if cheap)

- **Input cap (R1, `limits.rs:60`):** lower `max_input_bytes` from 128 MiB to a survivable ~24-32 MiB
  envelope, measured against the shipped `.wasm` isolate ceiling; add a whole-input guard to the mbox
  lane.
- **Fuzz coverage (R2):** add `fuzz_targets/lzfu.rs` and `fuzz_targets/extract_part.rs` — the two newest
  paths currently have no dedicated target.

## 4. Untrusted-input safety

Every change preserves the existing invariants: no `.unwrap()` / `.expect()` / slice-index on
input-derived data, every structural fault becomes a fixed `EmailError` code carrying no content, and
every new allocation is bounded by an existing cap (the decode in 2a, the code-page tables in 2b are
fixed-size, the embedded parse in 2e reuses the container node/depth caps). New paths get the same
truncation / bit-flip / byte-window totality tests the lanes already carry.

## 5. Verification

- Round-trip fixtures proving 2a returns `%PDF…` (decoded) from a base64 `.eml` attachment and the
  same bytes from the `.msg` equivalent.
- A cp1252 `.msg` fixture proving 2b yields `café`, not `caf�`.
- A submit-time-only `.msg` proving 2c populates `date`; an `.eml` proving the parsed instant matches
  the header.
- The **same logical message** authored as both `.eml` and `.msg`, proving 2f's dedup basis is
  byte-identical across lanes.
- The embedded-message fixture from C7 proving 2e extracts and re-parses the inner message.

## 6. What this unblocks

The filing record model can freeze `sent_at` on a real parsed instant, its dedup key on a lane-stable
fingerprint, and its participant/threading columns on complete data — and the forward/CC capture path
can file the embedded original with its own authenticity evidence intact.
