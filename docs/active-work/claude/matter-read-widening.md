---
worktree: (primary checkout)
area: The matter detail read — names instead of identifiers, and the fields the client threw away
status: building
touches: packages/matters/src/matter-statements.ts, apps/worker/src/routes/matters.ts, apps/web/src/lib/matters/matter-record.ts
---

`matterRecordFromRead` hardcoded seven fields to null for a live matter, so a real firm matter
rendered blanks where the three in-repo sample matters render detail. Three of those the contract
already carried as identifiers the client did not accept; four the contract did not carry at all.

This stream resolves the type, Location and responsible member to NAMES in the detail read itself,
adds the three instants and the e-billing flag, and stops the client discarding them. The display
read is its own statement: the lifecycle service keeps the lean one, which has no business paying
for three joins to learn a name it will not print.
