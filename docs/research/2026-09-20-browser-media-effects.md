# Browser media effects — background blur and noise suppression, under the memory-safety rule

**Date:** 2026-09-20. Every source below was read on that date; where a page carries its own date it
is given beside the link, because the whole question here turns on what is true **now**.
**Scope:** What it would take to give a meeting a blurred or replaced background and a cleaner
microphone, in the browser, on the local track before it is published — which browser APIs exist to
reach the pixels and the samples, which segmentation and denoising runtimes exist, **what language
each one is written in**, and which of them a platform bound by golden rule 14 may actually adopt.
**Purpose:** Research, not a spec and not a decision. **Nothing here is built.** The design that
follows from it is
[`docs/specs/2026-09-20-meetings-media-effects-design.md`](../specs/2026-09-20-meetings-media-effects-design.md);
the capability is `meetings.backgrounds-and-noise` in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md).
**The rule this note exists to answer to:** golden rule 14 in [`CLAUDE.md`](../../CLAUDE.md) —
memory-safe languages by default, and a C or C++ dependency **including C compiled to WebAssembly**
only where there is no legitimate Rust or TypeScript alternative, and then only with the owner's
explicit consent, surfaced and asked rather than adopted. Almost every published way of doing
background blur in a browser is C++ compiled to WebAssembly. That is the finding this note is
organised around.
**White-paper context:** _Communications layer_ — binding, not restated. Parent design:
[`docs/specs/2026-09-18-meetings-design.md`](../specs/2026-09-18-meetings-design.md), whose section on
what the browser captures and publishes is the seam everything here plugs into.

---

## 1. Summary

Five findings, in the order they decide anything.

1. **The audio half costs no dependency at all, and is being left on the table today.** The browser's
   own `noiseSuppression`, `echoCancellation` and `autoGainControl` capture constraints are
   implemented by Chrome, Edge and Firefox, cost nothing, ship nothing, and run in the browser's own
   audio pipeline. The meeting client asks for none of them — it captures with
   `{ audio: true, video: wantsPicture }`
   ([`apps/web/src/lib/meetings/meeting-client.svelte.ts`](../../apps/web/src/lib/meetings/meeting-client.svelte.ts)),
   which takes whatever each browser happens to default to and tells the member nothing about what
   they got.
2. **The platform-provided background blur is not a path.** Chrome's `backgroundBlur` constraint —
   the one that would need no model at all — never shipped. It was an origin trial in Chrome 112–117
   and its Chrome Platform Status entry has not moved since 2023-11-21; the documented way to see it
   is still an experimental-features flag. It can be probed for and used where it exists, and it will
   be absent almost everywhere.
3. **Every widely-used way to run the segmentation model is C++ compiled to WebAssembly.** MediaPipe,
   ONNX Runtime Web, Transformers.js (which runs on ONNX Runtime Web) and the TensorFlow.js **wasm**
   backend (XNNPACK) are all, underneath, C or C++ through Emscripten. Under golden rule 14 each of
   them is a consent question, not a choice.
4. **Two memory-safe paths exist, and neither is proven for this workload.** TensorFlow.js with the
   **WebGL** backend runs the same MediaPipe selfie-segmentation model through TypeScript and GLSL
   shaders with no C or C++ in the shipped artefact — it is the memory-safe alternative rule 14 asks
   whether there is, and its drawback is that TensorFlow.js has not cut a release since 2024-10-21.
   The pure-Rust runtimes `rten` (0.26.0, updated 2026-08-29) and `tract` (0.23.7, updated
   2026-09-08) compile to WebAssembly with SIMD and would sit on this repository's own
   Rust-to-WebAssembly precedent (`crates/` → `packages/*/src/pkg/`), but **nobody has published a
   frame rate for a segmentation model in a browser on either of them**. That number has to be
   measured here before anything is built on it.
5. **The noise-suppression question has a clean Rust answer.** RNNoise is C, and every browser build
   of it — Jitsi's included — is that C through Emscripten. `nnnoiseless` is a safe-Rust port of the
   same network under the same BSD-3-Clause licence, version 0.5.2 (2025-12-18), whose required
   dependencies are two pure-Rust crates. An AudioWorklet running a Rust-to-WebAssembly denoiser is
   the memory-safe version of exactly what Jitsi ships.

**What this points at.** A first slice that asks the browser for what it already has and shows the
member what it answered, and a second slice that is a measurement before it is a build: the
pure-Rust runtime first, the TypeScript-and-WebGL runtime as the fallback that is also memory-safe,
and the C-compiled-to-WebAssembly option named, priced and **asked about** rather than adopted. The
one question that would have to reach the owner is stated in section 7 and carried on the ledger
node as `awaiting-owner`.

---

