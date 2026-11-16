---
category: Added
audience: public
---

**Colleagues sign in the app.** A firm member named as a signer now signs inside Magna Carta. The member routes in `apps/api-worker/src/http/routes/documents/my-signing-routes.ts` (`esign:sign`) run the outside signer's handlers through a member lane (`signer-lanes.ts`) that finds the session's user on the request, with no link and no code. Their turn raises the `documents.signing.memberTurn` notification from an outbox message committed with the write (`apps/api-worker/src/signing/member-turn.ts`), and they sign on `/documents/{id}/sign`, which embeds the outside signer's page. The Signature tab shows Sign Now while a request waits on the person looking at it. `apps/api-worker/test/signing-member-turn.test.ts` walks an outside signer handing on to a colleague who then completes the request.

## Public

Colleagues you add as signers can now sign inside Magna Carta. They get a notification when it is their turn, and the PDF Editor's Signature tab shows Sign Now.
