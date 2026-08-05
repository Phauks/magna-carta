# Document templates and assembly

_The template catalogue, the assembly engine, and template conditions, repeats, and calculations are built. The template library, the field inspector, and the assemble dialog are authored when those screens ship; today templates are registered and documents assembled through the API._

## What it does

Turn a Word document your firm already uses — an engagement letter, a pleading caption, a fee
agreement — into a **template**, then produce a finished document from it against any matter in one
step. The matter's number, its client, its office letterhead, and today's date drop into place; the
result lands in the matter's documents like any other file, ready to open, edit, convert, or send for
signature.

You author templates in Word, the way you already write documents. There is nothing new to learn
about layout, numbering, or styles — a template is a Word document with a few blanks marked in it.

## Marking the blanks

Type the field's name between double braces where the value should go:

```
Re: Matter {{matter.number}} — {{client.displayName}}
```

That is all there is to it. You can type them anywhere in the document, including in headers, footers,
and footnotes, and they survive copy and paste. Spaces inside the braces are fine —
`{{ matter.number }}` is the same field.

**See the list of fields you can use** before you write: the field list names every one, what it reads
from, and what your document shows if the matter has no value for it. Some fields offer more than one
way of being written — a date can appear as `3/14/2026`, `March 14, 2026`, or
`the 14th day of March, 2026`. Ask for one by adding it after a colon:

```
Dated this {{system.today:legal}}.
```

## Registering a template

Upload the Word document and give it a name. Before it is stored, we prepare it and tell you what we
found:

- **The blanks are checked.** A field name that does not match anything is refused with the spelling
  you typed and where in the document it appears, so you can fix it in Word and try again. A blank you
  opened and never closed is caught the same way. Nothing half-working is stored.
- **The document's drafting history is removed** — tracked changes, comments, hidden text, and the
  author and company recorded in its properties. Every document produced from the template starts
  clean, so a letter to a client never carries the notes you made writing the template.
- **Macros are removed only if you ask.** A template is run against your clients' data, so one carrying
  macros cannot be stored — but taking them out changes the document you sent us, so it is your call.
  Register asking for the macros to be removed and the macro project goes, the count is reported back
  to you, and the result is re-checked from scratch to confirm nothing was left behind; if anything
  survives, the template is not registered at all. Without that, an upload containing macros is refused
  and tells you what was found. Uploading a macro-free copy of the file is the other way through.
- **The file is scanned**, exactly as any file you upload is.

You can narrow a template to a matter type or an office, which limits which matters offer it. Every
template is otherwise visible to everyone in the firm who can assemble documents.

Registering a template needs the **manage templates** permission, which owners and administrators
have.

## If your template came from Word mail merge

Word's own merge fields (the grey ones you insert from the Insert Field dialog) are **not** filled in
by this system. Left alone, each one prints whatever text Word last cached in it — which is how a
document ends up looking finished and being wrong.

The template still registers, and we make sure that field is never out of sight. Registering a document
that uses them reports **every merge field it found**, by name, with how many times each appears, which
of our fields it would become, and **the text it will actually print**. Nothing is changed — the
document we store is exactly the file you uploaded. The field list keeps showing them, and **every
document you assemble from that template reports them again** and is marked as needing review, in the
same place a missing value would be.

You then choose:

- **Convert them.** Register again asking for conversion, and each merge field is rewritten into the
  `{{field}}` form and filled in from then on. This changes the document we store — it is no longer
  byte-for-byte the file you uploaded — which is why it happens only when you ask.
- **Replace them yourself in Word.** Delete the merge fields and type the field names between braces.
- **Leave them.** Sometimes the frozen text is what you want — a caption that never changes. Now you
  can see which fields those are.

**We remember what your field names mean.** If your Word fields are named differently from ours
(`ClientName` where we have `client.displayName`), the report says so rather than guessing at a match.
Once you confirm the meaning by converting a template that uses our name for it, the mapping is kept:
importing the next document from the same source arrives already mapped instead of asking again. You
can see the whole list of what your firm has confirmed, and remove any entry you no longer want — a
mapping is your firm's statement about your own documents, so you can withdraw it. Removing one changes
nothing already registered.

## Updating a template

A template is never edited in place. Upload a new version and the catalogue moves to it; every earlier
version stays readable. That is deliberate: **a finished document records exactly which version of the
template produced it**, so a letter sent in March and one sent in September from a template you revised
in June are explainably different rather than mysteriously so.

