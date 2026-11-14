---
category: Changed
audience: public
---

**New Person and the person record share one layout, and names are edited in place.** `new-person-dialog.svelte` puts the photo in the `ActionDialog` `leading` slot, top left as on the record window, and heads the panel with the typed name. `names-pane.svelte` drops its two windows (Change the Name, Record Another Name) for Edit Name and Add Other Name that open inside the Names card, with the fields in New Person's order. Below the `md` breakpoint `ActionDialog` stacks its context pane under the form and `record-sections.svelte` hides the rail, where both used to squeeze the form to a sliver.

## Public

**Adding a person and looking at one now look the same.** The photo sits at the top left of New Person, as it does on a record, and the heading shows the name as you type it. On a record, Edit Name and Add Other Name open right inside the Names section instead of a separate window. On a phone, the record and New Person windows now use the full width.
