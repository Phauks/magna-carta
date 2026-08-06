---
category: Added
---

**A matter can now keep a register of what the client or the estate owns.** Add a property with its
address, county, parcel number, legal description and recording reference; add a bank or brokerage
account with the institution that holds it; add anything else as ordinary personal property. Two
fields make a row — what kind of thing it is and a description — so nothing is ever blocked for being
incomplete, and a value can be typed in the same breath as the thing. Twenty items from a client
questionnaire go in as one submission, and re-submitting the same list does not produce a second copy
of everything.

**Every value carries the date it was true.** Instead of one number that gets overwritten, an asset
keeps a history: a date-of-death appraisal, a bank statement, a broker's figure, the price it
actually sold for — each with the date it speaks to, what it was based on, and the document behind
it. Ask what something was worth as of a date and the answer comes back with the date it actually
speaks to, so you can see how current it is; ask for a date before the first figure and the answer is
nothing at all, because something acquired after the date of death was not in the estate at the date
of death. A wrong figure is fixed by recording a correction that names the entry it replaces, which
supersedes it everywhere while both stay on the record — so an inventory filed in March and the
register read in September can never quietly disagree. There is no route that edits or deletes a
recorded value, and the database refuses one.

**Documents attach without leaving the matter's file list.** Link the deed, the title, a statement,
an appraisal, a bill of sale. The document is not copied or moved: it stays exactly where it was,
previewable, searchable, and under any legal hold, and it has simply gained an association. One
statement can evidence four accounts, so it is attached once and linked to each. Detaching leaves the
document untouched.

**Interests are recorded as fractions, and nothing is inferred from them.** Record who from the
directory holds a stake, under a label from the firm's own list, with a share as a fraction so three
siblings' shares add up to the whole rather than to 99.99 percent on a filing. Ending an interest
writes a date and removes nothing. How an asset is held and whether it forms part of the probate
estate stay two separate facts a person records — the register never derives one from the other.

**Sensitive numbers are handled by what they are.** A parcel number is on the assessor's public roll,
so it is an ordinary searchable field. Full account, policy, certificate and tax numbers are
encrypted: every list, detail and report shows the last four characters only, seeing the whole number
is a deliberate act needing the same permission as a contact's sensitive identifiers, and every such
read is recorded. Recording only the last four is a complete record. Passwords, passphrases, seed and
recovery phrases, private keys, personal identification numbers and safe combinations are refused
outright, with a message saying where such a secret belongs — a sealed envelope in the safe custody
register, where it has a location, a hold, and a record of every hand it has passed through.

**Kinds of thing grow without waiting for us.** A fixed set of asset classes carries the structured
fields that make search work, and under each one the firm keeps its own list — single-family
residence, condominium, timeshare and mineral interest under property; checking, savings, brokerage,
certificate of deposit and retirement accounts under financial accounts — extendable by the firm and
deactivated rather than deleted, so every asset already filed under a type keeps its meaning.

Two new permissions, `matterAssets:read` and `matterAssets:manage`, seeded to the seats that
administer an estate. Reading the register and moving originals in the safe stay separate grants, and
so do reading the register and opening a full account number.