Templates are archived, never deleted, for the same reason.

## Assembling a document

Pick a template on a matter and produce the document. It runs in the background — you get a handle to
watch, and a moment later the finished document is in the matter's documents.

The document is always a **new** document, never a rewrite of one already there. If you need a second
draft, assemble again.

**Blanks the matter cannot fill are reported to you, and shown in the document.** Where a value is
missing, the document shows a marker like `[LOCATION REMIT TO]` rather than an invisible gap, and the
result lists every field that was missing. Some fields are too important to leave a marker for — a
matter number on a pleading caption, the client's name — and an assembly that cannot supply one fails
and names it rather than producing a document you might file.

**Word merge fields left in the template are reported the same way.** They print text left over from
the template rather than a value from the matter, so the result names each one and marks the document
as needing review before you file it — a blank that does not look like a blank is still a blank.

Assembling needs the **assemble documents** permission, which attorneys, paralegals, and administrators
have.

## The other people on the matter

The client is not the only party a document names. The people and organisations linked to the matter —
the opposing party, opposing counsel, a guardian, a witness — are merge fields too, written the same way
the client is:

```
Re: {{client.displayName}} v. {{opposingParty.displayName}}
Served on {{opposingCounsel.displayName}}.
```

The four roles you can name are `opposingParty`, `opposingCounsel`, `guardian`, and `witness`. Each
offers the party's **name** (`{{opposingParty.displayName}}`) and whether it is a **person or an
organisation** (`{{opposingParty.kind}}`), which is what you write a condition on when a sentence has to
read differently for a company:

```
{{#if opposingParty.kind == "organisation"}}
Defendant is a corporation organised under the laws of the state.
{{/if}}
```

**How you recorded the role does not matter.** A party linked as "Opposing Party", `opposing_party`, or
`opposing-party` is the same role — spacing, capitals, hyphens, and underscores are ignored.

### When the matter has more than one

A field like `{{opposingParty.displayName}}` names **the** opposing party, so it fills in only when the
matter links exactly one. If it links three, there is no single one to name — so nothing is filled in,
the document shows the usual marker, and **the result tells you there were three**, rather than quietly
choosing one for you. A document naming the wrong defendant is the one mistake nobody catches by reading
it.

When your template means "list them all", walk the whole set with a repeat. Each role has a collection
named after it:

```
{{#each opposingParty.all}}
{{loop.index}}. {{opposingParty.all.displayName}}
{{/each}}
```

That works whether the matter has none, one, or a dozen — a matter with none simply produces nothing
where the block was.

**A role you use that is not one of the four** is still reachable: `{{#each matter.parties}}` walks
everyone linked to the matter, and each item carries `role` alongside `displayName` and `kind`.

## Your firm's own fields

Every custom field you have defined on matters is a merge field too. Its name in a template is
`custom.` followed by the field's **handle** — the short code shown beside the field on the field
list, which you can copy from there:

```
Retainer cap: {{custom.customField_9nR2vQ7kLm4xZb1cT6yWd}}
```

The handle is used rather than the field's label on purpose: **renaming a field never breaks a
template.** Rename "Retainer cap" to "Engagement cap" and every template that binds it goes on working
exactly as it did.

Values print the way the field is set up. A currency field prints as money, a number field prints with
the number of decimal places you gave it, a date field prints as a date, a tick-box prints Yes or No,
and a drop-down or a link to another record prints the **choice or the record's name** rather than an
internal code. The renderings you can ask for after a colon are the same ones every field of that sort
offers.

**Archiving a field is safe; deleting it is refused.** If a template uses a field, you cannot hard-delete
it — you are sent to Archive instead. An archived field simply stops filling in: the document shows a
marker where it would have been, and the result names it, so you find out by reading rather than by
someone noticing later.

## The client's protected details

Some of a client's details are held encrypted, and reading one of them is a permission you either have
or do not — a tax identifier, a date of birth. A template can name them, and putting one in a document
changes nothing about who may see it:

```
{{client.socialSecurityNumber}}
{{client.employerIdentificationNumber}}
{{client.dateOfBirth}}
{{client.driversLicenseNumber}}
{{client.accountNumber}}
{{client.socialSecurityNumberLastFour}}
```

These fields are marked **protected** in the merge-field list and on a template's own field list, so
you can see what a template asks for before anyone assembles it.

**Anyone may put one in a template.** Naming a field is not reading it, so writing the template and
registering it need no special permission — nothing is decrypted until a document is actually
assembled.

