---
category: Added
audience: public
---

**Firms choose how outside signers prove who they are, and a code can go by text message.** A signer check is a module in `packages/signing/src/signer-checks.ts`: the email link (always on), a code by email, a code by text message, and an outside identity check. A firm's choice is the setting `signing.signer_checks`, read at `GET /api/v1/firm/signing/settings` (`esign:send`) and written at `PATCH` (the new `esign:manageSettings`, seeded to Owner/Admin). Texts go through the Telnyx port in `packages/signing/src/text-message.ts`, which stays off until `TELNYX_API_KEY` and `TELNYX_TEXT_FROM` are both set; `signing_signer` gains `code_channel` and `mobile_number`. Outside identity checks and online notaries plug into `packages/signing/src/outside-service.ts`, with no vendor yet. A request naming a check the firm has turned off is not sent.

## Public

When you send a document for signature, you can now have a signer confirm it is them with a code sent by text message, as well as by email. Your firm decides which ways to offer.
