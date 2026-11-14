---
number: 499
slug: meetings-end-to-end-encryption-over-mls
status: Proposed
date: 2026-11-09
area: Communications layer
summary: "End-to-end encrypted meetings use MLS (RFC 9420) for group keys, through OpenMLS with its pure-Rust provider compiled to WebAssembly, and SFrame (RFC 9605) per frame over WebCrypto, so an encrypted meeting keeps the room's full 300 rather than the 50 sender keys would allow. The MeetingRoom Durable Object is the MLS delivery service and relays handshake messages without reading them. It is on by default. Cloud recording, live captions and dial-in each pause end-to-end encryption while they run: a host's act committed into the MLS group so the server cannot forge it, shown to everyone in a banner, recorded per pause, and resumed with fresh keys."
---

**End-to-end encrypted meetings agree keys over MLS, and server features pause encryption visibly rather than being refused.**

**Context:** The research of 2026-09-24 recommended sender keys with a ceiling of fifty, refusing recording and dial-in, and building only after both existed. On 2026-11-09 the owner directed that end-to-end encryption be built at full room size, keep recording, and allow dial-in with a warning.

**Decision:** MLS from the start (OpenMLS with `openmls_rust_crypto`; never the AWS-LC or OpenSSL providers). The room sequences handshake messages. Frames use SFrame with VP8, and encrypted H.264 is tried as an experiment. Cloud recording, live captions and a phone caller each pause encryption while present; the pause is a signed group-context change, every browser shows the reason, and resuming advances the epoch.

**Alternatives rejected:** Sender keys with a fifty-person ceiling, because one departure at three hundred is about 13 MB through one Durable Object. Refusing recording, captions and dial-in, because the owner requires all three. Recording in the host's browser, because the owner wants recordings in the cloud, reachable by others, and not lost when one computer fails. Zoom's model, which is app-only and disables polls, reactions and breakouts. Google Meet's client-side encryption, which requires the firm to run an external key service.

**Consequences:** One Rust crate compiled to WebAssembly, loaded only for an encrypted meeting. Four additive protocol frames. The record notes which stretches of a meeting were end-to-end encrypted. Design: [`docs/specs/2026-11-09-meetings-end-to-end-encryption-design.md`](../specs/2026-11-09-meetings-end-to-end-encryption-design.md).