**Whether it fills in depends on who assembles the document.** If you are permitted to see the client's
protected details, the value is filled in, and the fact that you saw it is recorded — the same record
written when you look the value up on the client's own record. If you are not permitted, the document
is still produced: where the value would have been, the draft carries a visible marker, and the result
tells you which field was left out and which permission would fill it in. Pass the draft to a colleague
who has that permission, or ask for it yourself.

Nothing you are not permitted to see appears anywhere — not in the document, not in the record of what
the assembly did, not in what the screen shows you.

**The details come from the client's record in the Directory**, so the matter has to be linked to
exactly one client there. If it is linked to none, or to more than one, none of these fields fills in
and the result says which of the two it was.

## Your letterhead logo

An office can hold your firm's mark, and a template draws it like any other field:

```
{{location.letterheadLogo}}
```

Put it in the header where the logo belongs. The mark comes from the **matter's office**, not from the
office of whoever pressed the button, so a document assembled by someone in one office on another
office's matter still carries the right letterhead.

Upload the image on the office's own settings: **a PNG or a JPEG**. You set how wide it prints, in
points, and nothing else — the height follows from the picture's own shape, so it can never come out
stretched, and swapping a wide mark for a tall one re-lays out every letterhead at once without your
touching a single template.

If an office has no logo yet, a template that draws one assembles with a visible marker where the mark
would go, and the result names it — the same treatment every other missing value gets.

## Clauses that appear only sometimes

Wrap the paragraphs in a condition. The opening and closing marks each go **in a paragraph of their
own**, and the whole block — marks included — either stays or goes:

```
{{#if matter.eBilling}}
Invoices for this matter are delivered electronically.
{{/if}}
```

`{{#unless …}}` is the same thing the other way round, and reads better when the clause belongs in the
document only when something is _not_ so. Either mark closes it: `{{/if}}` or `{{/unless}}`.

**In a table, put the mark in the first cell of a row and the whole row is what appears or goes.** That
keeps a table's shading and its column widths correct, which removing part of a row would not.

A condition can be as simple as a field's name:

- `{{#if client.code}}` — the clause appears when the matter **has** a client code.
- `{{#if matter.eBilling}}` — for a yes-or-no field, the clause appears when the answer is **yes**.

Or it can work something out:

```
{{#if daysBetween(matter.openedOn, system.today) > 30}}
{{#if matter.status in ("open", "closed")}}
{{#if has(client.code) and not matter.eBilling}}
```

Join conditions with the words **and**, **or**, and **not** — not with symbols. Compare with `==`,
`!=`, `<`, `<=`, `>`, `>=`.

**If a condition cannot be worked out, the assembly stops and tells you which field it needed.** That
is deliberate, and it is the one place the system is deliberately impatient: a clause that is missing
from a filed contract is invisible — nobody reads a document and notices the paragraph that is not
there. When you mean "leave the clause out if we have no value on file", say so with `has(…)`:

```
{{#if has(party.spouse)}}
```

which always answers yes or no and never stops anything.

## Sections that repeat

Wrap the paragraphs — or the table row — in a repeat, naming the collection to walk:

```
{{#each matter.parties}}
{{loop.index}}. {{matter.parties.displayName}} ({{matter.parties.role}})
{{/each}}
```

Inside the block you can use the current item's fields, and four facts about where you are:
`loop.index` (1, 2, 3 …), `loop.count`, `loop.first`, and `loop.last`. A repeat over a row keeps the
table's shading; a repeat over a numbered paragraph keeps the numbering.

A repeat walks a collection your firm's data supplies, or the parts of a split (below). It cannot walk
a filtered or sorted list — if you need one, the list itself is what has to change.

## Working something out

`{{= …}}` writes a calculation into the document. It is a different mark from a plain field on purpose:
`{{matter.number}}` is a lookup, `{{= …}}` is a calculation, and you can tell them apart at a glance.

```
Response is due {{= addDays(system.today, 30):long}}.
Re: {{= concat(matter.number, " — ", client.displayName):upper}}
```

Add `:` and a rendering after the calculation to say how it should look, exactly as you would on a
plain field. A yes-or-no calculation always needs one, because a document should not print the word
"true" — write `:yesNo`, or say it in words with `choose`.

**Dates**

