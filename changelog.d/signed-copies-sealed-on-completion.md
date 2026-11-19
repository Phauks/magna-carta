---
category: Added
audience: public
---

**A signed copy is sealed and filed when everyone has signed.** The finish that completes a signing request raises `signing.completed`; the per-firm queue hands it to `apps/api-worker/src/signing/seal-completed.ts`, and the hourly signing pass seals any request that message missed. The sent version is checked against the digest taken at send, the sign worker draws each signer's signature, initials, name, date and ticks into their boxes with the PDF engine's new `place_marks` (`crates/pdf-core/src/marks.rs`, exported to WebAssembly as `placeMarks`) before it applies the platform seal, and the signed copy is filed as the document's newest version with its Certificate of Completion beside it. `SealRequest` gains optional `marks` and `markPictures` (`packages/signing/src/port.ts`), and the request read gains `signedFileVersionId` and `certificateFileId`. Tested in `crates/pdf-core/src/marks.rs` (including a name landing in the same displayed box on a page turned 90, 180 and 270 degrees), `apps/sign-worker/test/seal-service.test.ts` and `apps/api-worker/test/signing-seal-completed.test.ts`.

## Public

When everyone has signed, the signed copy is sealed and saved as the document's newest version, with its Certificate of Completion beside it.
