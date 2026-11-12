# Meetings — end-to-end encryption, design

**Status:** Design, 2026-11-09. The experiments in section 10 come before any code; they are not owner questions. Shaped with the owner on 2026-11-09; every owner question is settled (section 12).
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) covers the meeting record, the `MeetingRoom` Durable Object, the routing-service client and the screen. Nothing here rebuilds any of it.
**Research:** [`docs/research/2026-09-24-meetings-end-to-end-encryption.md`](../research/2026-09-24-meetings-end-to-end-encryption.md). This design takes its frame format, browser findings and threat model as they stand. It changes four of its recommendations, and section 2 says which and why.
**Beside:** [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md), [`2026-09-24-meetings-dial-in-design.md`](2026-09-24-meetings-dial-in-design.md), [`2026-09-20-meetings-reactions-and-polls-design.md`](2026-09-20-meetings-reactions-and-polls-design.md) and [`2026-09-24-meetings-breakout-rooms-design.md`](2026-09-24-meetings-breakout-rooms-design.md).
**Ledger:** the `meetings.end-to-end-encryption` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).

## 1. What this settles

In an end-to-end encrypted meeting, audio and video are encrypted in each participant's browser before they leave it. They are decrypted only in the other participants' browsers. Cloudflare's routing service and our own Worker carry them without being able to read them.

That is the whole claim. It is the claim in section 2 of the research note, and the user guide states it the same way: it protects against the routing service and a passive signaling room. It does not protect against a malicious deployment of this application's own code, because no web application can (research, section 7).

The owner's direction of 2026-11-09 was to build it ("absolutely"), at the room's full size, keeping recording, accepting dial-in with a warning, and doing better than Zoom's and Google Meet's encrypted modes.

## 2. What changed from the research note

| Research note recommended                     | This design                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sender keys, a ceiling of 50, MLS later       | **MLS (RFC 9420) from the start, up to the room's 300**                                   | Under sender keys, one departure from a room of 300 is 89,102 envelopes, about 13 MB through one Durable Object (research, section 6.3). Under MLS, a removal is one commit of about log₂(300) ≈ 9 path secrets. Cloudflare's own Orange Me2eets runs MLS on the same routing service, unmodified (research, section 3.2). The owner rejected a ceiling below the room's size. |
| Refuse recording in an encrypted meeting      | **Pause encryption while a server feature runs** (section 6)                              | The owner wants recordings in the cloud, reachable by others and not dependent on one computer, and wants live captions. Both need the server to hear the audio. Encryption pauses while either runs, everyone is told, and it resumes with fresh keys when they stop.                                                                                                         |
| Refuse dial-in                                | **Allow it, as the third reason to pause** (section 6)                                    | The telephone network has no end-to-end encryption, so a phone caller's audio is decrypted at the bridge. The owner accepted that trade, provided participants are told.                                                                                                                                                                                                       |
| Wait for recording and dial-in to exist first | **Build when the experiments pass;** a pause lands on a route only once that route exists | The ordering existed so the refusals would have routes to land on. With recording, captions and dial-in pausing encryption rather than being refused, encryption no longer has to wait for any of them.                                                                                                                                                                        |

Unchanged: SFrame (RFC 9605) as the frame format, `RTCRtpScriptTransform` in a worker, WebCrypto for the frame cipher, the security code, and no C or C++ anywhere.

## 3. How it compares, and where it is better

Read on 2026-11-09:

