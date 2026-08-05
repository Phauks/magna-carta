---
category: Added
---

**A template can now name a client's protected details, and reading one is still a permission and a
record.** The client's Social Security number, Employer Identification Number, date of birth, driver's
license number, account number, and Social Security last-four are merge fields —
`{{client.socialSecurityNumber}}` reads the way `{{client.displayName}}` always has. These values live
encrypted, and nothing about putting them in a document changes who may see them: the value is filled in
only for a member permitted to decrypt it, and every one that is filled in writes the same record a
direct read of that value writes, naming the same field and the same member.

**A member who may not read the value still gets the document.** Where the value would have been, the
draft carries the usual visible marker, and the result says why: the field that was withheld and the
permission it needs. The assembly completes and is reported as needing review, exactly as any other
gap is — one detail nobody may read is not a reason to refuse a letter, and a silent blank in its place
would be a document that reads as finished and is not. Nothing that was withheld appears in the
document, in the assembly's record of what it did, or in anything the product hands back.

**A field that holds a protected value now says so before anyone assembles anything.** The merge-field
list and a template's own field list both mark it, so an author choosing the field knows what it is, and
a firm can see which of its templates ask for protected details. Binding one needs no special
permission — naming a field is not reading it — and a matter whose client the Directory cannot pin down
to exactly one record decrypts nothing at all.
