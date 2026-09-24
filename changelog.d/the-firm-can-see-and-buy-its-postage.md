---
category: Added
audience: public
---

**Three of the four shipping surfaces.** `/shipping` is the register (the product's grid over declared columns in `shipment-columns.ts`, so the reader chooses between the "where is my letter" columns and the "what have we spent" ones); `/shipping/new` is the stepped buy flow; `/settings/shipping` is the postage account, and the first occupant of the `integrations` settings group, which had been declared and empty since the group list was written. The tool's maturity stage moves from `soon` to `alpha`, which is what turns its dead rail row into a link. The shipment window that opens over the register — and the `/shipping/[id]` address that redirects into it — is the remaining surface.

Two seams were corrected mid-build rather than worked around. Writes carry their Idempotency-Key from a `WriteIntent`, because the generated mutation options have no notion of one and a second click is otherwise a second label. And `shipping-api.ts` calls the generated client's own functions rather than spelling `/api/v1/...` paths: `lint:screen-data` holds that count down and it only falls, so a new hand-written transport module would have been the wrong direction even though it compiled. Amounts print through `@magna-carta/money`; nothing divides minor units by a hundred, and a currency the package does not yet register is stated plainly rather than thrown over.

## Public

**You can see what your firm has posted, and buy postage yourself.** Shipping & Postage lists every shipment — who it went to, where it is, what it cost, and which matter it belongs to — and you can sort, filter and choose the columns as on any other list in the product.

New Shipment walks through it: who it is going to, what is being sent, whether it needs certified mail, a return receipt or a signature, then the live carrier rates to choose from. Postage and the platform's service fee are always shown as separate lines before you buy, because postage is what gets billed on to a client.

An administrator connects the firm's carrier account under Settings. The key is stored encrypted and never shown again — if it is lost, issue a new one with the carrier and replace it.
