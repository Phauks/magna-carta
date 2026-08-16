# Asset register — what an estate or a client owns

_Every kind of thing, the value history, what is secured against an asset, the estate schedule,
interests, document links, the link to the safe custody register, the account-number handling, your
firm's own fields on an asset, and assets as merge fields are built, along with the API behind them.
The screens — the matter's asset list, quick add, asset detail, and the schedule — are authored when
those surfaces ship. Copying an asset forward from an earlier matter, the automatic parcel and
valuation lookups, and a ready-made schedule template are not built yet._

## What it does

Keeps a list, on any matter, of what the client or the estate owns — and keeps every fact about each
thing in one place: what it is, what it is worth and **as of when**, who has an interest in it, and
which documents evidence it.

It is built for estates first, because that is where it earns its keep. Administering an estate means
producing a list of what the deceased owned, with a value for each item as of the date of death, and
then a second list of what those things are worth now. The register is designed so both come out of
the same records without anybody retyping anything.

Three ideas are worth knowing before you use it.

**Every asset belongs to one matter.** The same house on the husband's divorce and on his mother's
estate are two records, not one. They have different valuation dates, different people with an
interest, and different confidentiality — and letting one row serve both is how one case's numbers
end up in another. Copying an asset forward from an earlier matter, with a note of where it came
from, is coming later.

**Two fields make a row.** What kind of thing it is, and a description. That is all. You are never
stopped for having an incomplete record: "contents of the garage, not yet itemized" is a perfectly
good row, and the register's job is to be filled in, not to be argued with.

**Every value carries its date.** There is no "current value" anywhere in the register. Instead each
asset keeps a short history of dated figures, and you ask it what something was worth as of a date
you choose. That is what lets one register answer "what was the house worth at the date of death"
and "what is it worth today" without either answer overwriting the other.

## Logging what an estate owns

1. Open the matter's assets and choose to add one.
2. Pick the **kind of thing** — a property, a financial account, a vehicle, a firearm, a business
   interest, an insurance policy, money owed to the estate, a digital asset, ordinary personal
   property, or "other" for anything else. This is a fixed list, because the kind decides what
   structured fields the record has.
3. Under that, pick a **type** from your firm's own list if one fits: single-family residence,
   condominium, timeshare, mineral interest; checking, savings, brokerage, certificate of deposit,
   retirement account; passenger vehicle, boat; handgun, rifle, shotgun; corporate shares,
   partnership interest; term life, annuity; promissory note; cryptocurrency, domain name. The type
   is optional — you do not have to decide between "single-family residence" and "residence" before
   the row exists — and your firm can add its own.
4. Write a **description** you would recognize: "the house on Elm Street", "brokerage at Northgate".
5. Fill in whatever else you know. For a property that is the street address, the county, the parcel
   number, the legal description, and the recording reference; for an account it is the institution;
   for a vehicle the make, model, year, identification number and plate; for a firearm the make,
   model, calibre or gauge and serial; for a policy the carrier and the face amount; for money owed
   the debtor, the principal, and when it falls due. None of it is required.

   **A policy's face amount is not what the policy is worth.** It is a term of the contract and sits
   with the policy's other details. What it is worth — its cash surrender value — is a dated figure
   like any other. Keeping them apart is what stops every term-life policy looking like cash.

6. If you already know roughly what it is worth, type the figure and the date it speaks to right
   here — it is recorded in the same breath as the thing.

### Twenty items at once

Working from a client questionnaire, use the bulk entry: a list of rows in one submission, up to
fifty at a time. Either all of them are recorded or none is, and re-submitting the same list does not
produce a second copy of everything. A list longer than fifty is turned away rather than partly
saved, so you always know what was and was not recorded.

## Recording what something is worth

Values are **added, never edited**. Each entry carries:

- **the date it speaks to** — the date of death, the date of separation, the day of the appraisal;
- **what it is based on** — an appraisal, a bank statement, a tax assessment, a market quote, a
  guide book, a broker's figure, the price it actually sold for, a purchase price, a figure a court
  determined, or the client's own estimate;
