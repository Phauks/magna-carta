---
category: Added
audience: public
---

**The directory-linking family, and the matter's parties built on it.** Three design-system
components: `EntityIdentity`, the one mark for a person or an organization wherever one is named;
`EntityPicker`, the one field one is chosen in, which takes a `search` and never fetches (the
settle, the floor, the abort of a superseded question and the three states live in
`picker-search.ts`, tested on their own); and `RecordParties`, the tab a record shows its people
in, the counterpart of `RecordAttachments`, with its confirmation on `ActionDialog` from the first
commit. `apps/web/src/lib/directory/directory-picker-source.ts` is the one adapter from the
directory's ranked search to the picker. The matter Parties page moves onto the tab and gains
`linkMatterParty`; its hand-composed removal dialog and its allowance go. The conflicts, custodian
and cost pickers still carry their own combobox over `searchDirectory` and fold onto `EntityPicker`
in a later slice; the one-implementation registry refuses a fourth copy meanwhile. The Directory's
route is renamed from `/contacts` to `/directory`.

## Public

**A matter's parties can be added from the Parties page.** Pick a person or an organization from
the Directory, choose the role, and record the capacity if there is one. One person can hold more
than one role on the same matter; the page says which roles they already hold and refuses only the
exact repeat. Removing a party asks first, and says in as many words that the person stays in the
Directory with everything recorded about them.

**The Directory has moved to `/directory`**, matching what the navigation has always called it.
