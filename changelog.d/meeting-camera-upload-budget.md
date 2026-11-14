---
category: Fixed
audience: public
---

**The camera's upload is held to its ceilings, and drops while you are alone.** A live meeting in Chrome sent the full camera layer at 2.55 Mbit/s against a 1.2 Mbit/s ceiling: the `maxBitrate` asked for in `addTransceiver` did not survive negotiation. `applyCameraSendBudget` (`apps/web/src/lib/meetings/client/capture.ts`) now writes the ceilings onto the sender with `setParameters` after each answer and roster, sends only the quarter layer while nobody else is in the room (not while recording), and holds a single-encoding connection to the full layer's ceiling. Copy Diagnostics names layers in words ("full size") and no longer prints "not reported times".

## Public

Your camera uses less of your internet upload in a meeting: at most about 1.7 Mb/s, and only a small fraction while you are alone in the room. Copied connection diagnostics now say "full size" rather than "layer f".
