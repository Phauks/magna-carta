---
category: Added
---

The Directory can now hold each person's and organization's email addresses and resolve an address back to the entity that owns it. A contact email is labelled and can be marked primary (at most one primary per entity, enforced on write), is kept as a soft-deletable temporal row, and — when an entity is merged into another — resolves through the merge to the surviving record. This address-to-entity lookup is the capability email filing uses to match a captured message's participants to the people and organizations already in the Directory.
