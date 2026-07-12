# Email parse engine — adversarial review findings ledger (2026-07-11)

Review of the email parse engine after the LZFu compressed-RTF decoder landed on `main`
(`crates/email-core`, `packages/email`, `apps/worker/src/routes/email-inspector.ts`). Ran the
7-angle adversarial review with empirical verifiers against a green 77-test baseline. This is the
**verification ledger** — point workers here, not at a prose snapshot. Each finding names a
`file:line` and a runnable verifier; re-run the verifier before fixing (some carry a scratch test
that was reverted after the review).

**Overall:** the engine is total (no panic, no unbounded allocation, no quadratic blowup found in
the Rust lanes), error hygiene is clean, output is deterministic, and the LZFu decoder is a faithful
MS-OXRTFCP implementation. The open items are **data-fidelity gaps on ordinary real-world mail**, one
**memory-envelope miscalibration at the wasm edge**, and follow-ups already folded into the fidelity
pack ([`2026-07-11-email-engine-fidelity-pack-design.md`](2026-07-11-email-engine-fidelity-pack-design.md)).

Legend: **status** is `open` unless noted. **verifier** describes how it was proven; a finding
without a passing/failing run is labelled `hypothesis`.

## Correctness & data fidelity

| # | Sev | Site | Defect | Verifier |
| - | --- | ---- | ------ | -------- |
| C1 | High | `eml.rs:265-277`, `lib.rs:100-107` | `.eml` `extract_part` returns the still-**encoded** part bytes (base64/quoted-printable span) and `size` is the encoded size; `PartDescriptor` carries no Content-Transfer-Encoding, so a caller cannot know to decode. The `.msg` lane returns **decoded** payloads — the two lanes disagree on what "the part's bytes" are. | Extract a base64 attachment from `with-attachment.eml`; observed `JVBERi0x…` (base64 text) rather than `%PDF`. |
| C2 | High | `msg.rs:210,305,337-353` | `.msg` yields `date_raw: None` unless `PidTagMessageDeliveryTime` is present; Sent-Items/draft exports carry only `PidTagClientSubmitTime` (0x0039). Also, a `Date:` in a recovered transport-header block lands in `raw_headers` but the derived date is dropped. | Build a `.msg` with submit-time but no delivery-time; observed `date_raw == None`. |
| C3 | High | `msg.rs:809-813,647` | ANSI (`PT_STRING8`) and `PidTagHtml` are decoded UTF-8-lossy; `PidTagInternetCodepage` / `PidTagMessageCodepage` is never read, so windows-1252 text is mangled (café → caf�) in subject and HTML body. Hits essentially every ANSI Outlook message with an accented character. | Build a `.msg` with a cp1252 subject byte 0xE9; observed replacement char in `subject`. |
| C4 | Medium | `mbox.rs:25-30` | Classic mbox false-split: a body line beginning `From ` starts a bogus new member, truncating the true body. Real unescaped mboxes hit this. | mbox fixture with a `From ` body line; observed an extra member and a truncated first body. |
| C5 | Medium | `mbox.rs:1-8` | `>From ` quoting is never reversed, so recovered bodies keep a `>` the sender never wrote — wrong body content for an evidence-grade engine. | Round-trip a `>From `-quoted body; observed the leading `>` retained. |
| C6 | Medium | `eml.rs:213` | `In-Reply-To` with multiple ids keeps only the last, breaking threading against the dropped parent. (`references` correctly uses the list form.) | Header with two message-ids in `In-Reply-To`; observed only the second in `in_reply_to`. |
| C7 | Medium | `msg.rs:508-523` | Embedded `.msg`-in-`.msg` (forward-as-attachment) is parsed then discarded and is **not extractable** — the descriptor's `MapiStream` locator names a storage, which the stream reader cannot materialize. Marked "a later slice" in code. | Build a `.msg` with an embedded message; observed a size-0, unextractable part. |
| C8 | Low | `eml.rs:206`, `msg.rs:318` | Remote-content detection misses single-quoted / unquoted `src`, `srcset`, and CSS `url()`. | HTML body `<img src=http://x/y>`; observed `references_remote_content == false`. |
| C9 | Low | `eml.rs` / `msg.rs` | `.eml` and `.msg` disagree on `Disposition` for a `cid:`-referenced inline image. | Same logical message in both formats; observed differing `disposition`. |
| C10 | Low | `eml.rs` | A message with bare-CR line endings collapses into a single header. | Bare-CR header block; observed one header row. |

**Verified correct** (do not re-litigate): quoted-printable soft breaks / latin-1, base64 with embedded
whitespace, RFC 2047 B/Q encoded-words split across a fold, unknown-charset fallback, address groups /
quoted local parts, nested multipart with preamble/epilogue, multiple `Received` / `DKIM-Signature` /
`Authentication-Results` captured in order, and the recent mbox absolute-offset fix (complete).