## 2. What the browser already gives away — the capture constraints

### 2.1 The three audio constraints

`getUserMedia` takes `noiseSuppression`, `echoCancellation` and `autoGainControl` as
`ConstrainBoolean`s. Passed as a plain boolean the browser tries and does not fail; passed as
`{ exact: true }` it fails when it cannot comply
([MDN, `MediaTrackConstraints.noiseSuppression`](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression)).
MDN files the feature as "limited availability", which is the honest summary: the constraint is
universal in name and uneven in effect.

What is actually implemented, measured browser by browser by addpipe's long-running audio-constraints
test page (last updated 2026-05-21,
[getUserMedia() Audio Constraints](https://blog.addpipe.com/getusermedia-audio-constraints/)):

| Constraint         | Chrome                                        | Firefox               | Safari                |
| ------------------ | --------------------------------------------- | --------------------- | --------------------- |
| `echoCancellation` | works, on by default                          | works, on by default  | works since Safari 11 |
| `noiseSuppression` | applied, but not controllable as a constraint | works, on by default  | not supported         |
| `autoGainControl`  | applied, but not controllable as a constraint | works, off by default | not supported         |

Two practical rules fall out of that page and are worth carrying into the design verbatim. First,
**`getSupportedConstraints()` lies** — the author abandoned it for `MediaStreamTrack.getSettings()`
because it "returns too many false positives". Second, **the only truthful answer is the read-back**:
ask for the three, then read `track.getSettings()` and say what the browser actually did.

### 2.2 `voiceIsolation` — the stronger one, where the platform has it

A fourth constraint, `voiceIsolation`, asks the platform for speech isolation rather than
conventional noise suppression. Chrome's intent to ship is dated 2024-01-26 and named M123
([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/hPMvCu-3iPA)); the Chrome
Platform Status entry records it shipped on desktop and not on Android, with Firefox and Safari
both at "no signal"
([chromestatus 5106413661847552](https://chromestatus.com/feature/5106413661847552)). The intent is
explicit that it "only takes effect on platforms where there is low-level support for
voice-isolation style denoising", which at the time was a set of ChromeOS devices. So it is worth
asking for and worthless to depend on: request it, read it back, say nothing to the member when it
did not take.

Underneath it is the same machinery the operating systems now ship for themselves — Windows Studio
Effects' voice focus, macOS's Voice Isolation — which is also why asking the platform first is the
cheapest quality win available.

### 2.3 `backgroundBlur` — the effect that would need no model, and does not exist

Chrome's `backgroundBlur` proposal puts platform background concealment behind a constrainable
property: `track.getCapabilities().backgroundBlur` returns a sequence, and only a sequence of **two**
values means the page may toggle it with `applyConstraints()`; one value or none means observe-only
([Chrome for Developers, "Blur camera background", last updated 2023-05-02](https://developer.chrome.com/blog/background-blur);
[explainer](https://github.com/riju/backgroundBlur/blob/main/explainer.md)).

Its status is the decisive fact, and it is not good:

- Chrome Platform Status lists `background-blur` (feature 5077577782263808) as **origin trial**,
  desktop milestones **114–117**, last updated **2023-11-21**. It is not enabled by default; the
  Chrome blog's instruction is still to turn on `chrome://flags/#enable-experimental-web-platform-features`.
- The live Chrome work in this area is a different, read-only API — "Camera Effects Status:
  Background Blur" (feature 5098450535055360, in development, last updated **2025-09-05**), which
  exposes whether the platform is blurring on `VideoFrameMetadata` and explicitly does **not** offer
  control ([explainer](https://markafoltz.github.io/camera-effects/)).
- Control was only ever going to exist on some platforms anyway. The explainer records that Windows
  needs driver-level background segmentation, and that **on Apple devices background blur is
  controlled globally from Control Centre and no application can toggle it**.
- Firefox and Safari both filed **positive** standards positions on the original proposal
  (chromestatus, above), which is a reason to keep the probe in the code and no reason to expect it
  to answer.

Verdict: a capability probe, used where it answers, and a "not available in this browser" everywhere
else. It cannot be the feature.

---

## 3. Getting at the pixels — four routes, one that works everywhere

### 3.1 Insertable streams (`MediaStreamTrackProcessor` / `VideoTrackGenerator`)

The purpose-built API: a processor turns a track into a `ReadableStream<VideoFrame>`, a generator
turns a stream of frames back into a track
([W3C, MediaStreamTrack Insertable Media Processing using Streams](https://www.w3.org/TR/mediacapture-transform)).
It is also the most fragmented surface on the platform, and the fragmentation is structural rather
than a matter of waiting:

| Engine        | What it has                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome / Edge | `MediaStreamTrackProcessor` **and** `MediaStreamTrackGenerator` since **94**, exposed on `Window` rather than a worker, audio as well as video. `VideoTrackGenerator`: not supported.            |
| Safari        | The standard pair — `MediaStreamTrackProcessor` and `VideoTrackGenerator` — since **18**, worker-only, video-only.                                                                               |
| Firefox       | Neither. The shipping bug, [bugzilla 1749532](https://bugzilla.mozilla.org/show_bug.cgi?id=1749532), is still **NEW**, with no target milestone, and was last touched six days before this note. |

(Browser versions from the MDN compatibility data for
[`MediaStreamTrackProcessor`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaStreamTrackProcessor.json),
[`MediaStreamTrackGenerator`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaStreamTrackGenerator.json)
and [`VideoTrackGenerator`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/VideoTrackGenerator.json);
caniuse puts the standard form at [14% of global users](https://caniuse.com/wf-insertable-streams),
Safari only.)

Mozilla's own account of the split ([Advancing WebRTC, 2024-09-20](https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/))
is the clearest statement of why the two shapes are incompatible: Chrome's generator **is** a track;
the standard generator **has** a track. The standard form is deliberately worker-only and video-only,
so the browser's realtime media pipeline is never blocked on a busy main thread — and Mozilla's
position is that audio already has the better tool, `AudioWorklet`.

### 3.2 The route that works in every browser the product supports

`<video>` → `requestVideoFrameCallback` → draw to a canvas (2D or WebGL2) → `canvas.captureStream()`
→ `RTCRtpSender.replaceTrack()`. Every part of it is old:

| API                                          | Chrome | Firefox | Safari |
| -------------------------------------------- | ------ | ------- | ------ |
| `HTMLCanvasElement.captureStream`            | 51     | 43      | 11     |
| `HTMLVideoElement.requestVideoFrameCallback` | 83     | 132     | 15.4   |

(MDN compatibility data:
[`HTMLCanvasElement`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLCanvasElement.json),
[`HTMLVideoElement`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLVideoElement.json).)

This is also what Google Meet does: segment to a low-resolution mask, optionally refine it, then
**render through WebGL2** with the background blurred or replaced
([Google Research, 2020-10-30](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)).
The rendering half of this feature is settled technology; the inference half is the whole question.

### 3.3 GPU availability, for the runtimes that want one

WebGL2 is everywhere. WebGPU is not yet: Chrome shipped it in **113** (2023-05, initially ChromeOS,
macOS and Windows — [Chrome ships WebGPU](https://developer.chrome.com/blog/webgpu-release)), Safari
in **26**, Firefox in **141** on Windows first, with macOS on Apple silicon from 145 and no Linux
(MDN compatibility data for [`GPU`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GPU.json)).
So a design may _prefer_ WebGPU and may not _require_ it.

### 3.4 Where this lands in our client

The client already keeps every browser edge behind an injected seam (`MeetingClientSeams`:
`getUserMedia`, `getDisplayMedia`, `createMediaStream`, `createAudioLevelMeter`), and `publish()`
captures and then adds a transceiver per track. An effects stage is therefore a pure function
between those two statements, not a change of architecture — which is what makes it testable with a
fake track. The design spec draws it.

---

## 4. The model, and everything that could run it

### 4.1 The model is small and is not the problem

MediaPipe's **SelfieSegmenter** is the reference: a MobileNetV3-like encoder with a custom decoder,
**106K parameters**, two variants — square `256 × 256` and landscape `144 × 256` — with published
reference latencies of **33.46 ms** and **34.19 ms** on CPU
([Image segmentation task overview, last updated 2026-08-17](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)).
The `.tflite` file is a few hundred kilobytes: ~244 KB for the landscape variant, ~450 KB for the
general one ([Qualcomm AI Hub model card](https://aihub.qualcomm.com/models/mediapipe_selfie),
[the MediaPipe model card PDF](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)).

Meet's own published figures for the same shape of model are the sanity check on what "real time"
costs: **8.3 ms inference, 14.3 ms for the whole pipeline (70 fps)** on a 2018 MacBook Pro at
`256 × 144`, and **16.1 ms** on an Acer Chromebook 11 at `160 × 96`
([Google Research, 2020-10-30](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)).
Note what that means: the inference runs at a **fraction of the capture resolution** and the mask is
upsampled. Nothing here runs a network at 720p.

### 4.2 The runtimes, and what each one is written in

This is the table the rule turns on.

| Runtime                                                                  | What actually executes                                                                 | Language of the shipped artefact                                                          | Rule 14 verdict                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision` 1.0.1, Apache-2.0) | `vision_wasm_internal.wasm` plus a no-SIMD variant, loaded beside a `.tflite` model    | **C++** (MediaPipe framework and calculators) through Emscripten, over TFLite and XNNPACK | **Consent question.** Not adoptable without it      |
| **TensorFlow.js `wasm` backend**                                         | `tfjs-backend-wasm.wasm` in vanilla / SIMD / threaded-SIMD builds                      | **C++** via the Bazel Emscripten toolchain, built on XNNPACK                              | **Consent question**                                |
| **TensorFlow.js `webgl` / `webgpu` backends**                            | TypeScript, executing GLSL/WGSL shaders on the GPU; model weights are data             | **TypeScript** (its only runtime dependency is `seedrandom`)                              | **Permitted** — this is the memory-safe alternative |
| **ONNX Runtime Web**                                                     | The ONNX Runtime core compiled to WebAssembly (the `wasm`/`cpu` backend)               | **C++** — the documented build installs emsdk and compiles the C++ core                   | **Consent question**                                |
| **Transformers.js**                                                      | "Transformers.js uses ONNX Runtime to run models in the browser"                       | **C++**, transitively, by the row above                                                   | **Consent question**                                |
| **`rten`** 0.26.0 (MIT OR Apache-2.0, updated 2026-08-29)                | A pure-Rust ONNX runtime compiled to `wasm32` with WebAssembly SIMD; CPU only          | **Rust** — "this project and all of its required dependencies are written in Rust"        | **Permitted**                                       |
| **`tract`** 0.23.7 (MIT OR Apache-2.0, updated 2026-09-08)               | Sonos' self-contained inference engine; loads ONNX, NNEF and **TFLite**; wasm32 target | **Rust**                                                                                  | **Permitted**                                       |
| **`wonnx`** 0.5.1                                                        | A 100%-Rust WebGPU ONNX runtime                                                        | **Rust**                                                                                  | Permitted but **stalled** — last release 2023-09-30 |

Sources, in order: [`@mediapipe/tasks-vision` on the npm registry](https://registry.npmjs.org/@mediapipe/tasks-vision/latest)
(version 1.0.1, Apache-2.0, 14 files, 36.8 MB unpacked, exporting the vision bundles and both WASM
variants) with [the web guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js)
(last updated 2026-08-17) and [MediaPipe Framework in C++](https://developers.google.com/edge/mediapipe/framework/getting_started/cpp)
(last updated 2026-08-28);
[tfjs-backend-wasm README](https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-wasm/README.md)
("our WASM backend builds on top of the XNNPACK library", Emscripten managed by the Bazel toolchain)
and [XNNPACK](https://github.com/google/XNNPACK) (C++17, C11 and assembly; consumed by TFLite,
TensorFlow.js's WebAssembly backend and MediaPipe alike);
[the tfjs-backend-webgl package metadata](https://registry.npmjs.org/@tensorflow/tfjs-backend-webgl)
(4.22.0, Apache-2.0, dependencies `seedrandom` and type packages only);
[ONNX Runtime "Build for web"](https://onnxruntime.ai/docs/build/web.html) (emsdk, CMake, the C++
core); [Transformers.js](https://huggingface.co/docs/transformers.js/index);
[rten](https://github.com/robertknight/rten) and [its crate metadata](https://crates.io/api/v1/crates/rten);
[tract-onnx metadata](https://crates.io/api/v1/crates/tract-onnx);
[wonnx metadata](https://crates.io/api/v1/crates/wonnx).

### 4.3 The memory-safe TypeScript path is real, and it runs the same model

The TensorFlow.js models repository ships MediaPipe SelfieSegmentation with **two runtimes**: the
`mediapipe` runtime, which loads the C++ WebAssembly bundle, and the **`tfjs` runtime**, which needs
only `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter` and a registered backend — the documented
example registering `@tensorflow/tfjs-backend-webgl` — with the same `general` (256×256×3) and
`landscape` (144×256×3) variants
([body-segmentation, selfie_segmentation_tfjs](https://github.com/tensorflow/tfjs-models/blob/master/body-segmentation/src/selfie_segmentation_tfjs/README.md)).
Same model, no C++, GPU-executed.

Its two costs are honest ones. **The project has stopped moving**: the most recent TensorFlow.js
release is `tfjs-v4.22.0`, **2024-10-21** ([releases](https://github.com/tensorflow/tfjs/releases)),
which is nearly two years stale as this is written and sits awkwardly beside golden rule 11's
"implement on the latest". And it is a large JavaScript dependency to carry for one effect.

### 4.4 The pure-Rust path is plausible and unmeasured

The state of Rust inference, from the survey at
[arewelearningyet.com/inference](https://arewelearningyet.com/inference/) (last updated
**2026-09-14**): `rten` 0.26.0 is a pure-Rust ONNX runtime with "no C++ dependency at all", AVX-512,
NEON and **WASM-SIMD kernels**, CPU only, in production behind the `ocrs` OCR engine; `tract` 0.23.7
is Sonos' engine, in production for wake-word and streaming speech recognition; `ort` — the one with
the widest accelerator reach — is a **binding to Microsoft's C++ ONNX Runtime** and therefore not
available to us. The survey's own verdict on the browser corner is the caution to take seriously:
"browser and microcontroller projects here have largely stalled; what still works is compiling a CPU
runtime to WASM."

So the honest position is: `rten` or `tract` compiled to `wasm32` with SIMD, running SelfieSegmenter
(`tract` reads `.tflite` directly; `rten` needs an ONNX conversion) at 256×144 in a Web Worker, is a
**plausible** memory-safe implementation with **no published frame rate**. rten's own README notes
that a non-SIMD build is "significantly slower" and that SIMD needs Chrome 91+, Firefox 89+ or
Safari 16.4+ — all of which are long past. The measurement is small and must come first; the design
spec fixes what it has to return.

---

## 5. The sound: what suppresses noise, and in what language

**The browser's own suppression is the baseline, and it is free.** Section 2.1. Nothing to ship,
nothing to audit, no frame budget spent.

**RNNoise** is the reference open denoiser: a hybrid of classical signal processing and a small
recurrent network — 42 input features, 3 GRU layers, gains over 22 Bark-scale bands — whose trained
weights are about **85 kB**, under a **BSD** licence, and which runs "about 60x faster than real time
on an x86 CPU" and "about 7x faster than real time on a Raspberry Pi 3"
([Jean-Marc Valin, 2017-09-27](https://jmvalin.ca/demo/rnnoise/)). **It is written in C.**

**Every browser build of RNNoise is that C through Emscripten.** Jitsi Meet's noise suppression is
the worked example and the shape any implementation would take:
[`jitsi/rnnoise-wasm`](https://github.com/jitsi/rnnoise-wasm) compiled with emscripten, inlined with
`-s SINGLE_FILE=1` and `-s WASM_ASYNC_COMPILATION=0` so it can load synchronously inside an
**AudioWorklet**, with a ring buffer bridging the worklet's 128-sample quantum to RNNoise's 480-sample
frame ([Jitsi, 2022-07-28](https://jitsi.org/blog/enhanced-noise-suppression-in-jitsi-meet/)). They
moved to a worklet because "with noise suppression the track gets modified, so latency is
noticeable" and main-thread interference damages audio quality. Under rule 14, adopting this is a
consent question about C compiled to WebAssembly.

**`nnnoiseless` is the same network in safe Rust.** "Audio denoising, derived from Xiph's RNNoise
library", **BSD-3-Clause**, latest **0.5.2 on 2025-12-18**, ~877k downloads
([crates.io](https://crates.io/api/v1/crates/nnnoiseless)); the project describes itself as mostly
safe Rust, pure Rust, needing no libclang, and faster than the C version
([jneem/nnnoiseless](https://github.com/jneem/nnnoiseless)). Its **required** dependencies are
`easyfft` and `once_cell`; everything else — `libc`, `hdf5`, `hound`, `dasp`, `clap`, `ndarray` — is
optional and belongs to the command-line tool and the training path
([dependency list](https://crates.io/api/v1/crates/nnnoiseless/0.5.2/dependencies)). A default build
carries no C.

Two things remain unproven and are the spike, not the design: that `nnnoiseless` compiles cleanly to
`wasm32-unknown-unknown` (nothing in the required dependency pair suggests otherwise), and that it
holds real time inside an AudioWorklet's budget (RNNoise's 60× headroom on a native x86 CPU leaves a
very wide margin for a WebAssembly penalty, but margin is not a measurement).

**Krisp and the rest are proprietary SDKs** — licensed, closed, and a subscription, which is the
thing the meetings design exists to avoid
([Krisp's own comparison](https://krisp.ai/blog/krisp-noise-cancellation-comparison/)). Not
considered further.

---

## 6. What the products do — which is what "table stakes" means

- **Zoom** — background blur and virtual backgrounds with or without a green screen, with the
  no-green-screen path explicitly carrying "higher system requirements"
  ([Zoom support](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060387));
  background-noise suppression as a four-position setting — Auto, Low, Medium, High — plus Original
  Sound which turns the conditioning off, with the High setting documented as increasing CPU use.
- **Google Meet** — blur, replacement, immersive and generated backgrounds and filters, in-browser,
  on Chrome 114+, Firefox 110+, Edge 114+ and Safari 16.4+ on Mac, requiring WebGL and graphics
  acceleration ([Meet support](https://support.google.com/meet/answer/10058482)); the segmentation
  runs on the client, the **noise cancellation runs in Google's data centre** on a TPU and is limited
  to paid Workspace editions ([VentureBeat, 2020](https://venturebeat.com/ai/google-meet-noise-cancellation-ai-cloud-denoiser-g-suite)).
- **Microsoft Teams** — background blur and images in the meeting, and noise suppression as Auto (the
  default), Low, High or Off, where High "suppresses all background sound that isn't speech"; the
  support page lists desktop, mobile, Teams Rooms and AVD, and does not list the web client
  ([Microsoft support](https://support.microsoft.com/en-us/office/reduce-background-noise-in-microsoft-teams-meetings-1a9c6819-137d-4b3b-a1c8-4ab20b234c0d)).

Read together: **blur and noise suppression are table stakes** — every one of the three has both.
But note the second row. Meet, which is the closest comparable because it is a browser product,
solves the picture on the client and the sound in a data centre; Teams does not list the feature for
the browser at all. Neither is an argument for doing less; both are an argument that a browser-only
implementation is the harder half of the market, and that the client-side segmentation quality bar
was set by a team that wrote its own model.

---

## 7. What this means here

**Slice one is free and should be built first.** Ask for `noiseSuppression`, `echoCancellation` and
`autoGainControl` explicitly at capture, ask for `voiceIsolation` where the browser knows the name,
read `getSettings()` back and show the member what the browser actually did; probe
`getCapabilities().backgroundBlur` for two values and offer the platform blur where — and only
where — that probe answers. No dependency, no model, no WebAssembly, no consent question, and it
closes the audio half of table stakes for most members on most browsers.

**Slice two is a measurement before it is a build**, and the order of preference is fixed by rule 14
rather than by convenience: a Rust-to-WebAssembly runtime on this repository's own precedent first
(`rten` or `tract`, SelfieSegmenter at 256×144, in a Worker, mask upsampled and composited in WebGL2);
TensorFlow.js with the WebGL backend second, which is also memory-safe and is the proven-in-production
option; and the C-compiled-to-WebAssembly runtimes third — named, priced, and **only** if the owner
consents.

**The one consent question, if both memory-safe paths miss the budget**, stated as the owner should
read it:

> Both memory-safe ways of running background blur in the browser have been measured and neither
> holds the frame budget. The way every other product does it is MediaPipe — Google's C++ vision
> framework compiled to WebAssembly (`@mediapipe/tasks-vision`, Apache-2.0; a ~2 MB WebAssembly
> module from a 36 MB package, plus a ~250 KB model). Golden rule 14 says C or C++ compiled to
> WebAssembly needs your explicit consent. The exposure is narrow and it is not nothing: the module
> parses only our own model file and camera frames that never left this machine, it runs in the
> browser's sandbox in a Worker with no network and no storage, and nothing privileged passes
> through it. Do we adopt it for background blur alone, or do we ship without background blur and
> keep the audio effects, which need no such dependency?

Nothing in that question is being acted on. It is carried as `awaiting-owner` on
`meetings.backgrounds-and-noise` so it reaches the decision desk rather than a note nobody reads.

**And the noise-suppression half has an answer that needs no question at all**: `nnnoiseless` in an
AudioWorklet, the Rust version of what Jitsi ships, on the same `crates/` → `packages/*/src/pkg/`
path the PDF, decryption, email and seven-zip cores already take.

---

## 7a. Amendment, 2026-11-09 — the first slice-2 measurement

The owner ruled on 2026-11-09 that background blur is built memory-safely, Rust first, which is
the order the media-effects design already sets
([`docs/specs/2026-09-20-meetings-media-effects-design.md`](../specs/2026-09-20-meetings-media-effects-design.md),
_Slice 2_). The same day the owner asked for **image backgrounds** as well as blur; they use the
same mask with a different composite, so they ride the same runtime. The first measurement was
taken in a throwaway crate outside the repository, and what it found is recorded here.

**Section 4.4 was wrong about `tract`.** It said `tract` reads `.tflite` directly, so it could run
MediaPipe's SelfieSegmenter file unconverted. `tract-tflite` 0.23.10 cannot load that file. The
model's last layer is MediaPipe's own custom operator `Convolution2DTransposeBias` (a transposed
convolution with its bias fused in), and `tract-tflite` registers no custom operators, and no
`TRANSPOSE_CONV` either. Its registry is private, so a caller cannot add one.

**With that one operator added, it runs and is exact.** A 25-line handler in a patched copy of
`tract-tflite` maps the custom operator onto `tract-core`'s own `Deconv`. It reads the raw
`TfLiteTransposeConvParams` options (padding, stride width, stride height as little-endian `i32`).
It handles only the case this model uses, a kernel equal to its stride with no overlap. The
landscape model (`selfie_segmenter_landscape.tflite`, float16, 250,177 bytes) then loads and runs.
On a real portrait resized to 256 × 144, its mask matches the reference LiteRT interpreter to a
largest absolute difference of 1.4 × 10⁻⁵, and every pixel lands on the same side of 0.5. LiteRT
served as the test oracle only and is not in the artefact.

**Speed (bar 1 of the design).** Over 100 runs after 5 warm-ups, headless Chromium 153 ran
`wasm32` with SIMD128 on one thread, on a 4-vCPU cloud Xeon at 2.10 GHz:

| Measure                    | Result   | Bar        |
| -------------------------- | -------- | ---------- |
| Inference p50, 256 × 144   | 8.4 ms   |            |
| Inference p95, 256 × 144   | 13.3 ms  | ≤ 20 ms    |
| Inference max              | 16.3 ms  |            |
| Model load and plan        | 302 ms   | once, when the effect is turned on |

A cloud server is not the reference laptop that `docs/conventions/performance.md` names, so this
is evidence that bar 1 is reachable rather than a pass. Bars 2 to 5 (24 fps published at 720p,
2 ms on the main thread, 35% of a core, no flicker) need the Worker, the WebGL2 composite and a
real camera, and none of them has been measured yet.

**Size is over budget.** The release `.wasm` is 11.1 MB raw and 2.17 MB gzipped, against the
design's ≤ 1.5 MB for module plus model. It carries the whole of `tract`'s operator set and
TensorFlow Lite deserialiser. The next step is to cut it down: drop the flatbuffer loader by
building the graph from a model converted once at build time (`tract`'s own NNEF output), turn off
the features this model does not use, and run `wasm-opt -Oz`. `rten` with an ONNX conversion
stays the alternative if `tract` cannot get under the line.

**What production needs from this.** The custom-operator handler has to live somewhere the build
owns: upstream in `tract` (the preferred route, as one small pull request), or in a vendored
patch under `crates/` until then. Either way it is safe Rust, and nothing here adds C or C++.

## 8. Sources

Every source, with the date it carries and the date it was read (2026-09-20 throughout).

| Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Carries date       | Used for                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| [MDN, `MediaTrackConstraints.noiseSuppression`](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                  | The constraint's shape and read-back                                                            |
| [addpipe, getUserMedia() Audio Constraints](https://blog.addpipe.com/getusermedia-audio-constraints/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-05-21         | Per-browser reality of the three audio constraints; `getSupportedConstraints()` false positives |
| [blink-dev, Intent to Ship: VoiceIsolation](https://groups.google.com/a/chromium.org/g/blink-dev/c/hPMvCu-3iPA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 2024-01-26         | `voiceIsolation` milestone and platform limits                                                  |
| [chromestatus 5106413661847552](https://chromestatus.com/feature/5106413661847552)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                  | `voiceIsolation` shipped desktop; no Firefox/Safari signal                                      |
| [Chrome for Developers, Blur camera background](https://developer.chrome.com/blog/background-blur)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2023-05-02         | `backgroundBlur` capability shape; flag                                                         |
| [chromestatus 5077577782263808](https://chromestatus.com/feature/5077577782263808)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2023-11-21         | Origin trial 114–117; never shipped                                                             |
| [markafoltz/camera-effects](https://markafoltz.github.io/camera-effects/) + [chromestatus 5098450535055360](https://chromestatus.com/feature/5098450535055360)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 2025-09-05         | The live work is read-only effect status                                                        |
| [riju/backgroundBlur explainer](https://github.com/riju/backgroundBlur/blob/main/explainer.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                  | Windows driver requirement; Apple global control                                                |
| [W3C, MediaStreamTrack Insertable Media Processing using Streams](https://www.w3.org/TR/mediacapture-transform)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                  | The standard API                                                                                |
| [Mozilla, Unbundling MediaStreamTrackProcessor and VideoTrackGenerator](https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2024-09-20         | Why Chrome's and the standard's shapes differ                                                   |
| [bugzilla 1749532](https://bugzilla.mozilla.org/show_bug.cgi?id=1749532)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | open, NEW          | Firefox has not shipped it                                                                      |
| [caniuse, insertable streams](https://caniuse.com/wf-insertable-streams)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                  | Safari-only, ~14% of users                                                                      |
| MDN compat data: [`MediaStreamTrackProcessor`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaStreamTrackProcessor.json), [`MediaStreamTrackGenerator`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaStreamTrackGenerator.json), [`VideoTrackGenerator`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/VideoTrackGenerator.json), [`HTMLCanvasElement`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLCanvasElement.json), [`HTMLVideoElement`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLVideoElement.json), [`GPU`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/GPU.json) | —                  | Version numbers throughout                                                                      |
| [Chrome ships WebGPU](https://developer.chrome.com/blog/webgpu-release)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 2023-05-03         | WebGPU in Chrome 113                                                                            |
| [MediaPipe Image Segmenter overview](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-08-17         | SelfieSegmenter variants and reference latencies                                                |
| [MediaPipe Image Segmenter, web guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2026-08-17         | The web package and its WASM assets                                                             |
| [MediaPipe Framework in C++](https://developers.google.com/edge/mediapipe/framework/getting_started/cpp)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 2026-08-28         | The framework's language                                                                        |
| [`@mediapipe/tasks-vision` registry metadata](https://registry.npmjs.org/@mediapipe/tasks-vision/latest)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1.0.1              | Version, Apache-2.0, 36.8 MB unpacked, WASM exports                                             |
| [Qualcomm AI Hub, MediaPipe-Selfie-Segmentation](https://aihub.qualcomm.com/models/mediapipe_selfie) and [the MediaPipe model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                  | Parameter count and file size                                                                   |
| [Google Research, Background Features in Google Meet](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2020-10-30         | MobileNetV3-small at 256×144; 8.3 ms / 14.3 ms; WebGL2 rendering; light wrapping                |
| [tfjs-backend-wasm README](https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-wasm/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                  | XNNPACK, Emscripten, SIMD/threaded variants                                                     |
| [XNNPACK](https://github.com/google/XNNPACK)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                  | C++17/C11/assembly; who consumes it                                                             |
| [`@tensorflow/tfjs-backend-webgl` registry metadata](https://registry.npmjs.org/@tensorflow/tfjs-backend-webgl)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 4.22.0             | Apache-2.0; pure-JavaScript dependencies                                                        |
| [TensorFlow.js releases](https://github.com/tensorflow/tfjs/releases)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2024-10-21         | Latest release; the project's pace                                                              |
| [body-segmentation, selfie_segmentation_tfjs](https://github.com/tensorflow/tfjs-models/blob/master/body-segmentation/src/selfie_segmentation_tfjs/README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                  | The `tfjs` runtime and its packages                                                             |
| [ONNX Runtime, Build for web](https://onnxruntime.ai/docs/build/web.html)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                  | emsdk; the C++ core compiled to WebAssembly                                                     |
| [Transformers.js](https://huggingface.co/docs/transformers.js/index)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  | "uses ONNX Runtime to run models in the browser"                                                |
| [rten](https://github.com/robertknight/rten) + [crate metadata](https://crates.io/api/v1/crates/rten)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0.26.0, 2026-08-29 | End-to-end Rust; WASM SIMD; MIT/Apache-2.0                                                      |
| [tract-onnx crate metadata](https://crates.io/api/v1/crates/tract-onnx)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0.23.7, 2026-09-08 | Version, licence, pace                                                                          |
| [wonnx crate metadata](https://crates.io/api/v1/crates/wonnx)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0.5.1, 2023-09-30  | Stalled                                                                                         |
| [Are we learning yet — inference](https://arewelearningyet.com/inference/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 2026-09-14         | The Rust runtime survey and the browser caution                                                 |
| [RNNoise](https://jmvalin.ca/demo/rnnoise/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2017-09-27         | C; BSD; 85 kB of weights; 60× real time                                                         |
| [jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm) + [Jitsi blog](https://jitsi.org/blog/enhanced-noise-suppression-in-jitsi-meet/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 2022-07-28         | The Emscripten + AudioWorklet worked example                                                    |
| [nnnoiseless](https://github.com/jneem/nnnoiseless) + [crate metadata](https://crates.io/api/v1/crates/nnnoiseless) + [dependencies](https://crates.io/api/v1/crates/nnnoiseless/0.5.2/dependencies)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0.5.2, 2025-12-18  | Safe-Rust port; BSD-3-Clause; pure-Rust required dependencies                                   |
| [Zoom, virtual backgrounds](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060387)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                  | Blur and replacement; system requirements                                                       |
| [Google Meet, change your background](https://support.google.com/meet/answer/10058482)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                  | Browser matrix and WebGL requirement                                                            |
| [VentureBeat, Meet noise cancellation](https://venturebeat.com/ai/google-meet-noise-cancellation-ai-cloud-denoiser-g-suite)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2020               | Meet's denoiser runs in the data centre                                                         |
| [Microsoft, reduce background noise in Teams](https://support.microsoft.com/en-us/office/reduce-background-noise-in-microsoft-teams-meetings-1a9c6819-137d-4b3b-a1c8-4ab20b234c0d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                  | Auto/Low/High/Off; clients listed                                                               |
| [Krisp comparison](https://krisp.ai/blog/krisp-noise-cancellation-comparison/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                  | The proprietary option, recorded and declined                                                   |
