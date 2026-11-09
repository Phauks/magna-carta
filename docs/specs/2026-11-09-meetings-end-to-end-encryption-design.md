# Meetings — end-to-end encryption, design

**Status:** Design, 2026-11-09. Shaped with the owner on 2026-11-09. One owner question is still open (section 12).
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) covers the meeting record, the `MeetingRoom` Durable Object, the routing-service client and the screen. Nothing here rebuilds any of it.
**Research:** [`docs/research/2026-09-24-meetings-end-to-end-encryption.md`](../research/2026-09-24-meetings-end-to-end-encryption.md). This design takes its frame format, browser findings and threat model as they stand. It changes four of its recommendations, and section 2 says which and why.
**Beside:** [`2026-09-20-meetings-recording-and-transcription-design.md`](2026-09-20-meetings-recording-and-transcription-design.md), [`2026-09-24-meetings-dial-in-design.md`](2026-09-24-meetings-dial-in-design.md), [`2026-09-20-meetings-reactions-and-polls-design.md`](2026-09-20-meetings-reactions-and-polls-design.md) and [`2026-09-24-meetings-breakout-rooms-design.md`](2026-09-24-meetings-breakout-rooms-design.md).
**Ledger:** the `meetings.end-to-end-encryption` node in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).

## 1. What this settles

In an end-to-end encrypted meeting, audio and video are encrypted in each participant's browser before they leave it. They are decrypted only in the other participants' browsers. Cloudflare's routing service and our own Worker carry them without being able to read them.

That is the whole claim. It is the claim in section 2 of the research note, and the user guide states it the same way: it protects against the routing service and a passive signaling room. It does not protect against a malicious deployment of this application's own code, because no web application can (research, section 7).

The owner's direction of 2026-11-09 was to build it ("absolutely"), at the room's full size, keeping recording, accepting dial-in with a warning, and doing better than Zoom's and Google Meet's encrypted modes.

## 2. What changed from the research note

| Research note recommended                          | This design                                                                 | Why                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sender keys, a ceiling of 50, MLS later            | **MLS (RFC 9420) from the start, up to the room's 300**                    | Under sender keys, one departure from a room of 300 is 89,102 envelopes, about 13 MB through one Durable Object (research, section 6.3). Under MLS, a removal is one commit of about log₂(300) ≈ 9 path secrets. Cloudflare's own Orange Me2eets runs MLS on the same routing service, unmodified (research, section 3.2). The owner rejected a ceiling below the room's size. |
| Refuse recording in an encrypted meeting            | **Record in the host's browser** (section 6)                                | The owner wants recording. The browser already holds decrypted media. The research note's objection (section 15) was that this puts decrypted media in the firm's storage. That is the firm's own record of its own meeting, which it already keeps for every unencrypted meeting, so the objection does not outweigh the owner's ruling. |
| Refuse dial-in                                      | **Allow it, behind a warning everyone sees** (section 7)                   | The telephone network has no end-to-end encryption, so a phone caller's audio is decrypted at the bridge. The owner accepted that trade, provided participants are told.                                                                                                                                                                                             |
| Wait for recording and dial-in to exist first       | **Build when the experiments pass;** a refusal lands on a route only once that route exists | The ordering existed so the refusals would have routes to land on. With recording kept and dial-in warned rather than refused, encryption no longer has to wait for either one.                                                                                                                                                                                    |

Unchanged: SFrame (RFC 9605) as the frame format, `RTCRtpScriptTransform` in a worker, WebCrypto for the frame cipher, the security code, and no C or C++ anywhere.

## 3. How it compares, and where it is better

Read on 2026-11-09:

