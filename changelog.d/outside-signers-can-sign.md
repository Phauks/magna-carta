---
category: Added
audience: public
---

**Outside signers.** Sending a request now emails each outside signer a link when it is their turn, and a reminder re-sends the same link. The link is a signed token carrying a secret derived from the deployment key; the signer's row keeps only the secret's SHA-256 and its version (`apps/api-worker/src/signing/signer-link.ts`). A signer lane in the chokepoint admits that link on nine `/api/v1/signer/*` routes and nowhere else (`apps/api-worker/src/http/routes/documents/signers.ts`). The signer's page at `/sign/<link>` takes the emailed code, the electronic-records agreement, the adopted signature (typed, drawn or uploaded, stored in the firm's bucket), the field answers, and finish or decline (`apps/web/src/lib/signing/signer-page.svelte`). Address and browser on every act are the server's own observation. An hourly pass sends the reminders a sender set, with the same link, and closes a request past its last moment as expired (`apps/api-worker/src/signing/signing-sweep.ts`).

## Public

**People outside the firm can sign.** Each person you send a document to gets an email with a link when it is their turn. They confirm it is them with an emailed code if you asked for one, agree to sign electronically, adopt a signature by typing, drawing or uploading it, fill in their fields and finish, or decline and say why.
