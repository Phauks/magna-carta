---
category: Changed
audience: public
---

**A matter's parties: change a role in the row, Delete instead of Remove, one Add, and plain match
strengths.** The Role cell on the matter Parties table is a Select; picking a role calls the new
`PATCH /api/v1/directory/matter-parties/{id}` (`changeMatterPartyRole` in
`packages/directory/src/party.ts`), which severs the old link and opens a new one in one batch, so
a conflicts report that named the party in its old role stays reproducible. `RecordParties` names
its act Delete (Trash2 glyph, "Delete This Party?") and takes `addControl={false}` where the screen
has its own New control, which the matter page now uses. Conflicts match strengths read Exact,
High, Medium, Low (`STRENGTH_LABELS` in `apps/web/src/lib/conflicts/check-results.ts`).

## Public

You can change a party's role on a matter straight from the Parties table: pick the new role and it
is saved. Taking someone off a matter is now called **Delete**, and adding a party starts from **New
Party** at the top of the matter rather than a second Add button below the table. Conflicts results
now say how strong a match is as **Exact**, **High**, **Medium** or **Low**.
