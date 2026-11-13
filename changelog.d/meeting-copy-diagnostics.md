---
category: Added
audience: public
---

**Connection Details in a meeting has Copy Diagnostics.** `diagnostic-text.ts` turns the diagnostics' five-minute sample window into plain text. For each incoming picture it gives the frames received, decoded and dropped over the window, the freezes and how long they lasted, packet loss, jitter, average buffer wait, and PLI and NACK counts. For the camera it gives the layer, resolution, frame rate, bitrate and `qualityLimitationReason`. The browser, processor count, background effect and layout are included, then the wire events. `connection-quality.ts` now reads those counters, and they stay optional because not every browser reports them. Participants appear by handle, never by name.

## Public

**When a meeting's video stutters or freezes, open Connection Details and press Copy Diagnostics.** It copies what each picture did over the last few minutes, so you can paste it into a message to whoever is helping. It contains numbers only, no names and nothing anyone said.