## Robustness & the wasm edge

| # | Sev | Site | Defect | Verifier |
| - | --- | ---- | ------ | -------- |
| R1 | Medium-High | `limits.rs:60` | `max_input_bytes` (128 MiB) far exceeds what the isolate survives: a 48 MiB input drives the wasm heap to ~169 MiB and the 128 MiB isolate is OOM-killed at under a third of the declared cap. `WebAssembly.Memory` never shrinks, so one oversized message pins isolate memory high for later requests. The mbox lane has no whole-input cap by design and is worse-exposed. | Measured against the shipped `.wasm`: 48 MiB in → ~169 MiB heap → OOM. Suggest a ~24-32 MiB survivable cap. |
| R2 | Medium | `packages/email/src/index.ts:9,17-22` | A single wasm instance is reused across requests with no panic recovery (`panic=abort`); a latent panic would poison the instance for all later requests on that isolate. The two newest paths (`lzfu`, `extract_part`) have no dedicated fuzz target. | Both new paths survived 153 + 23 property inputs cleanly (engine is total; no panic could be forced), but coverage is by-hand. Add `fuzz_targets/lzfu.rs` + `extract_part.rs`. |
| R3 | Low | `msg.rs` (open path) | `cfb::open()` (~30 ms/MiB) runs fully before the node/depth caps fire — linear, not a blowup, but front-loaded. | Timing scan; linear in input size. |

**Verified working:** the LZFu decode path is present in the built artifact (not dead-stripped); memory
is freed per call; output is deterministic (no HashMap-order / clock / locale dependence); errors carry
a stable static code and never surface `cfb` / `mail-parser` text or message content.

## LZFu decoder (MS-OXRTFCP)

Faithful implementation — 207-byte init dictionary byte-exact, 4096-byte ring wraparound and
self-referential copy correct, both `LZFu` and `MELA` magics handled, and RAWSIZE never sizes an
allocation (output is bounded by the 64 MiB decode cap, not by the declared field). Two deliberate
deviations and one doc bug:

- **L1 (low, behaviour):** a truncated **compressed** stream returns `Ok(partial)` where the spec says
  treat-as-corrupt. Defensible leniency, but it contradicts the module's own "every fault → error"
  doc — reconcile the doc or the behaviour.
- **L2 (low, documented):** CRC is never validated — deliberate, and documented.
- **Staged, uncommitted (2026-07-11):** a working-tree change to `lzfu.rs` (not yet committed) makes an
  **over-cap** body — both the stored-uncompressed and the compressed path — return `LimitExceeded`
  rather than truncating or mislabelling it `Malformed`, so "we refused this" stays distinct from "this
  was corrupt." Sensible and aligned with this review; review and commit or revert deliberately. Note it
  is distinct from L1, which is about a **truncated** (short) compressed stream and remains open.
- **L3 (doc, fixed 2026-07-11):** `model.rs` claimed `rtf_body` is present only "with no plain-text
  alternative"; it is actually unconditional on a decodable `PidTagRtfCompressed`. Comment corrected.
- **L4 (scope note):** RTF-encapsulated-HTML (`\fromhtml`, MS-OXRTFEX) is unhandled and unmentioned —
  belongs to the render/normalize slice, not the parse engine.

## Documentation drift (fixed 2026-07-11)

- ROADMAP row, `status.d` fragment, and the changelog fragment all said the LZFu decoder was
  *deferred* and the engine was *"on branch"*; both are merged to `main` (undeployed — production is the
  `release` branch). Corrected.
- The two changelog fragments contradicted each other on the RTF body; the stale caveat was removed.
- The changelog overstated the Email Inspector as accepting mbox — the route parses single messages
  (`.eml` / `.msg`) only. Corrected.
- The implementation plan is written around `msg_parser` with `cfb` as a rejected "fallback" (inverted
  from as-built), plus `ALLOWED_ERROR_CODES` → `EMAIL_ERROR_CODES`, `byteStart/byteEnd` → typed
  `PartLocator`, and `unsupported → 415` → 422. An as-built correction banner was added rather than
  rewriting the historical plan.
- The design spec §3 envelope drifted (`message_id`, a parsed date instant, `sender`/`reply_to`, an
  engine-version field — none shipped). A correction note was added.

## Recommended sequencing

1. **Fidelity pack** — C1, C2, C3, C6, plus the parsed-date and dedup-fingerprint additions. Small,
   pure, testable; the filing schema will otherwise freeze around the wrong shapes. See the fidelity
   pack design.
2. **Robustness** — R1 (lower the input cap to a survivable envelope) and R2 (fuzz targets for `lzfu`
   and `extract_part`) can ride the fidelity pack.
3. **Render & normalize** — L4, C8, and the still-open `eml/msg→pdf` conversion edges.
