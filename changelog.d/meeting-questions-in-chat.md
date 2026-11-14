---
category: Changed
audience: public
---

**Meeting questions are part of chat, and a meeting's picture no longer flashes when a tile is re-rendered.** The chat panel takes the question queue and draws questions in its timeline (`chatTimeline`), with an All / Questions filter and an "Ask as a question" box; the side panel's Q&A tab and the control bar's Q&A button are gone from the member's room. A tile now sets `srcObject` only when the stream is a different one and clears it only on teardown, and the video keeps one compositing layer whether or not it is mirrored. Copy Diagnostics gains `picture`, `camera-track` and `view` events.

## Public

Questions in a meeting now live in the chat. Tick Ask as a question to ask one, and use Questions at the top of the chat to see only the questions. We also fixed a brief flash in the meeting picture, and Copy Diagnostics now notes what the screen did with the pictures, so a flash that still happens can be traced.
