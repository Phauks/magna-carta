---
category: Added
audience: public
---

**Background blur and image backgrounds in meetings, drawn by the product in any browser with WebGL 2 in a Worker.** `apps/web/src/lib/meetings/effects/background-effects.worker.ts` loads `@magna-carta/segmentation`, segments each camera frame at 256 by 144, steadies the mask across frames, and composites a mask-weighted blur (no halo of the person spread into the room) or a cover-fitted picture in WebGL 2. Frames reach it as `MediaStreamTrackProcessor`/`MediaStreamTrackGenerator` streams where the browser has them (nothing on the main thread), and as one `ImageBitmap` per frame through a hidden video element elsewhere (`effects/background-processor.ts`). `client/background-effects.ts` wraps the pass-through stage: the camera's own track is published until an effect is chosen, and the treated one is swapped in and out with `RTCRtpSender.replaceTrack` through the new `EffectedCapture.onChange`, so no offer is renegotiated and a member with no effect pays nothing. A treatment that cannot start or stops mid-meeting falls back to the camera with the reason in the panel. The chosen picture is cut down to 1920 by 1080 and kept in IndexedDB (`effects/background-image-store.ts`), never uploaded. The Effects popover offers None, Blur and Image. `rust-wasm-build-segmentation` joins the deploy composite and the interface Worker's build. Checked in headless Chromium with a fake camera playing a portrait, on both frame routes.

## Public

**Blur your background or stand in front of a picture in meetings.** Open **Effects** in a meeting and choose **None**, **Blur** or **Image**. **Image** asks for a picture from your computer the first time and remembers it on that computer. The picture never leaves your browser: everyone else sees you in front of it, and nobody receives the file. This now works in any up-to-date browser, not only where the camera offers its own blur.
