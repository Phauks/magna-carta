---
category: Changed
audience: public
---

**Connection Details in a meeting say what the numbers mean, and which server the meeting runs through.** The panel shows the Cloudflare site (read from `/cdn-cgi/trace` when the panel first opens) and the media server end of the candidate pair in use (direct or relayed, UDP or TCP, its address), the picture in pixels, the camera size in words ("Full size" rather than `f`), what each quality reading means, and Upload and Download over every stream (`ConnectionSample.uploadBitsPerSecond` / `downloadBitsPerSecond`). The empty-room line and the event rail are gone; the wire events stay in Copy Diagnostics, which gains upload, download and the transport. The camera's three sizes are capped at 1.2 Mbit/s, 350 kbit/s and 120 kbit/s.

## Public

Connection Details in a meeting are easier to read. They show which Cloudflare site your meeting runs through, your picture size in pixels, your upload and download, and what Good, Fair and Poor mean. Your camera now uses less upload: about 1.7 Mbit/s at most, down from about 2.5 Mbit/s.