- **an optional note**, and **the document behind it** if the appraisal or statement is already in
  the matter's files.

The date the figure speaks to and the date you typed it in are kept apart, deliberately. An appraisal
dated the day of death is often typed up four months later, and both facts matter.

### Fixing a wrong figure

You do not edit it. You record a **correction**: a new entry that names the one it replaces. From
then on the register uses the corrected figure everywhere, and the original stays visible as
something that was corrected.

This is one extra field when you make a mistake, and here is what it buys: an inventory you filed in
March and the register you read in September can never quietly disagree. If somebody asks what you
told the court and why the number changed, the register answers.

## Asking what something was worth

Ask for an asset as of a date, and you get the latest figure recorded **at or before** that date,
together with the date that figure actually speaks to and what it was based on. Three things follow,
and each one is deliberate:

- **The answer is never just a number.** A value always arrives with its date. A figure printed
  without the date it belongs to is the mistake this whole design exists to prevent.
- **The date you get back is often earlier than the date you asked for.** Ask what the house was
  worth in May when the last appraisal was in March, and you get the March figure and the March date
  — so you can see for yourself how current it is.
- **Before the first figure, the answer is nothing at all.** An asset with no value recorded at or
  before your date reports as having no value, rather than reaching backwards for the earliest one.
  Something bought after the date of death was not in the estate at the date of death, and the
  register will not put a number on a schedule that nobody asserted.

## Who has an interest

Most of an estate is simply the deceased's, so recording an interest is optional and most rows have
none. Interests are for the exceptions: the jointly held house, the thirty percent of a business, the
account with a named beneficiary.

