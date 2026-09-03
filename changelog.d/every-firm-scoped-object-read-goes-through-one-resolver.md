---
category: Changed
audience: internal
---

Every read and write of a firm's objects resolves the firm's bucket through one seam.

`src/files/firm-bucket.ts` is the one home for "which bucket holds this firm's bytes", and it answers as a pair: the name a presigned URL addresses, and the handle the Worker reads through. Twenty-one modules reached the bound binding directly instead, past that resolver. Eight of them were genuinely a firm's bytes — the email capture consumer, preview delivery, the search index consumer and its compaction sweep, the natural-language feed, the storage tiering sweep, the WOPI host, and the document editing session — and now resolve through the seam.

Several already had the answer and did not use it. The capture consumer carried the bucket name on its own message and passed it to attachment extraction while reading through the binding. The preview delivery token has carried a `bucket` field all along, with a comment calling it a forward seam. The tiering sweep's comment described this exact change as future work.

The seam grew a second entry point for callers holding only a firm id — a queue consumer whose message predates any bucket field — so nothing needed a new message field to be correct.

Four modules keep the binding because their bytes belong to the platform or to local development: the status reachability probe, the development presigner's staging objects, the development upload leg, and the development seeder. `pnpm run lint:firm-bucket-seam` fails any new direct use, and fails a stale allow-list entry too, so an exemption cannot outlive its reason.