- **Zoom's end-to-end mode** disables cloud recording, live streaming, live transcription, breakout rooms, polling, meeting reactions, one-to-one private chat and telephone dial-in. It does not run in a web browser at all, only in Zoom's desktop and mobile apps ([Western University's Zoom E2EE guide](https://wts.uwo.ca/zoom/security/e2ee.html)). Whether local recording survives was not confirmed.
- **Google Meet's client-side encryption** encrypts audio and video in the browser before they reach Google. The organization has to connect its own external key service and identity provider, and nobody can join by phone ([Google Workspace admin guide to Meet security](https://knowledge.workspace.google.com/admin/meet/google-meet-security-and-privacy-for-it-admins); [Workspace Updates, 2022-08](https://workspaceupdates.googleblog.com/2022/08/client-side-encryption-for-google-meet.html)).

Against those, an encrypted meeting here:

1. **Runs in the browser**, which Zoom's encrypted mode does not.
2. **Needs no key service for the firm to run.** Keys are agreed between the browsers.
3. **Keeps polls, questions, raised hands, reactions, the lobby and host controls.** None of these travels in the media. They travel on the signaling socket, which is unchanged (`apps/api-worker/src/meetings/room/`).
4. **Keeps cloud recording, live captions and dial-in.** Each pauses encryption, visibly, for as long as it runs (section 6), where Zoom and Meet switch them off.
5. **Uses the IETF standards** (MLS and SFrame) rather than a vendor protocol.

What it gives up: nothing permanently. What it does is make plain, to everyone in the room, every moment the server can hear the meeting.

## 4. Key agreement: MLS

- **The library is OpenMLS with the pure-Rust `openmls_rust_crypto` provider**, compiled to WebAssembly under `crates/` with its output in `packages/<name>/src/pkg/`. That is the precedent `pdf-core`, `decryption-core`, `email-core` and `seven-zip-core` set. It is what Orange Me2eets uses (research, section 6.1). `mls-rs` with `mls-rs-crypto-webcrypto` is the alternative if the bundle measures too large. The AWS-LC and OpenSSL providers are never used: both are C (research, section 8).
- **One MLS group per meeting**, created by the first host to arrive. Each participant gets a fresh credential at admission, naming the stay the room seated them on, signed with a key made in the browser for that stay and never stored or exported. (Amended 2026-11-10 at build: the key lives in the WebAssembly module's memory rather than as a WebCrypto non-extractable key, because OpenMLS signs synchronously and WebCrypto only asynchronously. The committer refuses a key package whose credential names any stay but the one the room says sent it.)
- **The room is the delivery service.** MLS needs handshake messages delivered in one order. The `MeetingRoom` Durable Object is single-threaded, so it already is a sequencer (research, section 6.3). It relays key packages, welcomes and commits to sockets and stores none of their contents. Four additive frames in `@magna-carta/meeting-protocol`: `mls-key-package`, `mls-welcome`, `mls-commit` and `mls-proposal`. The frames-have-handlers fitness function holds them like every other frame.
- **How the room sequences, as built (2026-11-10).** The first stay to send a key package into a room with no group is told to found it, by a `mls-welcome` that carries none. Every later key package is kept until its stay is admitted and relayed to the group, so whoever is committer has it. The room accepts the first `mls-commit` made from the epoch it holds and refuses the rest `stale-epoch`; the losing browser discards its commit, applies the winner and retries. An accepted commit goes to the group as it stood, the committer included, and its welcome to the stays it adds. A commit names those stays in the clear, so the room can route the welcome; a browser reads membership only from the commit it verified. When the last member leaves, somebody still waiting founds a new group. A welcome at 300 measured 59,737 bytes, so the socket's frame ceiling rose from 64 KB to 256 KB.
- **One committer.** The live member with the smallest leaf index commits pending adds and removes. That is Orange Me2eets' designated-committer rule, which Cloudflare model-checked (research, section 6.1). A commit batches every admission and departure since the last one, so a burst of people leaving costs one commit, not one per person.
- **Each epoch's exporter secret derives the SFrame base keys**, one per sender, as RFC 9605 describes for MLS. Someone leaving advances the epoch, so a departed browser holds only keys that no longer encrypt anything.
- **A waiting socket receives no welcome.** It is not in the group until a host admits it.

- **How a meeting becomes encrypted, as built (2026-11-12).** `meeting.encrypted` is chosen when the room opens and never changed, like the medium. Start asks for it by default and the host may ask otherwise; scheduled meetings and personal-room sessions follow the deployment. A meeting opens encrypted only where the deployment var `MEETINGS_END_TO_END_ENCRYPTION` is `on`, which waits for E1 to E3. The room refuses group frames in a meeting opened in the clear (`not-encrypted`). The browser loads the engine before it connects, starts its group on the welcome, and puts the transform on every sender and receiver before each offer it makes and after each one it applies, with video held to VP8 by codec preference. A browser with no `RTCRtpScriptTransform` is told it cannot join before anything is captured. A guest's arrival carries the flag and the group's name (the meeting's handle), since every browser in the group must give the same one.

## 5. The frame

- SFrame, suite `AES_128_GCM_SHA256_128`, one frame at a time, in a `RTCRtpScriptTransform` worker on WebCrypto (research, section 5). The transform is one small file, reviewed as security code.
- **VP8 for video in an encrypted meeting**, with its first bytes authenticated but not encrypted (ten on a keyframe, one otherwise), so the routing service can still find keyframes (research, section 3.2). Every engine supports VP8. The cost is losing the hardware H.264 encoder on Apple devices.
- **Encrypted H.264 is an experiment, not a refusal (E3).** H.264's packetizer parses the frame's internal structure, and encrypted bytes can split a frame in the wrong place (research, section 3.1). E3 tests it on the real routing service with an encrypted H.264 track from Safari. If frames arrive whole, H.264 is offered. If not, VP8 stays. H.265 has the same packetizer problem and is not attempted.
- **A frame that does not decrypt is dropped, never shown.** A frame with no SFrame header is refused and its tile says "Not encrypted, not shown" (research, section 5).
- Audio is Opus with the whole frame encrypted, subject to experiment E2.

## 6. Server features pause encryption, visibly

Three features need the server to hear the meeting: **cloud recording**, **live captions** and **a phone caller**. The owner wants all three: recordings in the cloud, so others can reach them and no one computer's failure loses them; live captions; and dial-in. None of them can work on encrypted media, because the routing service's adapter decodes Opus and an encrypted frame does not decode (research, section 4). So while any of them runs, **end-to-end encryption pauses**, and everybody is told.

- **Pausing is a host's act, signed into the group.** A host starting recording or captions, or admitting a phone caller, commits a `paused` flag into the MLS group context with the reason. Every browser reads the pause from the group state it has itself verified, never from the room's word, so a malicious server cannot fake a pause to make browsers send in the clear.
- **While paused,** senders stop applying the frame transform and receivers accept unencrypted frames. The media is then protected hop by hop, exactly as an unencrypted meeting is today (DTLS-SRTP to and from the routing service).
- **Everyone sees it, the whole time.** A persistent banner names the reason: "Not end-to-end encrypted while this meeting is being recorded", "…while live captions are on" or "…while a phone participant is connected". Whoever arrives during a pause is told on arrival. The recording notice of the 2026-09-20 ruling runs as well, unchanged.
- **Resuming is automatic.** When the last reason stops (recording stopped, captions off, last caller gone), the next commit clears the flag and advances the epoch, so the keys that resume are new. The banner clears.
- **Cloud recording is the recording design's own path,** unchanged: the routing service's adapter streams each audio track to a Durable Object we run, filed into the matter through the untrusted-file pipeline. Others reach it like any matter file, and no participant's computer is in the path.
- **Live captions are the recording design's caption path,** on the Cloudflare-hosted speech models, unchanged.
- **The dial-in bridge is the dial-in design's bridge,** unchanged. The security code shows it as a labelled member while a caller is present.
- A firm may forbid any of the three in encrypted meetings with a setting. All three are allowed by default, per the owner's rulings.

## 7. What is never paused for, and what never needs a pause

| Feature                                   | In an encrypted meeting                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Cloud recording, live captions, dial-in   | Pause encryption while they run (section 6)                           |
| Webinars and live streaming               | Run unencrypted. A broadcast to an audience is not a private meeting. |
| Background blur, image backgrounds, noise | **Unaffected.** They run in the browser before encryption.            |
| Chat, polls, questions, reactions, hands  | **Unaffected.** Signaling, not media.                                 |
| Breakout rooms                            | Each room is its own MLS group, made the same way                     |

## 8. What the claim becomes

Section 1's claim holds **for every moment the banner is absent**. The meeting's attendance record also notes each pause, with its reason, start and end, so the firm can later say which stretches of a meeting were end-to-end encrypted. Identifiers and instants only, on the attendance record's own rule.

## 9. The security code

As in the research note (section 6.4): each browser hashes the group's member list and credentials into a short code of digit groups, shown in the meeting's security panel. **It is shown, not required.** It changes when anyone joins or leaves, so it suits a small, deliberate meeting. A host who needs certainty reads it aloud, or compares it over another channel.

## 10. Experiments before code

| Experiment | Question                                                                     | Pass                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1         | Does simulcast layer switching survive encrypted VP8 on the routing service? | Every switch lands within one keyframe interval with no decode errors                                                                                                                       |
| E2         | Does Opus need any clear prefix?                                             | Audio plays with the whole frame encrypted                                                                                                                                                  |
| E3         | Does encrypted H.264 from Safari arrive whole?                               | No split frames over a 5-minute call                                                                                                                                                        |
| E4         | What does MLS cost at 300?                                                   | An admission and a removal at 300 each finish under 1 second in a mid-range laptop browser; the WebAssembly bundle is at most 1 MB gzipped, loaded only when an encrypted meeting is joined |

**E4 passed on 2026-11-10.** OpenMLS 0.9 with `openmls_rust_crypto`, cipher suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`, measured in headless Chromium on a 4-core cloud machine at 300 members: an admission cost 82 ms to commit, 10 ms for an existing member to process and 50 ms for the newcomer to join; a removal 74 ms to commit and 10 ms to process. With the browser's CPU slowed fourfold, the worst was a removal's commit at 343 ms. Every member exported the same SFrame base key. The module is 585 KB gzipped at `opt-level = "s"` and about 500 KB at the workspace release profile's `"z"`. `cargo tree -i cc` finds no C in it, for the host or for WebAssembly. E1 to E3 need the live routing service and Safari, so they run on a developer machine.

## 11. Files touched, in shape

`crates/mls-core/` and `packages/mls/` (each with its own `CLAUDE.md`). The frame transform worker under `apps/web/src/lib/meetings/client/`. Four frames in `packages/meeting-protocol`. The room's relay in a new `apps/api-worker/src/meetings/room/room-group.ts`. An `encrypted` column on `meeting`, fixed at Start. The pause commit on the recording, captions and dial-in start routes, and a `meeting_encryption_pause` row per pause. The dial-in bridge as an MLS member. The security panel and the pause banner in `apps/web/src/lib/meetings/screen/`. The user guide section. Registration in [`tooling/lint-native-builds/register.mjs`](../../tooling/lint-native-builds/register.mjs) is not needed, because nothing is native.

## 12. Owner questions

- **Settled 2026-11-09: on by default.** Every meeting starts end-to-end encrypted unless the host switches it off at Start. It is fixed for the meeting once started. Recording, captions and dial-in pause it rather than needing it off (section 6).
- **Settled 2026-11-09:** build it; full room size (MLS); recordings stay in the cloud, live captions stay available, and dial-in is allowed, each pausing encryption visibly while it runs; personal rooms are allowed (a separate ledger node).
- **Carried from the research note, with the recommended answer taken unless the owner says otherwise:** a firm may forbid encrypted meetings (O2); the security code is shown, not required (O5); the claim in section 1 is the claim (O4).