Record the person or organization from your directory, the label your firm uses (owner, joint owner,
titleholder, life tenant, remainderman, trustee, beneficiary, payable-on-death beneficiary, secured
party, lessee — your firm's own list, which you can change), and a share as a **fraction** if there
is one. A fraction rather than a percentage, because one third is one third: three siblings' shares
add up to the whole instead of to 99.99 percent on a court filing.

When an interest ends, record the date it ended. The entry stays: who held what, and until when, is
the question somebody asks six months later.

**The register does not draw conclusions from any of this.** Whether a jointly held house passes
outside probate depends on the exact form of co-ownership and on where you are, and it is not
something software should guess at. So how an asset is held and whether it forms part of the probate
estate are two separate things you record separately: mark each asset as probate estate, non-probate
transfer, or undetermined, and undetermined stays its own group on every report rather than being
quietly folded in with something else.

## Attaching documents

Link the deed, the title, the statement, the appraisal, the bill of sale, a photograph — anything
already in the matter's files.

The document is not copied or moved anywhere. It stays in the matter's file list exactly where it
was: previewable, searchable, convertible, and under any legal hold it was already under. It has
simply gained an association.

**One document can evidence several assets.** One brokerage statement really does list four
accounts, and one appraisal really does cover a house and its contents — so you attach it once and
link it to each. Detaching a document leaves the document itself untouched.

Uploading happens the way it always does, through the matter's files. The asset register never
handles the file itself, only the link.

## Account numbers, and what will never be stored

**Numbers that appear on public records are ordinary fields** you can search by: a parcel number, and
later a vehicle identification number, a plate, a firearm serial. They are on a title or an
assessor's roll, and finding a record by them is the point.

**Full account, policy, certificate, and tax numbers are encrypted.** Everywhere in the system —
every list, every detail screen, every report — you see the **last four characters only**. Seeing the
full number is a separate, deliberate action that needs the same permission as viewing a contact's
sensitive identifiers, and every time somebody does it, that is recorded. If you do not have that
permission you are told so plainly; you are never shown a blank field that might mean there is no
number.

Recording **only the last four** is a complete record, and is often the better one. The register
never needs the whole number to work.

**Passwords, passphrases, seed and recovery phrases, private keys, PINs and safe combinations are
refused.** There is no field for them and no way to type one in — the register turns the request away
and tells you why. Anyone with permission to decrypt could read such a value, and for a
self-custodied digital asset the recovery phrase _is_ the asset: whoever reads it can take it,
irreversibly and with no trace. The right home for a secret like that is a sealed envelope in the
[safe custody register](safe-custody-register.md), where a physical object has a location, a hold,
and a permanent record of every hand it has passed through.

## What is secured against something

A mortgage, a deed of trust, a lien, a judgment, a security interest, a tax lien, a pledge. You
record what it is, who holds it, and the reference it was recorded under. There is deliberately no
"balance" box on that form, and the reason is the same one behind everything else here: **a balance
is a dated figure.** You record it the way you record a value — a number and the date it speaks to —
except that you record it against the charge rather than against the thing. So a mortgage that was
one number at the date of death and a smaller one at the date of sale has both, dated, and the
schedule can show either.

**Equity is worked out, never stored.** Ask what something is worth as of a date and the register
subtracts every charge in force on that date and shows you what is left. Two things it will not do:

- **It will not guess at a balance you have not recorded.** A charge whose size nobody has written
  down makes the equity unavailable rather than treating the charge as nil — which would overstate
  exactly the assets you most need to be careful about. You are told the equity is unavailable and
  why.
- **It will not convert currencies.** A house valued in dollars charged by a mortgage recorded in
  pounds nets to nothing the register will state. It shows you both figures and says the equity is
  unavailable, because the exchange rate on a past date is not a fact your records carry.

Negative equity is shown as negative. A house worth less than the mortgage on it is an ordinary
situation and hiding it would defeat the point.

**Releasing a charge writes a date; it never deletes the row.** A schedule read as of a date before
the release still shows the charge, which is the only way "was this property clear at the date of
death" has an answer years after the lien was cleared.

## The estate schedule

Ask for the schedule and pick a date. You get everything on the matter's register, grouped by kind of
thing, each row with:

- what it is, and your firm's own type for it;
- what it was worth as of the date you asked for, **the date that figure actually speaks to**, and
  what it rests on;
- every charge in force on that date, with its balance;
- the equity left over;
- how the estate treats it, as somebody recorded it.

Under each group are subtotals — **per currency, never added across currencies** — and the number of
assets in it that nobody has valued yet. That count is shown rather than hidden, because "eleven of
these forty have no number yet" is the thing you can act on, and a total quietly worked out over the
other twenty-nine is not.

**You must pick a date.** There is no default and there will not be one. The whole point of the
register is that the date of death and today give different answers over the same rows, and a
schedule with a date nobody chose is the mistake worth the most effort to prevent.

Three things the schedule is not. It is **not a court form** — it is the shape of a probate
inventory without any court's layout, and turning it into a filing is a separate job. It is **not a
saved document** — it is worked out fresh each time, so it and the register cannot drift apart. And
it **does not decide what is in the estate** — it groups by what a person recorded and shows what is
undetermined as its own group rather than guessing.

## When your firm holds the original

If the ring on the estate inventory is the ring in your firm's safe, link the asset to the item in
the [safe custody register](safe-custody-register.md). The asset detail then shows where the object
is, what its status is, and whether a hold is on it — read from the custody register at the moment
you look, never copied.

**Neither side copies the other, and one pair of numbers explains why.** The custody register records
a declared value: what the object would cost to replace, which is your firm's insurance question. The
asset register records what the property is worth to the estate as of a date on a stated basis. A
signed first edition has both and they are not the same number, so nothing syncs them and neither is
worked out from the other.

The same held object can be linked from two matters — the estate and the related trust both schedule
it — and that is allowed on purpose.

## Your firm's own fields on an asset

The fixed kinds and your firm's own type list cover what a thing **is**. For a fact about a thing
that nobody anticipated — a timeshare's week number, a boat's slip number, who valued a piece of
jewellery — your firm defines its own field, exactly as it already can on a matter and on a contact.
It is the same feature, the same list of field types (text, number, currency, date, tick box, a list
of choices, a link to a matter or a contact), and the same administration screen.

**A field can belong to one kind of thing, or to all of them.** Attach "slip number" to vehicles and
it appears on the boat and nowhere else; attach nothing and the field appears on every asset on every
matter. That is what stops an asset record filling up with fields that have nothing to do with it.

Two things worth knowing, both of which follow from how firm-defined fields work everywhere else:

- **Renaming a field never loses what was recorded in it.** A value is tied to the field itself, not
  to what it is called, so "Week number" can become "Timeshare week" with nothing to redo.
- **Retiring a field keeps its answers.** Archive it and it stops appearing on new records; every
  value already recorded stays readable. Deleting a field outright is refused once anything has been
  recorded in it.

**Do not put an account number, a password, a recovery phrase, or a safe combination in one.** A
firm-defined field is ordinary stored text, not a sealed one — account and policy numbers have their
own handling further up this page, and a credential has no home here at all.

## Assets in an assembled document

Asset records can fill a document. What a template gets is a **list**, not a single asset: one for
everything on the register, and one for each kind of thing. A repeating block walks the list and
prints a row per asset, so a schedule of real property is a template naming the real-property list.

That is deliberate and it is the one place the merge fields work differently from everything else.
There is no "the property's parcel number" field, because an estate with two houses is the ordinary
case — such a field would have nothing to fill in on most matters. Walk the list instead.

**A value always prints with the date it speaks to.** The two are provided together and a template
that prints one without the other is a template bug, not a formatting choice. An undated figure in a
filed document is the worst thing this part of the platform can produce.

**Totals are worked out in the template**, not supplied as fields, and a total over amounts in two
currencies refuses visibly rather than adding them up.

**A full account or policy number is never available to a template.** The last four characters are;
the whole number has no field at all. A merge field that decrypted one would write the secret into a
document whose confidentiality then becomes that document's problem.

**Your firm's own fields on an asset are not merge fields yet.** A firm-defined field on a _matter_
is available to a template; one on an asset is not, because an asset field would have to print inside
the repeating block, once per asset, and that is a separate piece of work. Recording the fact and
printing it are two different capabilities and only the first is built.

**There is no ready-made schedule template.** The fields a schedule needs all exist, so a template
your firm authors and uploads works today; what does not exist yet is one supplied in the box.

## Firearms, and what the register will not tell you

Firearms are recorded the same way a car is: make, model, calibre or gauge, serial number, a value
history, documents, an interest. Where a firearm appears, the register shows a standing notice:

> Transfers of firearms are regulated by federal and state law. This register records what is held;
> it does not determine who may receive it.

That is the whole of it, and it is deliberate. The register does not decide who may receive a
firearm, does not decide whether a transfer needs a dealer, does not classify anything under any
regulatory schedule, does not check anyone's status, and does not produce a deadline. Those rules
vary by state, by the item, and by the recipient, and a rule that is right ninety percent of the time
is worse than no rule at all — because it gets trusted.

There is a free-text field for a conclusion **you** have reached about a particular item, so that a
note like "suppressor, transfer paperwork pending" sits next to the item rather than in somebody's
email. Nothing in the platform acts on it.

## What the register does not do

- **It is not a court form.** It produces a list with dated values; turning that into the inventory a
  particular court accepts is a separate job, and the rules for it frequently run below state level.
- **It does not do estate accounting.** Receipts, disbursements, and claims against the estate are a
  ledger, not a list of property. The register's contribution is the opening inventory.
- **It does not track general debts.** A mortgage or lien secured against a specific asset belongs
  here; a credit card balance is a claim against the estate and does not.
- **It is not your firm's own property register.** Equipment, depreciation, and insurance schedules
  are a different job with a different audience.

## Related

- [Safe custody register](safe-custody-register.md) — the physical originals your firm holds, and
  the right home for a sealed secret.
- [Document templates and assembly](document-templates-and-assembly.md) — how an asset schedule is
  assembled from these records.
