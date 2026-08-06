---
category: Added
---

**The asset register now records every kind of thing an estate owns.** Vehicles carry make, model,
year, identification number and plate; firearms carry make, model, calibre or gauge and serial;
business interests carry the company, where it was organised and what form it takes, optionally
pointing at the directory record the firm already has; insurance policies carry the carrier, the face
amount and who is insured; money owed to the estate carries the debtor, the principal, the rate and
when it falls due; digital assets carry the platform, the public handle, and whether the account is
held by a platform or self-custodied. Each kind brings a starting type list the firm extends.
Identifiers that appear on a public record — a vehicle identification number, a plate, a firearm
serial — are ordinary searchable fields, because searching by them is the point; a full account number
is not, and stays encrypted with only its last four characters readable. **The digital-asset record
has no field a recovery phrase could go in**, and a request naming one is still refused by name.

**What is secured against something is recorded, and equity falls out of it.** A mortgage, a deed of
trust, a lien, a judgment, a security interest, a tax lien, a pledge — with who holds it and the
reference it was recorded under. A balance is not a box on that form: it is a dated figure recorded
against the charge exactly the way a value is recorded against the thing, so a mortgage that was one
number at the date of death and a smaller one at the date of sale has both, dated, on the same
permanent record. Ask what something is worth as of a date and the register subtracts every charge in
force on that date. **It refuses to guess**: a charge whose balance nobody has recorded makes the
equity unavailable rather than being treated as nil, and a dollar value charged by a pound mortgage
nets to nothing at all rather than to an invented exchange rate. Negative equity is shown as
negative. Releasing a charge writes a date and removes nothing, so a schedule read as of the date of
death still shows a lien cleared the following spring.

**The estate schedule.** Everything on a matter's register as of a date you pick, grouped by kind of
thing, each row with what it was worth, the date that figure actually speaks to, what it rests on,
the charges in force and the equity left over — with subtotals per kind and per currency, never
across currencies, and the count of assets nobody has valued yet stated rather than hidden. **The
date is required and has no default**, because the date of death and today give different answers
over the same rows and a schedule with a date nobody chose is the mistake most worth preventing. It
is not a court form, it is not a saved document, and it decides nothing about what is in the estate —
it groups by what a person recorded and reports what is undetermined as its own group.

**A scheduled asset can be linked to the safe-custody item that physically holds it.** The asset
detail then shows where the object is, its status, and whether a hold is on it, read from the custody
register at the moment you look. Neither side copies the other: the custody register's declared value
is what the object costs to replace, the register's valuation is what the property is worth to the
estate as of a date, and a signed first edition has both. The same held object can be scheduled on
two matters, which the estate and its related trust routinely need.

**Assets fill documents.** Eleven new merge subjects — one per kind of thing plus one for the whole
register — arrive as **lists** rather than single fields, so a schedule of real property is a
repeating block over the property list. That is deliberate: an estate with two houses is the ordinary
case, so a single "the property's parcel number" field would have nothing to fill in on most matters.
**A value always prints with the date it speaks to**, the two being provided together. Totals are
worked out in the template and refuse visibly on mixed currencies rather than adding them up. A full
account or policy number has no merge field at all; the last four characters do. All eleven subjects
are filled by **one** read of the register, so adding a twelfth kind of thing costs no read.
