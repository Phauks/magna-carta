---
slug: meetings-end-to-end-encryption-over-mls
status: Proposed
area: Communications layer
date: 2026-11-09
summary: "End-to-end encrypted meetings use MLS (RFC 9420) for group keys, through OpenMLS with its pure-Rust provider compiled to WebAssembly, and SFrame (RFC 9605) per frame over WebCrypto, so an encrypted meeting keeps the room's full 300 rather than the 50 sender keys would allow. The MeetingRoom Durable Object is the MLS delivery service and relays handshake messages without reading them. Recording is kept by recording in the host's browser and filing through the untrusted-file pipeline; dial-in is kept with a persistent banner that a phone caller ends end-to-end encryption while connected. Live captions, webinars and live streaming are not offered while it is on."
---

**End-to-end encrypted meetings agree keys over MLS and keep recording and dial-in.**

**Context:** The research of 2026-09-24 recommended sender keys with a ceiling of fifty, refusing recording and dial-in, and building only after both existed. On 2026-11-09 the owner directed that end-to-end encryption be built at full room size, keep recording, and allow dial-in with a warning.

**Decision:** MLS from the start (OpenMLS with `openmls_rust_crypto`; never the AWS-LC or OpenSSL providers). The room sequences handshake messages. Frames use SFrame with VP8, and encrypted H.264 is tried as an experiment. An encrypted meeting is recorded in the recording host's browser. The dial-in bridge joins the group as a labelled member while any phone caller is present, and everyone sees a banner.

**Alternatives rejected:** Sender keys with a fifty-person ceiling, because one departure at three hundred is about 13 MB through one Durable Object. Refusing recording, because the owner requires it. Refusing dial-in, because the owner accepted the trade with notice. Zoom's model, which is app-only and disables polls, reactions and breakouts. Google Meet's client-side encryption, which requires the firm to run an external key service.

**Consequences:** One Rust crate compiled to WebAssembly, loaded only for an encrypted meeting. Four additive protocol frames. A recording of an encrypted meeting is the firm's own readable copy, as every other recording is. Design: [`docs/specs/2026-11-09-meetings-end-to-end-encryption-design.md`](../../specs/2026-11-09-meetings-end-to-end-encryption-design.md).
