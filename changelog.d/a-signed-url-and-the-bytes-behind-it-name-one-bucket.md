---
category: Fixed
audience: internal
---

A download or conversion result is checked for in the same bucket the URL handed back addresses.

`files/firm-bucket.ts` resolves a firm's storage as a pair — the name a presigned URL addresses, and the handle the Worker reads through — because presigning against one bucket while reading through another is silent data loss. Five call sites took the name and then reached for the bound binding anyway, which is the exact split the seam exists to prevent.

The bundle and conversion progress resolvers took a bare `bucketName`, signed a URL against it, and asked the bound binding whether the artifact was still there. So did the ZIP download route, for both its cached-artifact fast paths and the inline stream, and the bundle build consumer for the bytes it reads and the artifact it writes. Today the guard's refusal hides this, because a firm whose bucket is not the bound one cannot get that far. Once a firm resolves to its own bucket, the same code would report a live artifact `expired`, or hand back a signed URL for an object it had confirmed in a different bucket.

All five now take the pair, and the two job coordinators resolve it through the same seam rather than reading the binding off their own `env`. The name a URL is signed against and the handle its bytes come from are one decision again.
