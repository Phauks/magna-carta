---
category: Added
audience: public
---

**Signers are emailed their signed copy.** Once a completed signing request is sealed, `apps/api-worker/src/signing/sealing-wiring.ts` mails each outside signer a link (`mailSignedCopies` in `src/signing/signer-delivery.ts`). The link carries the signer's own secret minted as a new kind of token (`signing-signed-copy`, `src/signing/signer-link.ts`) and works for 30 days from the sealing. The chokepoint's signer lane gains a `signed-copy` kind: it admits the link only once the request is completed and sealed, and a signing link and a copy link never open each other's routes. Three new signer routes serve the copy's details, the signed version the seal filed, and the certificate (`src/http/routes/documents/signed-copy.ts`), and the page at `/sign/copy/<link>` downloads both. A new `signed-copy-not-ready` problem type answers a link opened before the copy is sealed or scanned, and `signing.signed_copies_undelivered` counts mails the service refused. Tested in `apps/api-worker/test/signing-signed-copy-mail.test.ts`, `signing-signer-link.test.ts` and `signing-mail.test.ts`.

## Public

Once a document is signed and sealed, everyone outside the firm who signed it is emailed a link to download the signed copy and its Certificate of Completion.
