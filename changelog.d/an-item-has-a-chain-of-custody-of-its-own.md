---
category: Added
audience: public
---

**One item's chain of custody is now readable.** The ledger has always recorded item-scoped rows — `custody_movement.item_id` is nullable precisely so that withdrawing one instrument, superseding it, or holding it alone is recordable against the item rather than the envelope — and nothing could read them back at that scope. A packet's history was the only history, and an item's rows sat inside it unmarked, so a `withdrawn` entry did not say which of a packet's five instruments left.

`GET /api/v1/custody/packets/{packetId}/movements` takes an optional `itemId`. **The filter is deliberately not `item_id = ?`**: an item inside a packet goes wherever the packet goes, so the scope is the item's own rows PLUS the packet-wide ones. A read that returned only the rows naming the item would answer "Contents described" over a decade of moves and check-outs and present that as a chain of custody, which is the failure worth guarding — `apps/api-worker/test/custody-routes.test.ts` pins it, including that the OTHER item's rows stay out.

Every row already carried `itemId`, so which of the two kinds an entry is never has to be inferred. `movementDetailLines` takes a scope: reading a packet's history an item row names its item ("About Item 1: Original will"), and reading one item's history the packet-wide rows say "The whole packet". Neither says anything in the list where it is the ordinary case, so no history repeats itself on every line.

In the packet window each item in Contents opens onto its own rail, and opening is what reads the ledger — a packet with nine items draws a list rather than nine histories nobody asked for.

## Public

**Each item in a packet now has a chain of custody you can read on its own.** Open a packet, go to **Contents**, and click an item: its history opens underneath it.

What you get is the item's own record and everything that happened to the packet holding it, because an original will inside a deed box went to the Reno safe when the box did. Entries about the whole packet say so, so you can always tell a move of the box from something that happened to this will alone. In the packet's own history it works the other way round: an entry about one item names which item it was, instead of leaving you to guess which of five instruments was withdrawn.

Nothing about how the record is kept has changed. It is the same append-only ledger, read at two scopes rather than copied into a second place, so a packet and an item can never come to disagree about the same object.