- **Zoom's end-to-end mode** disables cloud recording, live streaming, live transcription, breakout rooms, polling, meeting reactions, one-to-one private chat and telephone dial-in. It does not run in a web browser at all, only in Zoom's desktop and mobile apps ([Western University's Zoom E2EE guide](https://wts.uwo.ca/zoom/security/e2ee.html)). Whether local recording survives was not confirmed.
- **Google Meet's client-side encryption** encrypts audio and video in the browser before they reach Google. The organization has to connect its own external key service and identity provider, and nobody can join by phone ([Google Workspace admin guide to Meet security](https://knowledge.workspace.google.com/admin/meet/google-meet-security-and-privacy-for-it-admins); [Workspace Updates, 2022-08](https://workspaceupdates.googleblog.com/2022/08/client-side-encryption-for-google-meet.html)).

Against those, an encrypted meeting here:

1. **Runs in the browser**, which Zoom's encrypted mode does not.
2. **Needs no key service for the firm to run.** Keys are agreed between the browsers.
3. **Keeps polls, questions, raised hands, reactions, the lobby and host controls.** None of these travels in the media. They travel on the signaling socket, which is unchanged (`apps/api-worker/src/meetings/room/`).
4. **Keeps recording** (section 6), and **keeps dial-in** behind a warning (section 7).
5. **Uses the IETF standards** (MLS and SFrame) rather than a vendor protocol.

What it still gives up while it is on: live captions and anything else that reads media on a server while the meeting is running (section 8).

## 4. Key agreement: MLS

- **The library is OpenMLS with the pure-Rust `openmls_rust_crypto` provider**, compiled to WebAssembly under `crates/` with its output in `packages/<name>/src/pkg/`. That is the precedent `pdf-core`, `decryption-core`, `email-core` and `seven-zip-core` set. It is what Orange Me2eets uses (research, section 6.1). `mls-rs` with `mls-rs-crypto-webcrypto` is the alternative if the bundle measures too large. The AWS-LC and OpenSSL providers are never used: both are C (research, section 8).
- **One MLS group per meeting**, created by the first host to arrive. Each participant gets a fresh credential at admission, signed with a non-extractable key that never leaves the browser.
- **The room is the delivery service.** MLS needs handshake messages delivered in one order. The `MeetingRoom` Durable Object is single-threaded, so it already is a sequencer (research, section 6.3). It relays key packages, welcomes and commits to sockets and stores none of their contents. Four additive frames in `@magna-carta/meeting-protocol`: `mls-key-package`, `mls-welcome`, `mls-commit` and `mls-proposal`. The frames-have-handlers fitness function holds them like every other frame.
- **One committer.** The live member with the smallest leaf index commits pending adds and removes. That is Orange Me2eets' designated-committer rule, which Cloudflare model-checked (research, section 6.1). A commit batches every admission and departure since the last one, so a burst of people leaving costs one commit, not one per person.
- **Each epoch's exporter secret derives the SFrame base keys**, one per sender, as RFC 9605 describes for MLS. Someone leaving advances the epoch, so a departed browser holds only keys that no longer encrypt anything.
- **A waiting socket receives no welcome.** It is not in the group until a host admits it.

## 5. The frame

- SFrame, suite `AES_128_GCM_SHA256_128`, one frame at a time, in a `RTCRtpScriptTransform` worker on WebCrypto (research, section 5). The transform is one small file, reviewed as security code.
- **VP8 for video in an encrypted meeting**, with its first bytes authenticated but not encrypted (ten on a keyframe, one otherwise), so the routing service can still find keyframes (research, section 3.2). Every engine supports VP8. The cost is losing the hardware H.264 encoder on Apple devices.
- **Encrypted H.264 is an experiment, not a refusal (E3).** H.264's packetizer parses the frame's internal structure, and encrypted bytes can split a frame in the wrong place (research, section 3.1). E3 tests it on the real routing service with an encrypted H.264 track from Safari. If frames arrive whole, H.264 is offered. If not, VP8 stays. H.265 has the same packetizer problem and is not attempted.
- **A frame that does not decrypt is dropped, never shown.** A frame with no SFrame header is refused and its tile says "Not encrypted, not shown" (research, section 5).
- Audio is Opus with the whole frame encrypted, subject to experiment E2.

## 6. Recording in an encrypted meeting

A host starts recording exactly as in an unencrypted meeting, and the same notice applies. Everyone hears and sees "Recording in progress" when it starts and when they arrive, and the mark stays on every screen while it runs (recording design, the owner's ruling of 2026-09-20).

What differs is where the recording is made:

- **The recording host's browser records what it has already decrypted**, one audio file per speaker and the mixed meeting, using the browser's own `MediaRecorder`. No new dependency is added. Video is recorded only if the recording design's video question is answered yes. Until then this matches the server path's audio-only record.
- **The pieces upload as they are made**, in chunks, through the same untrusted-file pipeline the server path files into, so a crashed browser loses at most its last chunk. The file lands in the matter's file the same way and carries the same record.
- **Transcripts and the summary run on the saved recording after the meeting**, through the recording design's existing transcription path. Only the live captions are lost.
- **If the recording host leaves, recording passes to another host** who is present. If no host is present, it stops, and stopping is announced the same way.
- The user guide says plainly that a recording of an encrypted meeting is the firm's own copy in its own storage, readable by the firm like any other matter file. Encryption protects the meeting in transit, not the record the firm chose to keep.

## 7. Dial-in in an encrypted meeting

The dial-in bridge (dial-in design) joins the MLS group as a member, labelled as the telephone bridge. A phone caller's audio is decrypted there, because the telephone network cannot carry anything else.

- **Everyone is told, every time.** While any phone caller is present, every participant sees a persistent banner: "A phone participant has joined. Audio in this meeting is not end-to-end encrypted while they are connected." Whoever arrives later is told on arrival. When the last phone caller leaves, the bridge is removed from the group, the epoch advances, and the banner clears.
- **The security code shows the bridge as a member**, so nobody can mistake it for a person.
- **A firm may turn dial-in off for encrypted meetings** with one setting. It is on by default, per the owner's ruling.

## 8. What still turns off, and where it is refused

| Feature                                   | In an encrypted meeting                                            | Refused where                       |
| ----------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Live captions                             | Off. The routing service's adapter cannot decode encrypted Opus.   | The captions start route            |
| Server-side recording                     | Replaced by section 6                                              | The recording start route chooses the path |
| Webinars and live streaming               | Not offered. A broadcast is a meeting nobody could audit.          | Their start routes                  |
| Background blur, image backgrounds, noise | **Unaffected.** They run in the browser before encryption.        | Not refused                         |
| Chat, polls, questions, reactions, hands  | **Unaffected.** Signaling, not media.                              | Not refused                         |
| Breakout rooms                            | Each room is its own MLS group, made the same way                  | Not refused                         |

Each refusal is a reason on the screen at the point where the feature starts, never a failure while it runs.

## 9. The security code

As in the research note (section 6.4): each browser hashes the group's member list and credentials into a short code of digit groups, shown in the meeting's security panel. **It is shown, not required.** It changes when anyone joins or leaves, so it suits a small, deliberate meeting. A host who needs certainty reads it aloud, or compares it over another channel.

## 10. Experiments before code

| Experiment | Question                                                                 | Pass                                                                     |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **E1**     | Does simulcast layer switching survive encrypted VP8 on the routing service? | Every switch lands within one keyframe interval with no decode errors     |
| **E2**     | Does Opus need any clear prefix?                                         | Audio plays with the whole frame encrypted                               |
| **E3**     | Does encrypted H.264 from Safari arrive whole?                           | No split frames over a 5-minute call                                     |
| **E4**     | What does MLS cost at 300?                                               | An admission and a removal at 300 each finish under 1 second in a mid-range laptop browser; the WebAssembly bundle is at most 1 MB gzipped, loaded only when an encrypted meeting is joined |

## 11. Files touched, in shape

`crates/mls-core/` and `packages/mls/` (each with its own `CLAUDE.md`). The frame transform worker under `apps/web/src/lib/meetings/client/`. Four frames in `packages/meeting-protocol`. The room's relay in a new `apps/api-worker/src/meetings/room/room-group.ts`. An `encrypted` column on `meeting`, fixed at Start. Refusals on the captions, webinar and streaming start routes. The browser recording path beside the server path. The dial-in bridge as an MLS member. The security panel and the phone banner in `apps/web/src/lib/meetings/screen/`. The user guide section. Registration in [`tooling/lint-native-builds/register.mjs`](../../tooling/lint-native-builds/register.mjs) is not needed, because nothing is native.

## 12. Owner questions

- **Open: on by default, or chosen at Start?** Either way the choice is fixed once the meeting starts. Encryption now costs only live captions and webinars (section 8), so on by default is a reasonable answer.
- **Settled 2026-11-09:** build it; full room size (MLS); keep recording; allow dial-in with a warning; personal rooms are allowed (a separate ledger node).
- **Carried from the research note, with the recommended answer taken unless the owner says otherwise:** a firm may forbid encrypted meetings (O2); the security code is shown, not required (O5); the claim in section 1 is the claim (O4).
