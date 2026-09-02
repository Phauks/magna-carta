---
category: Added
audience: public
---

**The directory record's remaining gaps close.** `EDGE_TYPES` gains the membership family
(`officer_of`, `director_of`, `partner_of`, `trustee_of`, `personal_representative_of`, `agent_of`,
`employment`, `member_of`, `shareholder_of`, `beneficiary_of`, `guardian_of`,
`point_of_contact_for`); `affiliation` stays for the rows already recorded and is no longer offered.
Every new type is classed in `packages/conflicts/src/edge-classes.ts` — the constituent types under
`control` for now, the over-inclusive direction, because the tighter fifth class waits for the
conflicts pass. `createDirectoryEdge` and `createDirectoryCategory` join the web client. The
relationships pane is one `edges-pane.svelte` registered three times: Relationships on both kinds,
People on an organization, Organizations on a person, each recording an edge through `EntityPicker`
with the type narrowed by the record's kind and the direction decided by the type
(`edge-draft.ts`, tested). `new-entity-dialog.svelte` and `merge-dialog.svelte` move onto
`ActionDialog` and their allowances go; the categories pane creates a category through the add row.

## Public

**Relationships can be recorded on a Directory record.** Choose the other record and the kind of
relationship, with an optional role and note. An organization's record now has a People page listing
its officers, directors, partners, employees, members, shareholders and points of contact, and a
person's record has an Organizations page listing the organizations they belong to. A category the
firm has not named yet is created and assigned in one step.
