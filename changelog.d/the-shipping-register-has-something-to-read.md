---
category: Added
audience: internal
---

Three reads the shipping surfaces need and the subsystem never had: `GET /api/v1/shipments` (the firm's shipments, newest first), `GET /api/v1/shipments/{id}` (one shipment in full), and `GET /api/v1/integrations/shipping/connection` (whether an account is connected, and its health).

The eight routes built in June were all writes or live carrier calls. There was no way to ask what a firm had sent, which is why the register could not be built over them — `selectShipmentStatement` reads one shipment by id and nothing listed them.

The list pages on a keyset over `(created_at, id)` rather than an offset, because a register is read while shipments are being created and an offset skips or repeats rows as the page moves under the reader. It reads one row more than asked for, so whether another page exists comes from the read itself rather than a count that could disagree with it, and a cursor the register did not issue is a 422 rather than a silent first page — which would read as the register having reset.

Two projections are deliberately narrower than the row. A list item carries the recipient's name and not their address, so a list of a firm's mail does not send every recipient's street address to the browser; and the detail says `hasLabel` rather than the storage key the label lives at.
