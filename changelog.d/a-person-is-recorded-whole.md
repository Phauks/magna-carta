---
category: Added
audience: public
---

`POST /api/v1/directory/persons` takes the whole draft (other names, pronouns, dates, emails, phones, addresses, identifiers, organizations) and `createPersonRecord` writes it in one effect batch, each part composed by the module that owns it (`compose*` functions on person, name-history, contact-email/phone/address, edges, identifiers). The sections under `apps/web/src/lib/directory/sections/` are data-blind components used by the dialog to draft and by the Contact and Identifiers panes to persist. The organization keeps a one-section dialog beside the same duplicate gate.

## Public

**A person is recorded whole.** New Person puts every section of the record on one screen — names, ways to reach them, pronouns, dates, sealed identifiers and the organizations they belong to — as a rail down the left with the section you are on beside it, and shows on the right, as you type the name, the records the Directory may already hold for the same person. Everything is recorded together when you press Record Person, or not at all.

**Pronouns are a dropdown.** The sets most people state are offered by name; Another set opens the five forms.

**Contact is one line per way to reach someone.** Choose the kind first — Email, Telephone, Fax or Address — and the fields follow. An email address is checked as you type. A number takes its country from the dial code and is formatted as you type it, in that country's own form. Categories now belong to organizations only.

**Identifiers know their shape.** A social security number is nine digits that format as typed; a driver's licence is the state that issued it and the number; a bar number is its jurisdiction and the number; an account is who it is held with, the number, and the username and secret that go with it. The list names what is held and what it is of without revealing anything.
