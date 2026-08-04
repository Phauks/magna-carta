---
category: Fixed
---

- **Directory merges no longer strand chained entities, destroy absorbed relationships, or accept
  writes on merged-away records.** Three defects in the merge subsystem are closed. (1) Merging an
  entity that had already absorbed others left a two-hop chain: resolution follows exactly one hop, so
  the earlier subordinates resolved to an entity that had itself been merged away. A merge now
  repoints the merge pointer of every entity previously merged into the subordinate onto the new
  master in the same atomic batch, so `merged_into_id` always names a live entity and every historical
  entity resolves to the final master in one hop — chosen over transitive resolution because it costs
  one write per chained entity once, instead of a recursive lookup on every read path forever.
  (2) A reference that could not be repointed live during absorption — a matter-party link or an edge
  the master already carried, or an edge that would have become a self-loop — was hard-deleted,
  destroying the record that the merged-away entity ever held that relationship. Those rows now move
  to the master and land archived (soft-deleted, temporally closed) with their content intact, mirroring
  the archive-to-history handling custom-field values already used, and each absorption stays recorded
  in the `entity_merge` event. (3) The shared existence assertion ignored entity status, so names,
  identifiers, edges, category assignments, and matter-party links could still be attached to a
  merged-away entity. Those writes are now refused with a conflict that names the surviving master;
  reads are unchanged and still return the merged entity with its pointer to follow.
- **Renaming a Directory entity now verifies the entity first.** `changeName` was missing the guard its
  sibling `addName` carries, so renaming an unknown entity inserted an orphan current-flagged name row
  and its phonetic codes into the conflicts corpus and still reported success.
- **A merge no longer repoints a subordinate that another merge already claimed.** The archive write
  re-checks at write time what the guard checked at read time, so where two concurrent merges of the
  same subordinate both pass the read-time guard, the loser cannot point it at a master that received
  none of its references.
