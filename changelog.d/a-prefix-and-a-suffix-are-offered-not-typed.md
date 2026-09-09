---
category: Changed
audience: public
---

**Name prefix and suffix are one control, everywhere a person is named.** `apps/web/src/lib/names/honorific-field.svelte` over `@magna-carta/directory/honorifics` replaces the three plain text boxes on the Directory's person forms (the new-person names section, the record's names pane) and the account profile's seams. It is the product's own combobox with its add row, so the suggestion list is a shortcut and the typing is still the answer.

The lists are SUGGESTIONS over free text and the module header says so twice. `directory_person.prefix` and `.suffix` are unchanged and unvalidated: nothing compares against these arrays, and a closed list here would refuse a person their own name. Ordered by how often a firm meets them rather than alphabetically, with the judicial and legal forms high, because that is what a legal practice writes.

One departure from the categories picker this control is otherwise modelled on: closing the list settles the value on what was TYPED rather than on what was picked. There, an unpicked word would mint a firm-wide category and must be deliberate; here there is nothing to mint, and dropping the text would be the control eating a name.

## Public

**Prefix and suffix are now chosen from a list, and you can still type your own.** Wherever a person's name is entered — a new contact, an existing record, your own profile — the Prefix and Suffix fields offer the forms a firm writes constantly, judicial and legal ones included: Hon., Judge, Esq., Jr., III. Type to narrow the list, or type something that is not on it and add it as it stands.

It is a small thing that prevents a persistent one. "Jr", "Jr.", "JR" and "junior" are one suffix spelled four ways; they read as four on a letter and sort as four in a listing, and nobody proofreads them. Offering the written form keeps a name record consistent without anybody having to.
