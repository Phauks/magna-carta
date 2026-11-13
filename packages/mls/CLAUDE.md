# @magna-carta/mls (packages/mls) — CLAUDE.md

**Purpose.** The browser side of an end-to-end encrypted meeting's keys: `MeetingGroupSession` over
the WebAssembly MLS engine in [`crates/mls-core`](../../crates/mls-core/CLAUDE.md), and `./sframe`,
the frame cipher (RFC 9605) on WebCrypto that the meeting's frame transform runs.

- **`./sframe` is security code.** A (key identifier, counter) pair is used once: the key identifier
  carries the sender's leaf, the epoch's low four bits and a stream number, and the counter restarts
  only under a new epoch. A frame that does not decrypt is dropped (`undefined`), never shown. A new
  epoch whose low bits match a held one removes it first.
- **The tests hold it to the RFC.** Every header vector in RFC 9605 appendix C.1 is in
  `test/sframe-header-vectors.json`, and the AES_128_GCM_SHA256_128 encryption vector from appendix
  C.3 is checked both ways.
- **`./sframe` needs no WebAssembly**, so the transform worker imports it alone; the MLS engine loads
  only when an encrypted meeting is joined.
- **The generated `src/pkg/` is git-ignored.** `pnpm exec vp run bootstrap` builds it; the Docker
  build in `crates/mls-core/wasm.Dockerfile` is the canonical one.
- **Errors are codes** (`MLS_ERROR_CODES`, `SframeError`), never key material or media.
- **The session test runs the real engine**, so the WebAssembly edge is held to what the crate's
  native tests hold it to.
