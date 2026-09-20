# Meetings — backgrounds and noise suppression, design

**Status:** Slice 1 (the browser's own treatment, and the seam) proposed for build, 2026-09-20.
Slice 2 (the picture) is a **measurement first**, and carries the one owner-consent question golden
rule 14 requires. Slice 3 (the sound, in Rust) follows the same precedent and needs no question.
**Parent design:** [`docs/specs/2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) — what
the browser captures and publishes, and the client's state machine. Binding, not restated.
**Research behind every fact here:**
[`docs/research/2026-09-20-browser-media-effects.md`](../research/2026-09-20-browser-media-effects.md)
— the browser APIs, the runtimes, the language each one is written in, with sources and dates. This
document does not repeat the evidence; it decides on it.
**White paper:** _Communications layer_ — [`docs/Magna-Carta-White-Paper.md`](../Magna-Carta-White-Paper.md).
**Ledger:** `meetings.backgrounds-and-noise` in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).
**The rule that shapes this whole design:** golden rule 14 in [`CLAUDE.md`](../../CLAUDE.md).
Background blur in a browser is, in every off-the-shelf form, C++ compiled to WebAssembly. So this
design is arranged so that **the useful half ships with no dependency at all**, the second half is
attempted in Rust and in TypeScript before anything memory-unsafe is considered, and the memory-unsafe
option is priced and asked about rather than adopted.

---

## 1. What this is

A member in a meeting opens a small **Effects** menu beside the camera control and can:

- have the browser clean up their microphone — noise suppression, echo cancellation, gain control —
  and see what it actually did rather than guessing;
- blur their background, where that is something this browser and this machine can do.

Everything happens on the local track **before it is published**. The routing service is unchanged,
the signaling room is unchanged, the meeting record is unchanged, and no server learns that a member
turned an effect on. There is no new API, no new table, no new permission.

## 2. What it is not

- **Not a virtual background image.** Replacement is the same segmentation with a different composite
  step and is sequenced after blur works; a firm that wants a branded background is not the reason to
  ship a model.
- **Not server-side processing.** Google Meet runs its denoiser in a data centre; that means privileged
  audio leaving the browser, which this platform will not do for an effect.
- **Not a vendor SDK.** Krisp and its peers are proprietary subscriptions, which is the thing the
  meetings design exists to avoid.
- **Not touch/mobile-specific work.** The controls are the same everywhere; the effect is offered
  where the machine can carry it.

## 3. The rule, applied

Golden rule 14 orders the options for us. Stated once here so no later slice re-derives it:

| Option                                                                     | Language of the shipped artefact | Status here                                                |
| -------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| The browser's own constraints (`noiseSuppression`, `backgroundBlur`, …)    | none — it is the browser         | **Slice 1. Build it.**                                     |
| A pure-Rust runtime compiled to WebAssembly (`rten`, `tract`)              | Rust                             | **Slice 2, first choice** — on the `crates/` precedent     |
| TensorFlow.js on the WebGL backend                                         | TypeScript + GLSL                | **Slice 2, fallback** — memory-safe, proven, stale project |
| MediaPipe, ONNX Runtime Web, Transformers.js, TensorFlow.js `wasm` backend | **C++** through Emscripten       | **Owner-consent question (M1). Never adopted here.**       |
| RNNoise compiled with Emscripten (what Jitsi ships)                        | **C** through Emscripten         | **Owner-consent question (M2). Not needed** — see slice 3  |
| `nnnoiseless`, the safe-Rust port of RNNoise                               | Rust                             | **Slice 3. Build it.**                                     |

Nothing in the middle rows is adopted by this document, and no branch implementing it is opened, until
the question is answered. That is the whole of the rule's procedure: surface it, price it, ask.

---

## 4. Slice 1 — what costs no dependency at all

### 4.1 Ask for the audio treatment explicitly

`publish()` in
[`apps/web/src/lib/meetings/meeting-client.svelte.ts`](../../apps/web/src/lib/meetings/meeting-client.svelte.ts)
captures with `{ audio: true, video: wantsPicture }` today, which takes each browser's default and
tells nobody what that was. It becomes a built constraint set:

```
audio: {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  // Only where the browser knows the name at all; an unknown key is ignored, and asking for one
  // the platform cannot honour is how a member ends up with no microphone.
  ...(supportsVoiceIsolation() ? { voiceIsolation: true } : {}),
}
video: wantsPicture ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false
```

**Every one of these is a plain boolean, never `{ exact: true }`.** An exact constraint the device
cannot meet rejects `getUserMedia` outright, and the failure the member sees is "the microphone is not
available in this browser" — a member with no microphone because we insisted on a filter is a strictly
worse outcome than a member with an unfiltered one. This is a hard rule of this design and belongs in
the code as a comment explaining the reasoning, not as a citation of this document.

### 4.2 Read back what the browser actually did, and say so

`getSupportedConstraints()` is not trusted — it reports constraints the browser does not implement. The
truthful source is the track:

```
readAudioTreatment(track: MediaStreamTrack): AudioTreatment
// { noiseSuppression, echoCancellation, autoGainControl, voiceIsolation }
// each: true | false | null   — null means this browser did not report the setting at all
```

The three-valued answer is the point. Chrome applies noise suppression and does not report it as a
controllable setting; Safari reports neither `noiseSuppression` nor `autoGainControl`; Firefox reports
all three. A boolean would have to lie in two of those three cases.

### 4.3 Probe the platform's own background blur, and degrade gracefully

```
readBlurCapability(track): "controllable" | "platform-controlled" | "unavailable"
```

- `getCapabilities().backgroundBlur` with **two** values → `controllable`; the menu offers the toggle
  and applies it with `track.applyConstraints({ backgroundBlur: on })`, inside a `try`/`catch` that
  falls back to `platform-controlled` on rejection.
- **One** value → `platform-controlled`: the machine decides (this is macOS, where blur is a Control
  Centre setting no application may touch). The menu says which way it is set and that it is set
  elsewhere.
- Missing, or no `getCapabilities` → `unavailable`.

Chrome's control API never left an origin trial, so `unavailable` is the answer nearly everywhere and
the copy is written for that case first, not as an error: **"Background blur is not available in this
browser."** No disabled control, no spinner, no "coming soon" — a control that cannot act is not
drawn, which is the standing ruling in
[`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) applied here.

### 4.4 What the member gets from slice 1

On Chrome and Firefox: explicit noise suppression, echo cancellation and gain control, stated. On
Chrome for a machine whose camera driver offers it: platform blur. On Safari: echo cancellation, an
honest "this browser decides" for the rest, and no blur. That is the majority of the audio half of
table stakes, for the cost of a constraint object and a read-back.

---

## 5. The seam: `MediaEffects`, between capture and publish

One new module, pure TypeScript, no Svelte, no browser globals except through what it is handed:
`apps/web/src/lib/meetings/media-effects.ts`.

```ts
export interface MediaEffectSettings {
  readonly background: "none" | "blur";
  readonly reduceNoise: boolean;
}

export interface AppliedEffects {
  readonly audio: AudioTreatment; // what the browser reported, three-valued
  readonly blur: "on" | "off" | "platform-controlled" | "unavailable";
  /** Present only when an effect was asked for and could not be given, in the app's own words. */
  readonly refusal: string | null;
}

export interface EffectedCapture {
  /** The stream to publish. In slice 1 this is the captured stream itself. */
  readonly stream: MediaStream;
  readonly applied: AppliedEffects;
  /** Change an effect without re-capturing, where the effect allows it. */
  update(settings: MediaEffectSettings): Promise<AppliedEffects>;
  /** Mute at the SOURCE as well as the output, so the camera light actually goes out. */
  setSourceEnabled(kind: "audio" | "video", enabled: boolean): void;
  /** Stop every track this stage owns, including any it captured itself. */
  close(): void;
}

export interface MediaEffectsStage {
  applyEffects(stream: MediaStream, settings: MediaEffectSettings): Promise<EffectedCapture>;
}

/** Slice 1: no processing at all — read the track, report, return it unchanged. */
export function passThroughEffects(): MediaEffectsStage;
```

`applyEffects(stream) → stream` is the whole contract, and in slice 1 it is literally the identity on
the stream with a description attached. Two decisions inside it are worth stating because they are the
ones a later slice would otherwise get wrong:

- **`setSourceEnabled` exists from the start.** Today `toggleCamera()` sets `enabled = false` on the
  tracks of `localStream`. The moment a processing stage exists, `localStream` is the **canvas** track
  and disabling it publishes a black rectangle while the camera stays open and its light stays on. The
  meetings design already refuses to open a camera nobody agreed to; the same reasoning says the light
  must go out when a member turns their picture off. The method is a no-op indirection in slice 1 and
  load-bearing in slice 2.
- **`close()` owns the raw tracks.** A processing stage captures nothing of its own in slice 1, but in
  slice 2 the raw camera track is held by the stage while the published track comes from a canvas.
  Whoever creates a track stops it, so teardown is one call from `leave()` rather than a list of tracks
  the client has to remember.

### 5.1 How it reaches the client

`MeetingClientSeams` gains one member, on the pattern of the other four:

```ts
createMediaEffects: () => MediaEffectsStage; // browserMeetingSeams(): passThroughEffects()
```

and `publish()` becomes capture → effects → publish:

```
const captured = await this.#seams.getUserMedia(captureConstraints(this.medium, this.effects));
const effected = await this.#effects.applyEffects(captured, this.effects);
this.localStream   = effected.stream;     // everything downstream is unchanged
this.appliedEffects = effected.applied;   // $state, read by the Effects menu
```

Nothing after that line changes: the transceivers, the simulcast encodings, the track names, the
speech meter and the room frames all see a `MediaStream` exactly as they do today.

### 5.2 Testable with a fake track

The stage takes a `MediaStream` and returns one, so a test needs neither a browser nor a camera. The
fake in `apps/web/test/` supplies a track object with `getSettings()`, `getCapabilities()`,
`applyConstraints()` and `enabled`, and the assertions are on what was asked for and what was reported —
which is the whole of slice 1's behaviour.

---

## 6. Slice 2 — the picture

**This slice starts as a measurement.** No product code is written until the numbers exist, because the
whole question is whether a memory-safe runtime holds a frame budget, and nobody has published that
number.

### 6.1 What would be built, in shape

| Stage        | Where               | What                                                                               |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| Capture      | main thread         | 720p30 camera track, as today                                                      |
| Segmentation | **a Web Worker**    | SelfieSegmenter at **256 × 144**, producing a mask — never at capture resolution   |
| Composite    | main thread, WebGL2 | mask upsampled, background blurred (separable Gaussian) or replaced, 720p30        |
| Publish      | unchanged           | `canvas.captureStream()` → the existing transceiver, or `replaceTrack` on a change |

The frame route is `<video>` + `requestVideoFrameCallback` + canvas + `captureStream`, which works in
every browser the product supports (Chrome 83/51, Firefox 132/43, Safari 15.4/11). Insertable streams
are deliberately **not** used: Chrome's form is main-thread and non-standard, Safari's is worker-only
and video-only, Firefox has neither and its bug has no milestone. Golden rule 10 also points the same
way — the heavy work belongs off the main thread, which the Worker gives us without the API.

### 6.2 The candidate, named

**First choice: `rten` 0.26.0 or `tract` 0.23.7, compiled to `wasm32` with WebAssembly SIMD**, on this
repository's existing precedent — a crate under `crates/`, wasm-bindgen output under
`packages/<name>/src/pkg/`, built by `vp run bootstrap` and by the pinned Docker build for deploys,
exactly as `pdf-core`, `decryption-core`, `email-core` and `seven-zip-core` already are. `tract` reads
`.tflite` directly, so it can run MediaPipe's published SelfieSegmenter file unconverted; `rten` needs
an ONNX conversion of the same model, committed as a build input.

**Model:** SelfieSegmenter landscape, `144 × 256 × 3`, 106K parameters, ~244 KB (the square `256 × 256`
variant, ~450 KB, is the fallback if the landscape crop costs accuracy on tall windows).

**Expected cost, stated as an expectation and not a measurement.** Google measured the same class of
model at **8.3 ms** inference and **14.3 ms** end-to-end on a 2018 MacBook Pro through XNNPACK's
WebAssembly SIMD path; MediaPipe publishes ~33 ms on its CPU reference device. A pure-Rust SIMD
kernel set that lands within 1.5–3× of XNNPACK puts inference at **12–25 ms** per frame on a
laptop of that age. Therefore the design runs **segmentation at 15 Hz with the mask reused and
temporally smoothed between frames, and composites at 30 Hz** — which costs roughly **0.2–0.4 of one
core** on the Worker thread, and leaves the main thread doing a 1–3 ms WebGL2 pass per frame. At 720p
the network never sees a 720p frame; only the composite does, and that is GPU work.

**Bundle:** a budget, not a figure — **≤ 1.5 MB gzipped** for the WebAssembly module plus the model,
loaded **only when a member turns the effect on**, never on the meeting route's first paint.

### 6.3 The bar the spike has to clear

Run on the reference machine in `docs/conventions/performance.md`'s load-profile terms, over a
30-second capture:

1. p95 segmentation ≤ **20 ms** per inference at 256 × 144.
2. Published stream holds ≥ **24 fps** at 720p with the effect on, measured from the sender's own
   `RTCOutboundRtpStreamStats`.
3. Main-thread cost ≤ **2 ms** per frame — the meeting screen must not drop a tile or stutter the
   roster.
4. Total additional CPU ≤ **35%** of one core.
5. Mask quality good enough that hair and shoulders do not flicker frame to frame with the smoothing on.

**If it clears: build it.** If it does not, the second memory-safe option is measured against the same
bar: **TensorFlow.js with the WebGL backend**, running the same SelfieSegmentation model through the
`tfjs` runtime (`@tensorflow/tfjs-core` + `@tensorflow/tfjs-converter` + `@tensorflow/tfjs-backend-webgl`,
Apache-2.0, TypeScript and GLSL, no C or C++ anywhere in the artefact). It is slower to load and it is
a project whose last release was 2024-10-21, and it is memory-safe and proven in production, which
under rule 14 beats fast and unsafe.

### 6.4 If both miss — the consent question, and nothing else

Only then does anything C-shaped get raised, and it is raised as a question, in these words:

> **M1.** Both memory-safe ways of running background blur in the browser have been measured and
> neither holds the frame budget. The way every other product does it is MediaPipe — Google's C++
> vision framework compiled to WebAssembly (`@mediapipe/tasks-vision`, Apache-2.0; a ~2 MB
> WebAssembly module out of a 36 MB package, plus a ~250 KB model). Golden rule 14 says C or C++
> compiled to WebAssembly needs your explicit consent. The exposure is narrow and it is not nothing:
> the module parses only our own model file and camera frames that never left this machine, it runs
> in the browser's sandbox inside a Worker with no network and no storage, and nothing privileged
> passes through it. **Do we adopt it for background blur alone, or ship without background blur and
> keep the audio effects, which need no such dependency?**

Were it consented, the entry would be registered in
[`tooling/lint-native-builds/register.mjs`](../../tooling/lint-native-builds/register.mjs) with status
`consented` and this reasoning, the way that register is written to be used; the licence is already
inside the allowlist in [`tooling/license-policy/index.mjs`](../../tooling/license-policy/index.mjs).
Until it is answered, none of that is written.

---

## 7. Slice 3 — the sound, in Rust

The browser's `noiseSuppression` is conventional suppression. A neural denoiser is materially better on
keyboards, paper and traffic, and this is the one place where the memory-safe option is the _obvious_
one rather than the careful one.

- **`nnnoiseless` 0.5.2** (BSD-3-Clause, safe Rust, required dependencies `easyfft` and `once_cell`
  only) in a new crate `crates/audio-denoise-core`, emitting a WebAssembly module into a new package
  `packages/audio-denoise` on the same generated-artefact path as the other four cores. The new package
  arrives with its own `CLAUDE.md`, as every new package must.
- **In an `AudioWorklet`**, for the reason Jitsi gives: the track is modified, so latency is audible and
  anything on the main thread damages it. The worklet bridges the 128-sample render quantum to the
  denoiser's 480-sample frame with a ring buffer, and the graph is
  `MediaStreamSource → AudioWorkletNode → MediaStreamDestination`, whose track replaces the captured one
  inside `applyEffects`.
- **The known hazard, to be settled by the spike**: an `AudioWorkletGlobalScope` cannot `fetch`, so the
  module is compiled on the main thread and the `WebAssembly.Module` handed over in `processorOptions`;
  and wasm-bindgen glue that reaches for `TextDecoder` or `performance` does not run there. Both are
  solvable and both are the reason this is a spike before it is a slice.
- **Budget**: RNNoise runs ~60× faster than real time on a native x86 CPU, so even a heavy WebAssembly
  penalty leaves an enormous margin; the bar is simply that the worklet never underruns and that the
  added latency stays within one render quantum.

No consent question arises here. The C version (`jitsi/rnnoise-wasm`) is recorded as **M2** for the
record — the option we did not take and why — and is not proposed.

---

## 8. Settings: per member, remembered

One persisted preference, through the existing primitive
(`apps/web/src/lib/preferences/persisted-preference.svelte.ts`), key `meetings.effects`:

```
{ background: "none" | "blur", reduceNoise: boolean }   // default: { background: "none", reduceNoise: true }
```

**Per browser, not per member on the server, and deliberately.** Whether an effect is even possible is a
fact about _this machine_ — its camera, its driver, its GPU, its cores. A preference that followed a
member from a workstation that can blur to a laptop that cannot would arrive as a promise the second
machine cannot keep. The settings convention
([`docs/conventions/settings.md`](../conventions/settings.md)) is not contradicted: this is not a firm
setting and not a work preference, it is a device capability choice, which is the same class as the
sidebar's `expandOnHover`. If the firm ever wants "I always blur" to follow a person, it becomes a
`member`-row setting whose local value stays the override, and the storage key is the only thing that
moves.

The stored value is applied at `publish()` and re-applied on every rejoin, so a member who blurs once is
blurred every time on that machine without touching the menu again.

## 9. The screen

One new control and one new panel, both in the existing control bar
(`apps/web/src/lib/meetings/meeting-controls.svelte`), **beside the camera control** and before screen
share:

- **Trigger**: a `dropdown-menu` on the design system's `Button`, Lucide `sliders-horizontal`, tooltip
  "Effects", `aria-haspopup="menu"`. It is present in a call as well as a meeting, because a call has
  audio effects and no camera — in a call the panel simply has no background section.
- **Background** (video meetings only): `choice-row` entries **None** and **Blur**, current one marked.
  Where the probe says `platform-controlled`, the section is one line of text naming the current state
  and where it is set. Where it says `unavailable`, the section is one line: "Background blur is not
  available in this browser." No inert control in either case.
- **Microphone**: a `switch`, "Reduce background noise", whose position is read from the track rather
  than from the preference, and beneath it one line of plain text stating what the browser reported —
  "Your browser is also cancelling echo and managing gain", or "Your browser decides this and does not
  report it". Toggling calls `applyConstraints` and re-reads; a refusal shows in the panel's own band
  (`failure-band`), never a toast.
- Design system components only, Lucide icons only, no raw CSS, no emoji — golden rule 2.

The room's tile grid, roster rail and every other surface are untouched.

## 10. Testing

| Test                                                          | Asserts                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/test/media-effects.test.ts` (new)                   | `captureConstraints` asks for the three audio constraints as plain booleans and never `exact`; `voiceIsolation` only where supported; a call asks for no video                              |
|                                                               | `readAudioTreatment` returns `null`, not `false`, for a setting the fake track does not report                                                                                              |
|                                                               | `readBlurCapability` maps two values to `controllable`, one to `platform-controlled`, absent to `unavailable`                                                                               |
|                                                               | `passThroughEffects().applyEffects(stream)` returns the same stream object and stops nothing                                                                                                |
|                                                               | `update()` on a `controllable` track calls `applyConstraints` and re-reads; a rejection becomes a `refusal` string and leaves the effect off                                                |
|                                                               | `setSourceEnabled(false)` reaches the **source** track, not only the published one                                                                                                          |
| `apps/web/test/meeting-client.test.ts` (existing, extended)   | `publish()` routes the captured stream through the injected stage and publishes what the stage returned; a stage that throws leaves the member capturing unprocessed rather than not at all |
| `apps/web/test/meeting-controls.test.ts` (existing, extended) | The Effects trigger is present in a meeting and in a call; the unavailable case draws text and no control; the switch reflects the track and not the preference                             |
| `apps/web/test/meeting-effects-preference.test.ts` (new)      | The preference round-trips, defaults to no background and noise reduction on, and survives a corrupt stored payload                                                                         |
| Slice 2 spike (not a product test)                            | The five numbers in section 6.3, recorded in the research note as an amendment                                                                                                              |

Every one of these runs without a camera, a microphone or a browser — which is the reason the seam is
shaped the way it is.

## 11. Files touched

Nothing outside `apps/web` in slice 1. Nothing at all in the api-worker, the schema, the OpenAPI
contract or the room protocol, in any slice.

**Slice 1**

| File                                                                        | Change                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/meetings/media-effects.ts`                                | **New.** The seam, the constraint builder, the read-backs, `passThroughEffects`                                                                                                                                                         |
| `apps/web/src/lib/meetings/meeting-effects-preference.svelte.ts`            | **New.** The persisted preference                                                                                                                                                                                                       |
| `apps/web/src/lib/meetings/meeting-client.svelte.ts`                        | `MeetingClientSeams` gains `createMediaEffects`; `publish()` captures through the constraint builder and the stage; `appliedEffects` state; `leave()` closes the stage; `toggleCamera`/`toggleMicrophone` go through `setSourceEnabled` |
| `apps/web/src/lib/meetings/meeting-controls.svelte`                         | The Effects trigger and panel                                                                                                                                                                                                           |
| `apps/web/src/routes/(app)/meetings/[id]/+page.svelte`                      | Wires the preference and `appliedEffects` into the control bar                                                                                                                                                                          |
| `apps/web/test/media-effects.test.ts`, `meeting-effects-preference.test.ts` | **New.**                                                                                                                                                                                                                                |
| `apps/web/test/meeting-client.test.ts`, `meeting-controls.test.ts`          | Extended                                                                                                                                                                                                                                |
| `docs/user/` (the meetings guide)                                           | One section: what the effects do, and why blur may not be offered                                                                                                                                                                       |
| `roadmap.d/meetings.md`                                                     | `meetings.backgrounds-and-noise` to `in-build`, then `partial`                                                                                                                                                                          |
| `changelog.d/<slug>.md`, `status.d/<slice>.md`                              | Fragments, per golden rule 5                                                                                                                                                                                                            |

**Slice 2** adds `crates/segmentation-core/` (or the TensorFlow.js dependency instead),
`packages/segmentation/` with its own `CLAUDE.md`, the model as a build input, a Worker under
`apps/web/src/lib/meetings/`, a WebGL2 composite module, and entries in
`tooling/bootstrap/index.mjs`'s artefact list. **Slice 3** adds `crates/audio-denoise-core/` and
`packages/audio-denoise/` with its `CLAUDE.md`, plus the worklet.

## 12. Cost

**Nothing recurring.** No container, no queue, no model hosting, no vendor. The routing-service traffic
is byte-for-byte what it was — the effect changes what the pixels look like, not how many there are.
The only costs are the download of a WebAssembly module and a model, once per member per version, from
the same origin the application already serves.

## 13. Flag register

| Flag   | Question                                                                                                                                                                                    | Gates                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **M1** | Adopt MediaPipe — C++ compiled to WebAssembly — for background blur if, and only if, both memory-safe runtimes miss the frame budget? Full wording in 6.4                                   | Slice 2's fallback, and nothing else    |
| **M2** | Recorded, not asked: `jitsi/rnnoise-wasm` (C through Emscripten) is the industry path for noise suppression and is **not** proposed, because `nnnoiseless` is the same network in safe Rust | Nothing — the memory-safe path is taken |

M1 is carried on the ledger node as `awaiting-owner`, so it reaches the decision desk rather than
sitting in a document. Neither flag blocks slice 1, which is why slice 1 is separable and goes first.
