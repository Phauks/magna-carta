---
category: Added
audience: public
---

**Signing requests, sender side.** A signing request is a draft, then sent, then completed, declined, cancelled or expired (`packages/signing/src/request.ts`), stored in four per-firm tables with new `esign:send` and `esign:sign` permissions. Seven member routes create, save, send, remind and cancel a request (`apps/api-worker/src/http/routes/documents/signing-requests.ts`); sending reads the file's current version, counts its pages with the engine and records its SHA-256. The PDF Editor's Signature tab places fields per signer, reviews and sends, and shows the request's signers and activity (`apps/web/src/lib/pdf-editor/signing-tool.svelte`).

## Public

**Send a document for signature.** In the PDF Editor's Signature tab, add the people who sign, place their signature, initials, date and other fields on the pages, choose the order and the email, and send. The tab then shows who has signed, who is next and everything that has happened.
