# mls-core (crates/mls-core) — CLAUDE.md

**Purpose.** The key agreement of an end-to-end encrypted meeting: one MLS group (RFC 9420) per
meeting, held in each participant's browser, whose per-epoch exporter secret is the SFrame base key
(RFC 9605, section 5.2). Compiles to `wasm32-unknown-unknown` (through
[`@magna-carta/mls`](../../packages/mls/CLAUDE.md)) and to a native `rlib` (tests). The design is
[`docs/specs/2026-11-09-meetings-end-to-end-encryption-design.md`](../../docs/specs/2026-11-09-meetings-end-to-end-encryption-design.md).

## Pure Rust, no native build

OpenMLS 0.9 over `openmls_rust_crypto` (RustCrypto). The AWS-LC and libcrux providers are never
used. `cargo tree -p mls-core -i cc`, for the host and for `--target wasm32-unknown-unknown`, finds
nothing; check it again before adding a dependency (golden rule 14). getrandom 0.3 needs a
configuration flag to pick its browser backend, set for this crate's wasm build alone in
`.cargo/config.toml`.

## What this crate decides, and what it leaves to the caller

- **It never decides who is in the meeting.** The room says who was let in and who left; the
  committer checks each key package's credential against the stay the room says sent it
  (`stage_add`, `identityMismatch`). A room that lied about both could seat its own key under a real
  stay's name, which is what the security code is for.
- **One committer, from the room's word on who is connected** (`is_committer`): the smallest live
  leaf. A departed committer cannot commit its own removal, so the next one down takes over.
- **A commit does not move the group until the room has sequenced it** (`confirm_commit`); a commit
  the room put second is discarded (`discard_commit`) and its caller restages what is still true.
- **Members propose only a pause.** An add, a removal or an application message from a member is
  refused in `process`: admissions and departures are the committer's, from the room's word.
- **A pause is a group context extension** (`PAUSE_EXTENSION_TYPE`, private-use range), one byte of
  reason bits. A context change replaces the whole list, so the required-capabilities extension is
  written with every pause and resume. A malformed pause body reads as paused for every reason,
  never as encrypted.
- **The security code** hashes the group id and every member's leaf, identity and signature key,
  length-prefixed. It changes when anybody joins or leaves and not when only the epoch moves.

## Keys

The signing key is made in `Session::new`, held in the module's memory for one stay, and never
stored or exported. It is not a WebCrypto non-extractable key: OpenMLS signs synchronously and a
WebCrypto key signs only asynchronously. What is never done instead is persist it. Errors are codes
(`MlsError::code`) and never carry a key, a credential or a message.

## Cost (experiment E4, 2026-11-10)

At 300 members in headless Chromium on a 4-core machine, an admission's commit took about 82 ms and
a removal's 74 ms; at a 4x CPU slowdown, 327 ms and 343 ms. The module built with this workspace's
release profile is about 500 KB gzipped, against a 1 MB budget.
