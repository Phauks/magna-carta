---
category: Changed
audience: public
---

**The download register admits every download, and the row outlives the bytes.**

`download_item` was built as a shelf of what the platform MADE you, and only exports were ever written to it — `bundle` and `conversion` were named in its vocabulary from the start with no client able to create one, and a file downloaded from a matter had nowhere to go at all. So "I downloaded something and it did not appear in Downloads" was the correct behaviour, which is the definition of a design that needs changing.

One reviewed rebuild widens it. `producer` gains `file`; `kind` gains `reference` and `record`; `object_key` and `expires_at` become nullable, tied to the kind by CHECKs. `download_item` is a LEAF — nothing in the schema references it — so this is the `invoice_wip_claim` shape rather than the parent rebuild the repository forbids, and the audit is written out in the migration's own `-- contract:` header.

**`reference` is a safety boundary, not a vocabulary.** An artifact fetch presigns the stored object key with no further check, which is right for a frozen bundle the member already had and wrong for a live matter file: a member screened off a matter afterwards would keep a working handle to its files. A reference carries no key — the CHECK makes that unrepresentable rather than remembered — and the fetch hands back this platform's own `/api/v1/files/{id}/download` address, so the matter capability check runs again at the moment they ask. **`record`** is the register being complete without lying: a bundle streamed inline assembled its bytes for one response and never retained them, and filing those as an artifact would report "expired" for something that was never stored.

**Retention splits.** The bytes are privileged content in a second place and keep the seven-day rule; the row is a title, a producer and two instants, and is kept. The sweep marks `expired` and takes the object where it used to delete both, and the read it drives excludes what it has already marked so that marking terminates. The shelf read is paged for the first time, on the `(created_at, id)` pair the index already leads on — its old comment reasoned that a whole read was safe because the shelf was short-lived by construction, and keeping rows takes that premise away.

## Public

**Everything you download now shows up in Downloads.** Files you take from a matter, bundles, converted files and exports all appear there, not just exports — and the record stays after the copy we were holding for you has expired, so you can still see what you took and when. Anything still available carries a Download; a file you took from a matter goes back through the matter, so it stops being available to you if your access to that matter does.