| Write                                                            | You get                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `addDays(date, 30)` · `addMonths(date, 3)` · `addYears(date, 1)` | The date that much later; a negative number goes back           |
| `daysBetween(earlier, later)`                                    | How many days apart, negative when they are the other way round |
| `year(date)` · `month(date)` · `day(date)` · `monthName(date)`   | The date's parts                                                |

The 31st of January plus one month is the last day of February — the month is clamped, never rolled
over into March. There is no business-day or court-deadline arithmetic: that needs a holiday calendar
kept correct for every court forever, and a wrong answer is a missed filing.

**Amounts**

There is no `/` — dividing money is where a system either states its rounding or hides it, so each way
of dividing has its own name and says what it does:

| Write                      | What it does                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| `divideExact(amount, 4)`   | The even share, and **refuses** if it does not come out even to the cent     |
| `divideRounded(amount, 3)` | The share rounded to the nearest cent; what is left over is gone             |
| `allocate(amount, 3)`      | Parts that **add back up to the whole exactly** — walk them with `{{#each}}` |
| `applyRate(amount, rate)`  | The amount at a stored rate                                                  |
| `percentOf(amount, 0.075)` | The amount times a decimal — `0.075` is seven and a half percent             |

Amounts add and subtract with `+` and `-` and multiply by a whole number with `*`. **Two amounts in
different currencies will not combine**, and the assembly says so rather than inventing an exchange
rate: a rate has a date and a source, and a document should not carry one nobody chose.

**Text and choices**

| Write                                             | What it does                                              |
| ------------------------------------------------- | --------------------------------------------------------- |
| `concat(a, b, c)`                                 | Pieces of text joined together                            |
| `upper(text)` · `lower(text)` · `titleCase(text)` | The text recased                                          |
| `has(field)`                                      | Whether the matter supplies that field — always yes or no |
| `default(field, "fallback")`                      | The value, or the fallback when there is none             |
| `choose(condition, "one", "the other")`           | One or the other, spelled out                             |
| `count(collection)` · `isEmpty(collection)`       | How many items, and whether there are none                |

Write text in **double quotes**. A date is written `date "2026-08-04"`.

**Totals across a collection**

Name the collection and the field you want totalled, in that order:

| Write                                | You get                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `sum(matter.parties.amount)`         | Everything in that column added up                      |
| `minimum(matter.parties.incurredOn)` | The smallest — the earliest, when the field holds dates |
| `maximum(matter.parties.amount)`     | The largest                                             |

You can total amounts of money, numbers, and — for smallest and largest — dates. A column of names or
of yes-or-no answers has no total, and the system says so when you register the template. These are the
only calculations that look at more than one item, and they cannot pick and choose: there is no way to
total only some of the rows, or to sort them first. If that is what you need, the collection itself is
what has to change. Your firm's own fields hold one value per matter rather than a collection, so there
is nothing to total across — a total is always over the items of a repeat.

**If the collection is empty, the total comes out blank rather than zero** — and so does the whole
calculation if any one item has nothing on file for that field. That is deliberate. "The smallest of
nothing" is not a number, and a total of no amounts has no currency to be in; leaving out the items
that have nothing would give you a total that does not match the rows above it. When your template
means "nothing on file means nothing owed", say so:

```
{{#if not isEmpty(matter.parties)}}
Total: {{= sum(matter.parties.amount)}}
{{/if}}
```

**If a calculation cannot be worked out, the document shows a marker** where the value would have
been — the same visible blank an ordinary missing field leaves — and the result lists it.

## When a condition or calculation is wrong

You find out **when you register the template**, not when someone assembles a document from it. The
registration is refused and names the part of the document, the words around it, and the position
inside the calculation. A misspelled field name, two things that cannot be compared, a rendering the
result does not support, and a block that opens and never closes are all caught then.

That is the trade the system makes on purpose: the fiddly part happens once, while you are looking at
it, rather than at ten to five on a filing deadline.

There is a limit to how much one calculation may do — roughly, it fits on a line, reads at most a
few dozen fields, and a repeat walks at most a thousand items. A calculation that needs more than that
is a report, not a template.

## What is not here yet

- **A party's own details** beyond their name and whether they are a person or an organisation — an
  address, a telephone number, an email.
- **Protected details for anyone but the client** — an opposing party's date of birth, say.
- **Marking one of your own custom fields as protected.** The protected fields today are the client's
  identifiers held in the Directory.
- **Producing a PDF** directly, and sending an assembled document straight for signature.
- **Writing templates in the browser** — today they are written in Word and uploaded.
