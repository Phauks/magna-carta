---
category: Added
audience: public
---

**The browser is asked for a treated microphone, and the room says what it got.** `publish()` in
`apps/web/src/lib/meetings/client/meeting-client.svelte.ts` captures through the constraint builder
in `client/media-effects.ts`: noise suppression, echo cancellation and gain control asked for as
plain booleans, never `{ exact: true }`, because an exact constraint a device cannot meet rejects
the whole capture and a member with no microphone is worse than one with an untreated microphone.
`readAudioTreatment` reads back from the track what the browser actually applied, three-valued
(true, false, or not reported), and `readBlurCapability` probes the platform's own background blur
and answers controllable, platform-controlled or unavailable. The `MediaEffects` seam sits between
capture and publish with a pass-through stage, so the picture and sound slices swap in one place.
The preference is remembered per member. The Effects popover in the control bar draws no control
that cannot act: where the browser offers no blur, one sentence says so.

## Public

Meetings now ask your browser to reduce background noise, cancel echo and level your microphone,
and the Effects control beside the camera shows what your browser actually applied. Where your
computer offers its own background blur, you can turn it on from the same place; where it does
not, the control says so rather than offering something that would not work.
