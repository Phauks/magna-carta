---
category: Changed
audience: public
---

**Edit Name corrects the name instead of keeping the old spelling.** `changeName` takes a `"correction"` kind, reached through `correction: true` on `PUT /api/v1/directory/entities/{id}/name`. It appends the new current row as a change does, but soft-deletes the mistyped row (`retireMistypedCurrentNameStatement`) instead of flipping it to `former`, and audits it as `directory.entity.name_corrected`. The record's Edit Name sends it. The default stays the change that keeps a former name.

## Public

**Fixing a name no longer leaves the old spelling behind.** Edit Name on a Directory record now replaces the name, as you would fix a typing mistake, and the old spelling is no longer listed as a former name. To keep an old name findable, such as a maiden name, add it with Add Other Name.
