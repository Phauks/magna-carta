# End-to-end encryption for meetings — what it would take, and what it would cost

**Read on 2026-09-24.** Every outside fact carries its source and the date it was read (section 14). Anything no source states is marked **unconfirmed** and is treated as unknown, never as a working assumption.

**Why this exists.** The ledger node `meetings.end-to-end-encryption` in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md) is `not-started`, scoped "media the routing service cannot read — keys agreed between browsers, frames encrypted before they leave", with the evidence that media is encrypted hop by hop today (DTLS-SRTP to and from the routing service) and that "recording and transcription cannot coexist with it". The recording design already names the trade ([`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../specs/2026-09-20-meetings-recording-and-transcription-design.md), _What is deliberately not here_), and the dial-in design refuses a caller for the same reason ([`docs/specs/2026-09-24-meetings-dial-in-design.md`](../specs/2026-09-24-meetings-dial-in-design.md)). This note records whether the routing service would carry encrypted media at all, what the key agreement would be, what it would switch off, and what the owner is being asked to decide.

**What the meeting is today** ([`docs/specs/2026-09-18-meetings-design.md`](../specs/2026-09-18-meetings-design.md)): each browser holds one peer connection to the Cloudflare Realtime SFU; the SFU forwards Opus audio and simulcast camera video (rids `f`, `h`, `q`) and screen share; the `MeetingRoom` Durable Object brokers sessions over a WebSocket and relays roster, presence and chat; the media never crosses a Worker. DTLS-SRTP protects each hop, so the SFU — Cloudflare's media plane — decrypts every packet and could read every frame.

## 1. The headline answers

| Question                                                       | Answer                                                                                                                                                                                                                                                          | Section |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Does the Realtime SFU forward frames encrypted in the browser? | **Yes, as evidenced by Cloudflare's own product on the same SFU** — Orange Me2eets encrypts frames with the encoded-streams API and "no SFU modifications" were needed.                                                                                         | 3       |
| Does simulcast layer switching survive?                        | **Unconfirmed.** It survives only if the SFU can still find keyframes; Orange Me2eets leaves the codec's leading bytes in the clear for exactly that kind of reader, and Cloudflare's simulcast page is silent. An experiment settles it.                       | 3.2     |
| What stops working?                                            | Every feature that reads media on a server: recording, transcription, live captions, the summary, dial-in, anything on the WebSocket adapter. Browser-side effects keep working.                                                                                | 4       |
| What frame format?                                             | **SFrame (RFC 9605)**, suite `AES_128_GCM_SHA256_128`, per frame, with the codec's leading bytes authenticated but not encrypted.                                                                                                                               | 5       |
| How are keys agreed?                                           | **Sender keys over the room, in envelopes only the recipient can open**, for rooms up to a ceiling; **MLS** is the answer above it, and is heavy.                                                                                                               | 6       |
| Does our own Worker see the keys?                              | **No, if the browser encrypts every key it sends to each peer's public key** — the room then relays ciphertext. It still sees who, when, how much, and the public keys, and an active room could substitute a public key unless people compare a security code. | 2, 6.4  |
| Is any C or C++ needed?                                        | **No.** WebCrypto covers AES-GCM, HKDF, HMAC, ECDH and X25519 in the browser. If MLS is ever built, OpenMLS or mls-rs in Rust compiled to WebAssembly, with a pure-Rust or WebCrypto provider — never the AWS-LC or OpenSSL providers.                          | 8       |
| Do the browsers support it?                                    | **Yes, all three engines,** since Chrome 141 aligned with the standard `RTCRtpScriptTransform` that Safari (2022) and Firefox (117, 2023) already shipped; older Chrome has the 2020 encoded-streams API.                                                       | 9       |
| Recommendation                                                 | **Build it as an opt-in per meeting — the shape Zoom ships — after recording and dial-in exist, capped at fifty participants on sender keys**, with MLS a later slice for larger rooms.                                                                         | 12      |

## 2. What "end to end" can honestly mean here

Encryption is only as meaningful as the list of parties it keeps out, and this platform is several parties at once. The claim has to be written against each of them.

| Party                                                                                     | Today                                         | With end-to-end encryption                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cloudflare's media plane (the SFU)**                                                    | Decrypts every packet at each hop.            | **Sees ciphertext frames.** Still sees RTP headers, header extensions, sizes, timing, the SFrame key identifier and counter.                                                                                                   |
| **Our signaling room (`MeetingRoom`, our Worker)**                                        | Never sees media, but brokers every session.  | **Relays key envelopes it cannot open,** if keys are only ever sent encrypted to a peer's public key. Sees the public keys, who is present, when, and how much.                                                                |
| **An active, malicious room** — a compromised Worker, or an insider changing it           | Could subscribe itself to any track.          | **Could substitute a public key and sit in the middle,** unless participants compare a security code out of band (section 6.4). End-to-end encryption without verification protects against a passive room, not an active one. |
| **Whoever serves the JavaScript** — the same Worker and Cloudflare's static-asset hosting | —                                             | **Can ship code that leaks the keys.** The encryption runs in code this platform serves on every load. Nothing in a web page defends against its own server; section 7.                                                        |
| **Our storage and our logs**                                                              | Hold no media.                                | Hold no media and no keys.                                                                                                                                                                                                     |
| **A participant who was removed or denied**                                               | Loses access when the subscription is closed. | **Loses access cryptographically** once the remaining senders rotate their keys (section 6.2).                                                                                                                                 |
| **The other people in the meeting**                                                       | Hear and see everything.                      | Hear and see everything. End-to-end encryption is not access control between participants.                                                                                                                                     |

**What it does not cover, and the screen must not imply it does:**

- **Chat.** In-meeting chat is on the record by the owner's 2026-09-20 ruling — the route stores it in the firm's database — so it is not end-to-end encrypted and cannot be without undoing that ruling.
- **Metadata.** The roster, display names, speaking and muted presence, hands, reactions, attendance and the meeting record are signaling the room holds and the firm's record keeps. The SFU also sees the RTP audio-level header extension, so it can tell who is talking without reading a frame.
- **The telephone.** A dial-in caller's audio cannot be end-to-end encrypted to a browser, which is why dial-in is refused (section 4).

The honest sentence for the product is therefore: **"The audio and video of this meeting are encrypted in each participant's browser with keys the meeting's servers never hold."** Not "nobody but the participants can access this meeting", which section 7 shows is untrue for any web application.

## 3. Does the routing service forward encrypted frames?

### 3.1 What an SFU has to read

A selective forwarding unit forwards packets without decoding them, but it is not blind to their contents:

- **RTP headers and header extensions** — payload type, sequence number, timestamp, SSRC, `mid`, `rid`, transport-wide congestion control, absolute send time, audio level, and for scalable codecs the dependency descriptor. None of this is inside the frame an encoded transform touches, so all of it survives encryption.
- **The codec's payload header,** for keyframe detection. Switching a subscriber from one simulcast layer to another can only happen at a keyframe of the new layer, and for VP8 whether a frame is a keyframe is a bit in the first byte of the frame itself — inside what an encoded transform encrypts. H.264 is worse: its packetizer parses NAL unit structure, and encrypted bytes can emulate a start code and split a frame in the wrong place.
- **Nothing else.** Forwarding, congestion control and the per-subscriber layer choice are header facts.

### 3.2 The evidence on Cloudflare's SFU

**Cloudflare built and shipped exactly this on the Realtime SFU.** Orange Me2eets (blog, 2025-06-26) intercepts frames with the encoded-streams API, encrypts them in a web worker running Rust compiled to WebAssembly, and states that the SFU needed no modification and forwards encrypted frames as opaque data. It does not use SFrame; it wraps frames with its MLS library's message API. And for VP8 it **leaves the first bytes unencrypted — ten on a keyframe, one otherwise** — so the frame's own header stays readable.

**What is not established:**

- **Simulcast.** Cloudflare's simulcast page documents layer selection by `preferredRid`, `priorityOrdering` and `ridNotAvailable` and says nothing about keyframes, codecs or encrypted payloads; the Orange Me2eets post does not discuss simulcast. Whether the SFU finds keyframes by reading the VP8 payload header (in which case the clear prefix is what keeps switching working) or by some other means (a keyframe request and a timer) is **unconfirmed**.
- **H.264.** Unaddressed anywhere read. Given the packetizer problem, an encrypted meeting should negotiate **VP8 only**, which every engine supports, at the cost of Safari's hardware H.264.

**Experiment E1**, before anything is built: two browsers on the real SFU, simulcast VP8 with the section 5 transform, a third subscriber switching `f` → `h` → `q` → `f` through the existing `layer` frame, and a check that every switch lands within a keyframe interval with no decode errors. Then the same with the clear prefix removed, to learn whether the SFU needed it. **Experiment E2:** Opus with the whole frame encrypted, confirming audio needs no clear prefix (Opus packetization is one frame per packet and reads nothing inside it).

## 4. What stops working

Everything that reads media on a server. Each needs a refusal where it starts, not a failure where it runs — a recording that starts and files an hour of noise is worse than one that says no.

| Feature                                                                             | Why it breaks                                                                                                                                                                                  | Where it is refused                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Recording**                                                                       | The recorder takes PCM from the WebSocket adapter, which decodes Opus on Cloudflare's side; an encrypted frame does not decode.                                                                | The recording start route, before any adapter is created.   |
| **Transcript**                                                                      | Derived from the recording's per-track PCM.                                                                                                                                                    | Nothing to derive from.                                     |
| **Live captions**                                                                   | Same adapter, same PCM.                                                                                                                                                                        | The captions switch and its route.                          |
| **Meeting summary**                                                                 | Written from the transcript.                                                                                                                                                                   | Nothing to summarize.                                       |
| **Dial-in**                                                                         | The bridge must read the room's audio to mix it and must write plaintext audio into a room whose browsers expect ciphertext.                                                                   | The telephony lane refuses the call; no PIN is minted.      |
| **Anything on the WebSocket adapter**                                               | The adapter is a decoder: Opus to PCM, video to JPEG.                                                                                                                                          | The routing-service client, as a guard on adapter creation. |
| **The one-frame-a-second visual record** the recording design mentions as an option | JPEG egress from the adapter.                                                                                                                                                                  | Same guard.                                                 |
| **Live streaming and webinars through a streaming product** (not started)           | Transcoding for broadcast reads frames.                                                                                                                                                        | When designed.                                              |
| **Server-side effects**                                                             | None exist — the media-effects design keeps noise suppression and background blur in the browser on the local track before publishing, so they run **before** encryption and **keep working**. | —                                                           |

**What keeps working:** the subscription policy, speaking presence (measured in each browser on its own microphone), host mute (closing a track at the routing service is forwarding control, not payload), spotlight, hands and reactions, roster deltas, connection diagnostics (`getStats`), guests (a guest is a browser), audio calls, screen share (another video track through the same transform), and simulcast subject to E1.

## 5. The frame format — SFrame

### 5.1 Why SFrame rather than something of our own

RFC 9605 (August 2024) defines exactly this: authenticated encryption of whole media frames for a conference where "central media servers" handle the packets. Orange Me2eets built its own wrapping; a standard format is the better choice for a record that may one day be read by somebody else's tooling, and it costs nothing extra, because every primitive it needs is in WebCrypto.

- **Suite `AES_128_GCM_SHA256_128` (identifier `0x0004`).** One AES-GCM call per frame in WebCrypto, a 128-bit tag. The CTR-and-HMAC suites (`0x0001`–`0x0003`) have shorter tags and need two calls per frame; the saving — six to twelve bytes a frame — is not worth a second operation in the one place the browser does crypto at media rate.
- **Keys** derive from a sender's `base_key` by HKDF with the RFC's two labels (the "SFrame 1.0 Secret key" and "SFrame 1.0 Secret salt" strings, with the key identifier encoded as eight big-endian bytes; the exact byte strings are taken from the RFC and its test vectors at build, not from this note); the nonce is the salt combined with the frame counter.
- **The header** carries the key identifier (KID) and the counter (CTR), **in the clear**: the RFC states KID values "are thus visible to any application-layer intermediaries". The SFU learns which key a frame used and how many frames a sender has sent, which it could count anyway.
- **"A given `base_key` MUST NOT be used for encryption by multiple senders."** Two browsers holding one key would reuse nonces. So every sender has its own base key, which is what the sender-key scheme is, and why a shared per-meeting key is ruled out.

### 5.2 The clear prefix

The codec bytes an SFU or a packetizer must read stay unencrypted **and authenticated**: RFC 9605's encryption takes application metadata into the additional authenticated data beside the header, so the prefix is carried in the clear and bound into the tag, and a tampered prefix fails decryption. VP8: ten bytes on a keyframe (the three-byte frame tag, the start code and the dimensions), and on a delta frame either the one byte Orange Me2eets keeps or the whole three-byte frame tag — E1 decides. Opus: none, pending E2.

### 5.3 Where it runs

In an `RTCRtpScriptTransform` worker, one transform per sender and per receiver, doing: parse or write the SFrame header, look up the `CryptoKey` for the KID (derived once, non-extractable, and passed to the worker by `postMessage`, which carries a `CryptoKey` without exposing its bytes), `crypto.subtle.encrypt` or `decrypt`, enqueue. The standard also defines a native `SFrameTransform` that would do this inside the browser; Safari has something close and Firefox has an open bug for it, so it is not cross-browser and is not relied on.

**A frame that does not decrypt is dropped, never rendered.** In an encrypted meeting a receiver also refuses a frame with no SFrame header at all, because the server cannot check that a sender encrypted — a modified client could publish plaintext, and the only place that can notice is the receiver. The tile says "Not encrypted — not shown" rather than playing it.

## 6. Key agreement

### 6.1 The two candidates

**MLS (RFC 9420)** is the standard answer: continuous group key agreement over a ratchet tree, a removal or an update costing a message of size logarithmic in the group, forward secrecy and post-compromise security, and an exporter from which SFrame's base keys derive (the RFC describes that binding). It is what Orange Me2eets uses, through OpenMLS compiled to WebAssembly, with a "designated committer" algorithm — the live member with the smallest index commits — that Cloudflare model-checked in TLA+ up to five members. It is heavy: a Rust library of real size in the bundle, a delivery service that has to order handshake messages, and a group state every client keeps in step.

**Sender keys** are the simpler answer and what this note proposes first: each sender makes its own base key and sends it to each other participant, encrypted to that participant alone. It is RFC 9605's own "sender keys" arrangement, with a key identifier encoding the generation and the ratchet step.

### 6.2 The sender-key design

- **Each browser, on admission, makes an ephemeral key-agreement pair** with WebCrypto — ECDH on P-256, or X25519 now that all three engines ship it — whose private half is non-extractable and never leaves the browser, and announces the public half in a new client frame. The room keeps it on the participant record (transient signaling state, deleted with the room) and carries it on the roster so every browser has every peer's public key.
- **Each sender makes a random 128-bit base key per generation.** The KID packs a small per-stay sender index the room assigns and the generation, so no two senders share a KID and no base key is ever shared.
- **Each sender sends its base key to each other participant in an envelope:** ECDH between the sender's private key and the recipient's public key, HKDF over the shared secret with the meeting, the two participant handles and the KID bound into the info string, then AES-GCM over the base key with the same binding as additional data. It is the shape HPKE (RFC 9180) standardizes and can be HPKE exactly; either way every step is WebCrypto.
- **The room relays each envelope to its one recipient's socket and stores nothing about it.** It is a new pair of frames, a batched `key-envelopes` from a sender and a single `key-envelope` to each recipient, because the room's per-socket budget — `FRAME_BUDGET_PER_SECOND = 20`, `FRAME_BUDGET_BURST = 40` — would refuse forty-nine separate frames after one departure from a room of fifty. At most sixty-four envelopes a frame, on the precedent of the protocol's other array ceilings.
- **Someone joins:** each sender ratchets its key forward one step (HKDF from the current key, which the KID's ratchet field tells receivers to follow) and sends the new key to the newcomer only. The newcomer cannot derive keys for anything sent before it arrived. Cost: two envelopes per existing participant.
- **Someone leaves, is removed or is denied:** every remaining sender makes a new base key and sends it to every other remaining participant. The departed browser holds only keys that no longer encrypt anything. **This is the event end-to-end encryption exists for, and it is the expensive one.**
- **A waiting socket receives no keys.** It is never welcomed, so it is never on a roster that carries public keys, and no envelope is addressed to it until a host admits it.

### 6.3 What it costs at size, and why there is a ceiling

After one departure from a room of N, the N − 1 remaining senders each send N − 2 envelopes. An envelope is about 150 bytes on the wire (a twelve-byte IV, the sixteen-byte key, a sixteen-byte tag, the KID and two handles, base64 in JSON).

| Room | Envelopes per departure | Through the room in one burst |
| ---- | ----------------------- | ----------------------------- |
| 10   | 72                      | ~11 KB                        |
| 50   | 2,352                   | ~350 KB                       |
| 300  | 89,102                  | ~13 MB                        |

Fifty is comfortable; three hundred is a thirteen-megabyte burst through one Durable Object every time anybody's network drops, in the rooms where networks drop most. **So sender keys carry a ceiling, `MAX_END_TO_END_ENCRYPTED_PARTICIPANTS = 50`, below the room's three hundred**, and an encrypted meeting refuses the fifty-first admission with a reason the host can read. MLS removes the ceiling: a removal is one commit of about log₂(300) ≈ 9 path secrets, relayed as one message per socket.

MLS also changes the room's job in a way worth noting: MLS needs a delivery service that puts handshake messages in one order, and a Durable Object is single-threaded — the room is already a natural sequencer, so the MLS path does not need a new component, only a new frame.

### 6.4 Who is on the other end — the security code

The room delivers the public keys, so a room that lies can hand every browser a key it holds and decrypt everything in the middle. No key-agreement scheme fixes that on its own; somebody has to check. The check is a **security code**: each browser hashes the sorted list of (participant handle, public key) and shows a short string of digit groups; participants who read theirs aloud and match know that nobody sits between them. Orange Me2eets calls it a safety number and says the same thing about it — verification in the meeting itself is "insecure against deepfakes", so the code means most when compared over another channel.

The code changes whenever anybody joins or leaves, because the keys are ephemeral. That makes it a tool for a small, deliberate meeting and not for a three-hundred-person briefing, which is another reason for the ceiling. Long-term per-device identity keys, remembered on first use, would make the code stable across meetings; they need a device-key registry and are not proposed.

## 7. The code that does the encrypting is ours

Every line of the transform and the key agreement is JavaScript this platform serves, from the same Worker and the same Cloudflare static hosting whose reach the encryption is meant to exclude. A compromised deployment, or an insider with deploy rights, can ship a page that sends the keys home, and no browser will notice. This is not a flaw in the design; it is the limit of end-to-end encryption in any web application, and Cloudflare's post names it ("JavaScript cryptography") and mentions a code-consistency mechanism under development.

What narrows it: the desktop shell ships signed builds, so a change to its code is a release rather than a deploy (a stronger assurance, not a feature — parity holds, because the web and desktop clients do the same thing); a subresource-integrity or manifest-consistency scheme for the web client, when one is standard; and the rule that the transform's code is small, isolated in one worker file, and reviewed as security code. What it cannot be made into is a claim that the operator of the service cannot read a meeting.

## 8. Memory safety

**Nothing here needs C or C++.** Every primitive is in WebCrypto, which is the browser's own: AES-GCM (and AES-CTR and HMAC for the other suites), HKDF, ECDH on P-256, and X25519, which shipped across Chromium, WebKit and Gecko during 2025 (Chrome 137 was the last). The transform, the SFrame header, the envelope construction and the security code are TypeScript.

**If MLS is built,** it is a Rust library compiled to WebAssembly, on the precedent `packages/pdf`, `decryption`, `email` and `seven-zip` already set. Two candidates, both memory-safe, **provided the cryptography provider is chosen with the same care:**

- **OpenMLS** with `openmls_rust_crypto` (pure Rust). What Cloudflare used.
- **mls-rs** with `mls-rs-crypto-webcrypto`, which delegates to the browser's own WebCrypto — the smallest bundle and no second cryptography implementation in the page. **Not** `mls-rs-crypto-awslc` or the OpenSSL provider: both are C, and choosing one would need the owner's consent under golden rule 14 for no benefit in a browser.

## 9. Browser support

| Engine      | Encoded transform                                            | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Safari**  | `RTCRtpScriptTransform` since 2022                           | Something close to a native SFrame transform, not standardized.                                                                                                                                                                                                                                                                                        |
| **Firefox** | `RTCRtpScriptTransform` since 117 (2023)                     | Native `SFrameTransform` is an open bug.                                                                                                                                                                                                                                                                                                               |
| **Chrome**  | `RTCRtpScriptTransform` since 141, aligned with the standard | Chrome 141 **does not cover `generateKeyFrame`**, still under discussion; a receiver that needs a keyframe after a rotation relies on the SFU's ordinary keyframe request instead. Chrome before 141 has the 2020 encoded-streams API (`createEncodedStreams`), which Orange Me2eets uses; supporting it is a small adapter behind the same transform. |

**The desktop shell** has to be checked rather than assumed: WebView2 on Windows is Chromium, the macOS web view is WebKit, and WebKitGTK on Linux has limited WebRTC. A desktop client that cannot run the transform cannot join an encrypted meeting, which is a parity question before it is anything else.

## 10. What it costs

**Features:** the whole of section 4 — recording, transcript, captions, summary and dial-in, for that meeting. Zoom's end-to-end mode makes the same trade: its own announcement lists cloud recording, live transcription and telephone dial-in among what is unavailable while it is on, because each needs Zoom's servers to read the media.

**In the browser:** one AES-GCM call per frame, in a worker. A browser in a large encrypted room pulling sixteen video tiles at 30 frames a second and twenty-four audio streams at 50, while publishing three simulcast layers and audio, is doing roughly 1,800 operations a second — small for AES-GCM, but each is an asynchronous call, and the per-promise overhead is what to measure rather than guess.

**On the wire:** the SFrame header (a few bytes) and a sixteen-byte tag per frame. Negligible on video; on audio, about twenty bytes at fifty frames a second is roughly 8 kbps on an Opus stream of about 32 kbps — a quarter more audio bandwidth.

**On Cloudflare:** nothing new. The envelopes are signaling frames; the media is the same size to within the overhead above.

**In the record:** one column, `meeting.media_protection` — `'transport' | 'end-to-end'`, NOT NULL DEFAULT `'transport'` (CHECK), additive — chosen at Start or in the event form and never changed afterwards, on the reasoning the medium already carries: the people in the room agreed to one thing. `MeetingSummary` carries it. A firm setting, `meetings.endToEndEncryptionAllowed`, default **off**, because a firm with a duty to keep a record of what was said may reasonably forbid a meeting nobody can record.

**In engineering:** the transform worker and its SFrame implementation, the key-agreement module, four frames in `@magna-carta/meeting-protocol` (the public key, the batched envelopes out, the envelope in, and the rotation signal), the room's relay, the ceiling, the refusals on the recording, captions, dial-in and adapter paths, the security-code surface, and the column. No new service, no container, no binding.

## 11. What a build would touch

Listed so the size is visible, not as a plan:

- `packages/meeting-protocol/src/frames.ts`, `src/types.ts` — the key frames; the public key on `RosterParticipant`; `mediaProtection` on the wire.
- `packages/database/src/per-firm-schema.ts` + one additive migration; `packages/meetings/src/types.ts`, `validation.ts`, `meeting-service.ts`, `settings.ts` — the column, the ceiling, the setting, `meeting-end-to-end-encrypted` as a refusal.
- `apps/api-worker/src/meetings/room/room-keys.ts` (**new**; the relay and the sender index), `room-frames.ts`, `room-roster.ts`; `apps/api-worker/src/meetings/sfu/sfu-client.ts` — the guard on adapter creation.
- `apps/api-worker/src/routes/meetings.ts` (the choice at Start), and the recording, captions and dial-in routes' refusals.
- `apps/web/src/lib/meetings/client/frame-encryption.worker.ts`, `client/sframe.ts`, `client/key-agreement.ts`, `client/security-code.ts` (**new**); `client/negotiation.ts` (the transform attached to every sender and receiver; VP8 pinned); `screen/meeting-security-code.svelte` (**new**); `meeting-entry-action.svelte` (the choice at Start).
- Tests: SFrame against the RFC's test vectors; the envelope round trip and the refusal of an envelope addressed to somebody else; rotation on departure and ratchet on arrival; a receiver dropping an unencrypted frame; the room relaying to exactly one socket and storing nothing; the recording, captions, dial-in and adapter refusals; the fifty-first admission refused.

## 12. Recommendation

**Build it as an opt-in per meeting, and not yet.**

- **Opt-in, chosen at Start and never changed,** so the meetings a firm must be able to record are recordable and the ones it chooses to protect are protected — the shape Zoom ships, and for the same reason. A firm setting decides whether the choice is offered at all.
- **Refusing recording, transcription, captions, the summary, dial-in and every adapter** for that meeting, at the routes where each starts, with the reason on the screen.
- **Sender keys, SFrame over WebCrypto, VP8 only, fifty participants at most,** and a security code on screen. No new dependency of any kind.
- **After** the recording slice's first half and dial-in's door have landed, so the refusals this adds land on routes that exist, and **after experiments E1 and E2** answer the simulcast and clear-prefix questions on the real SFU.
- **MLS** — OpenMLS or mls-rs, compiled to WebAssembly with a memory-safe provider — as a later slice if a firm needs encrypted meetings above fifty.
- **The claim is the sentence in section 2**, and the user guide says plainly what it does not cover: chat, who attended, and the application's own code.

Deferring outright is the alternative, and it is reasonable: a firm meeting on its own practice-management platform may not value protection from the platform's operator as much as it values the recording it gives up. That is the owner's call, and it is question O1 below.

## 13. Owner questions

- **O1 — Build it as an opt-in, or defer?** Recommended: build as an opt-in, sequenced after recording and dial-in, on the terms in section 12.
- **O2 — May a firm forbid it?** Recommended: yes, and off by default — `meetings.endToEndEncryptionAllowed` — because a firm's duty to keep a record of what was said can outweigh a meeting's privacy from the platform.
- **O3 — Fifty participants on sender keys, with MLS only if a firm asks?** Or MLS from the start, which removes the ceiling and adds a Rust library and a group-state machine to every encrypted meeting.
- **O4 — Is the claim in section 2 acceptable?** It protects against the routing service and against a passive signaling room; it does not protect against a malicious deployment of the application, and no web application's can.
- **O5 — Is the security code shown, or required?** Shown is the Orange Me2eets posture; required (nobody's media plays until codes are compared) is stronger and much less usable.
- **O6 — Is VP8 only acceptable for an encrypted meeting?** It costs Safari's hardware H.264 and some battery on Apple devices, and it is what keeps the packetizer and the SFU able to read what they must.

## 14. Sources read on 2026-09-24

- Cloudflare blog, "Orange Me2eets: We made an end-to-end encrypted video calling app and it was easy", 2025-06-26 — <https://blog.cloudflare.com/orange-me2eets-we-made-an-end-to-end-encrypted-video-calling-app-and-it-was/>: `createEncodedStreams`; OpenMLS compiled to WebAssembly in a web worker; VP8's first one to ten bytes left unencrypted; no SFU modification; the server only broadcasts messages; the designated committer algorithm and its TLA+ check; the safety number; the JavaScript-cryptography caveat. Simulcast and browser support not discussed.
- Cloudflare Realtime simulcast — <https://developers.cloudflare.com/realtime/sfu/simulcast/>: `preferredRid`, `priorityOrdering`, `ridNotAvailable`; nothing on keyframes, codecs or encrypted payloads.
- RFC 9605, Secure Frame (SFrame) — <https://www.rfc-editor.org/rfc/rfc9605.html>: the five cipher suites and their identifiers; HKDF labels; the KID/CTR header and its visibility to intermediaries; sender keys and MLS as key management; per-frame against per-packet; one base key per sender.
- Chrome 141 release notes — <https://developer.chrome.com/release-notes/141>: WebRTC Encoded Transform (V2) shipped; Safari 2022 and Firefox 2023 cited; `generateKeyFrame` not covered.
- Search summaries, not read as primary pages: Firefox's intent to ship `RTCRtpScriptTransform` in 117 (<https://groups.google.com/a/mozilla.org/g/dev-platform/c/Gowr5Fx5jng>); X25519 in WebCrypto across the three engines with Chrome 137 last (<https://blogs.igalia.com/jfernandez/2025/02/28/can-i-use-secure-curves-in-the-web-platform/>, <https://chromestatus.com/feature/6291245926973440>); `SFrameTransform` status in Firefox (<https://bugzilla.mozilla.org/show_bug.cgi?id=1715625>); `mls-rs-crypto-webcrypto` and `mls-rs-crypto-awslc` (<https://crates.io/crates/mls-rs-crypto-webcrypto>, <https://github.com/awslabs/mls-rs>); `openmls_rust_crypto` (<https://docs.rs/openmls_rust_crypto>); Zoom's end-to-end encryption and the features it disables (<https://www.zoom.com/en/blog/zoom-rolling-out-end-to-end-encryption-offering/>).
- In this repository: the meetings design (the SFU client, simulcast rids, the room), the recording design and [`docs/research/2026-09-20-meeting-recording-paths.md`](2026-09-20-meeting-recording-paths.md) (the adapter decodes Opus to PCM and video to JPEG), the media-effects design (effects in the browser, before publishing), `apps/api-worker/src/meetings/CLAUDE.md` (the frame budget), and the dial-in design.

## 15. What this does not settle

- **Whether simulcast survives on Cloudflare's SFU** — experiment E1 — and whether audio needs any clear prefix — E2.
- **Encrypted chat.** Out of scope while chat is on the record; the two cannot both hold.
- **Recording an encrypted meeting in a browser** — one participant's browser composing and uploading the decrypted media. It is technically possible and would put decrypted media in the firm's storage, which undoes the point for the storage-holding party; not pursued.
- **Long-term identity keys** that make the security code stable across meetings, and a device-key registry to hold them.
- **Code-integrity assurance for the web client** beyond the desktop shell's signed builds.
- **The desktop shell's WebRTC support on Linux,** which decides whether parity holds.
- **Breakout rooms in an encrypted meeting** (not started), where each room would be its own key group.
- **Whether a guest may be admitted to an encrypted meeting without comparing a security code** with a host — the forwarded-link risk the lobby addresses is exactly the one the code would catch.
- **The exact frame vocabulary and its limits**, which is the protocol package's to settle when a build starts.
