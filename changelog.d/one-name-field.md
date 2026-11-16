---
category: Changed
audience: public
---

**A person's name is entered with one set of fields everywhere.** `sections/person-name-fields.svelte` is the one layout of a person's name parts, used by New Person's current and other names and by the record's Edit Name and Add Other Name (`names-pane.svelte`), which had drifted into a second layout. The record's other-name block takes New Person's "Other Name" kind field, and the names list hides while Edit Name is open.

## Public

**Names look the same wherever you type them.** Edit Name and Add Other Name on a Directory record now use exactly the same fields, in the same order, as New Person. While you edit a name, the list of names steps aside so the name is not shown twice.
