# Document templates and assembly

_The template library is the **Documents** screen in the sidebar: register a template there and add it to as many matters as you like. Template conditions, repeats, and calculations are built. The field inspector, adding a new version to an existing template, and writing templates in the browser are not on a screen yet._

## What it does

Turn a Word document your firm already uses — an engagement letter, a pleading caption, a fee
agreement — into a **template**, then produce a finished document from it against any matter in one
step. The matter's number, its client, its office letterhead, and today's date drop into place; the
result lands in the matter's documents like any other file, ready to open, edit, convert, or send for
signature.

You author templates in Word, the way you already write documents. There is nothing new to learn
about layout, numbering, or styles — a template is a Word document with a few blanks marked in it.

A template can also be **a fillable PDF your firm already has** — a court form, an agency form, your own
intake sheet. The same merge fields fill its boxes; see _Filling in a form your firm already has_.

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

### Finding a field

The list is grouped by what a field is **about** — the matter, the client, the other parties on it,
the firm, this office, the document itself, and your firm's own fields. Search matches more than the
field's name: it matches the words your firm would type. Searching "defendant" finds the opposing
party, "SSN" finds the client's Social Security number, and typing part of the field's key works too
if you already know it.

Some fields sit one step behind the ones you reach for most — whether a party is a person or a
company, the client's sealed identifiers. **Nothing is ever hidden from search.** If a field exists,
typing what you call it finds it.

### Writing a name more than one way

A party's name is not one string to us; it is the parts your Directory record holds. So the same
field can be written the way a letter needs it, the way a caption needs it, or the way an index needs
it:

| What you type                      | What it prints            |
| ---------------------------------- | ------------------------- |
| `{{client.displayName}}`           | Rowan Ashcroft            |
| `{{client.displayName:formal}}`    | Dr. Rowan T. Ashcroft Jr. |
| `{{client.displayName:lastFirst}}` | Ashcroft, Rowan           |
| `{{client.displayName:initials}}`  | R.T.A.                    |
| `{{client.displayName:family}}`    | Ashcroft                  |
| `{{client.displayName:given}}`     | Rowan                     |
| `{{client.displayName:upper}}`     | ROWAN ASHCROFT            |

Writing the field with no colon prints exactly what it has always printed — the name as your record
shows it — so nothing you have already registered changes.

**If the record cannot answer the question, you get a marked gap, not a guess.** A Directory record
that stores only "Rowan Ashcroft", with no surname recorded separately, cannot be written surname
first: rather than print the whole name and look finished, the document shows a marker and the
assembly tells you which part is missing, so the repair is to open the record and split the name.
Asking a company for a surname or a first name is the same: the assembly says so, in those words,
rather than printing the company name where a person's surname belonged.

## Registering a template

Open **Documents** in the sidebar and press **New Template**. Drop in the Word document or the
fillable PDF — which of the two it is, is read from the file — give it a name, and register it. Before
it is stored, we prepare it and tell you what we found:

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
- **The file is scanned**, exactly as any file you upload is. If the scanner is temporarily
  unavailable, registering is refused and says so — nothing is half-registered, and the file you
  uploaded is still waiting, so trying again shortly is all it takes.

You can narrow a template to a matter type or an office, which limits which matters offer it. Every
template is otherwise visible to everyone in the firm who can assemble documents.

### The library

The Documents screen lists every template the firm has registered on one table: its name, its
**standing**, the practice area and office it is narrowed to, and when it was last updated. Sort and
filter from any column's heading, as on every other list. Archived templates are off the table until
you ask for them with **Show Archived** at the foot of the list.

Standing is the column to read before you build:

- **Ready** — the current version cleared its checks; the template can be added to a matter now.
- **Being checked** — the file you uploaded has not cleared the scan yet, or was refused. Nothing can
  be built from it until a version is clean.
- **Archived** — withdrawn from the catalogue. It stays readable so any document it produced can still
  be explained.

Open a template to see what it binds — every merge field its current version uses, and anything it
will print as a blank — and to add it to matters or archive it.

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

## If your template has fill-in-the-blank fields

Word has two other ways to put a blank in a document, and neither is filled in by this system: the old
**form fields** most court forms and older firm precedent are built from, and the **content controls**
Word inserts today. Both look like a blank to whoever is reading the document, and both print their own
prompt — "Click here to enter text." — into every document you build from that template.

The template still registers, and registering it now lists each one: the name its author gave it, what
kind of blank it is, and the exact words the document will print where it sits. The field list keeps
showing them, and **every document you assemble reports them again** and is marked as needing review,
in the same place a missing value would be. If the template is refused for some other reason, the
report still names these — you do not have to fix everything else first to find out about them.

**These cannot be converted for you, and we will not guess what one was meant to mean.** An old form
field's only name is something Word made up, like `Text1`. A content control usually does carry a name
you typed — but a name only means a particular merge field once somebody has said so, and nobody has.
So the fix is yours to make: replace the blank in Word with a `{{field}}` naming the merge field it
should have been.

**A content control you have filled in is left alone and says nothing.** What it holds is your own
text, and Word puts content controls around ordinary content all the time — a cover page, a citation, a
table of contents. Only a control still showing its prompt, or one being filled from data stored inside
the template itself, is reported.

## Filling in a form your firm already has

A great many of the documents a firm files are not letters at all — they are **fillable PDFs**: the
intake sheet, the financial disclosure, the form the court publishes with boxes you can type into.
Register one of those as a template and the same merge fields fill it in.

Choose **a fillable PDF** rather than a Word document when you upload it. Everything else about a
template works the same way: it lives in the same catalogue, it is versioned the same way, an earlier
version stays readable, and a document you build from it lands in the matter's documents like any other
file — as a PDF, which is also the form a signature needs.

### Saying what each box means

A Word template tells us what its blanks are, because you typed them. **A form does not.** All a form
carries is the name whoever built it gave each box — `Petitioner_Name_1`, `TextField12`, sometimes
nothing you would recognise. So when you register a form, you say which merge field fills each box, and
**nothing is guessed on your behalf.**

Registering the form lists every box on it: what kind it is, which page it is on, and whether the form
itself marks it as required. Beside each one you say which merge field it is filled from — and what you
say is **remembered for your firm**, so the next form that uses the same box names arrives already
filled in.

Where a box's name happens to be exactly a merge field's name, we say so and offer it — but it is still
offered, not applied. A box called `ClientName` is not turned into the client's name because it looks
close: that is a decision about a client's details in a document you are going to file, and it is yours
to make once rather than ours to make every time.

### The boxes nothing fills in

**Every box on the form is accounted for, and the ones nothing fills in are listed.** You will see three
kinds:

- **Boxes with no merge field chosen.** Every document you build leaves them empty for someone to
  complete by hand. That is a perfectly reasonable way to use a form — but you will always be told which
  boxes they are, and every document you assemble reports them again and is marked as needing review.
- **Buttons and signature boxes.** Nothing a merge field could do applies to either, so nothing is
  filled into them and no warning is raised about them.
- **Boxes the form does not say the type of.** Occasionally a form declares a box without saying what
  kind of box it is. Nothing is written into one: writing an answer into a box nobody could identify
  would print as a completed entry. Re-save the form from the tool that produced it, or fill it in by
  hand.

If a form binds nothing at all, registering it says so plainly — every document from it would be the
blank form.

### What happens to the form when you register it

The stored template is cleaned first, once, so nothing has to happen on every document: the document's
properties, any attachments, and **anything already typed into the boxes** are removed. That last one
matters — firms usually upload the copy they last filed, and a template still carrying the previous
client's answers is the last thing you want.

### Missing values, in a form

Exactly as in a Word template. A field the matter cannot supply shows the same visible marker —
`[CLIENT ADDRESS]` — inside the box, and the finished document reports it. A field set to stop the
build stops it, naming what is missing.

A tick box and a drop-down have nowhere to print a marker, so they are **left unanswered** and the
report says which box and why. That is deliberate: ticking a box to mean "we do not know" would answer
the form's question wrongly, which is worse than leaving it for a person.

### The filled form can still be edited

A document built from a form template keeps its boxes: whoever receives it can correct a typo or
complete a box you left for them. (Locking a filled form so nothing can be changed is a choice the firm
has not made yet — until it does, the version that can still be corrected is what you get.)

## Updating a template

A template is never edited in place. Upload a new version and the catalogue moves to it; every earlier
version stays readable. That is deliberate: **a finished document records exactly which version of the
template produced it**, so a letter sent in March and one sent in September from a template you revised
in June are explainably different rather than mysteriously so.

Templates are archived, never deleted, for the same reason.

## Assembling a document

There are two doors, and they build the same document.

**From the matter.** On the matter's Files page, **New Document** offers _From a template_: pick a
template and a format, and the document is built onto that matter.

**From the library, onto several matters at once.** Open a template on the Documents screen and choose
**Add to Matters**. Type to find each matter — by its number or its name — and add as many as you need;
choose Word or PDF; then build. Each matter gets its own row while the documents are built, and each
row says what happened to it: **on the matter**, **on the matter with blanks to look at** (and which
blanks), or why it
did not get a document. One matter being refused — because you cannot build on it, say — never stops
the others. When a row has landed, it offers the document itself and the matter's Files page.

Either way the build runs in the background, and a moment later the finished document is in the
matter's documents.

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

### Word document or PDF

Choose which of the two you want before you build:

- **Word document** — the default, and the one to choose while the document is still being worked on.
  You can open it, edit it in the browser, and save a new version.
- **PDF** — the finished form. Choose it when the document is going out to be signed: a PDF is the only
  form a signature can be applied to.

A PDF is converted from the finished document before it is filed, so it takes a little longer than a
Word document does. If the conversion cannot be done, the build **fails and says so** — you are never
handed a Word document in place of the PDF you asked for, because that is the kind of substitution you
would only discover when the signature was refused.

Either way the document lands in the matter's documents like any other file. There is nothing to
convert afterwards and nothing to re-upload.

## The other people on the matter

The client is not the only party a document names. The people and organisations linked to the matter —
the opposing party, opposing counsel, a guardian, a witness — are merge fields too, written the same way
the client is:

```
Re: {{client.displayName}} v. {{opposingParty.displayName}}
Served on {{opposingCounsel.displayName}}.
```

The roles you can name are `client`, `opposingParty`, `opposingCounsel`, `guardian`, and `witness`.
Each offers the party's **name** (`{{opposingParty.displayName}}`, in any of the renderings above) and
whether it is a **person or an organisation** (`{{opposingParty.kind}}`), which is what you write a
condition on when a sentence has to read differently for a company:

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

## Writing about a person without knowing their pronouns

A sentence that says "he signed his declaration" has to be right about the person it is describing,
and a template is written once and used for hundreds of people. So the template does not name a
pronoun; it asks for one.

```
{{= pronoun(client, "subject")}} signed {{= pronoun(client, "possessiveDeterminer")}} declaration.
```

Against a client whose record says she/her, that prints "she signed her declaration". Against one who
says they/them, "they signed their declaration". Against one whose record says nothing — which is most
records — it prints "they signed their declaration" as well. You never write the fallback, and you
never write a condition per pronoun set.

The five positions you can ask for:

| Write                                     | Example               |
| ----------------------------------------- | --------------------- |
| `pronoun(client, "subject")`              | she signed            |
| `pronoun(client, "object")`               | served her            |
| `pronoun(client, "possessiveDeterminer")` | her signature         |
| `pronoun(client, "possessivePronoun")`    | the signature is hers |
| `pronoun(client, "reflexive")`            | represented herself   |

You can name any of the people the matter knows about — `client`, `opposingParty`, `opposingCounsel`,
`guardian`, `witness`, and your own people like `responsibleAttorney`. Misspell one, or misspell a
position, and the template is refused when you register it, not when someone assembles a document from
it.

### Verbs

Here is the part that catches people out: "she signs" but "they sign". A pronoun set changes the verb,
so the template gives both forms and the person's record picks:

```
{{= pronoun(client, "subject")}} {{= pronounVerb(client, "signs", "sign")}} below.
{{= pronoun(client, "subject")}} {{= pronounVerb(client, "is", "are")}} the petitioner.
```

**Write the "he/she" form first and the "they" form second.** That is the whole rule. It works for
every verb, including the awkward ones — `pronounVerb(client, "was", "were")`,
`pronounVerb(client, "has", "have")` — because you supply the words rather than trusting the software
to conjugate. A person with nothing recorded takes the "they" form, so it matches the pronoun.

### When nothing is recorded

The neutral wording is used for three different situations, and all three mean the same thing: nobody
knows whose pronouns to use.

- The person has stated none. Most people have not, and that is not a problem to fix.
- The party is a company, an estate, or another organisation, which has no pronouns to state.
- The matter links more than one person in that role, so there is no single person being described.

In every case the document reads correctly and describes nobody wrongly. If your document needs to
read differently for a company, write a condition on `{{opposingParty.kind}}` — that is a separate
question from pronouns.

### Printing someone's pronouns

A cover sheet or a signature block sometimes prints the pronouns themselves rather than using them.
Every person the matter names has a `pronouns` field for that:

```
{{responsibleAttorney.displayName}} ({{responsibleAttorney.pronouns}})
```

It prints "she/her". Unlike the helper, it prints **nothing at all** when the record states none — no
marker — because a field that reports a fact should not invent one. If you need it to say something in
that case, `{{= default(client.pronouns, "not stated")}}` does it.

Recording pronouns on a person is covered in
[Pronouns on a Directory record](pronouns.md).

## Your own people

The attorneys and staff on your side of the file are merge fields too. The **responsible attorney**
comes from the matter itself — every matter has one. The rest come from the matter's **staffing**: on
the matter, add an assignment naming a member and their working role, and the matching fields fill
in:

```
{{responsibleAttorney.displayName}}, {{responsibleAttorney.title}}
{{supervisingAttorney.displayName}} - {{supervisingAttorney.emailAddress}}
{{assignedParalegal.displayName}}, direct dial {{assignedParalegal.directDial}}
```

The roles are `responsibleAttorney`, `originatingAttorney`, `supervisingAttorney`,
`billingAttorney`, and `assignedParalegal` — and as with party roles, spacing, capitals, hyphens,
and underscores in how you record the role are ignored. Names take every rendering a party's name
does (`{{responsibleAttorney.displayName:lastFirst}}`), the title, email address, and direct dial
come from the member's **professional profile** (an administrator maintains it under Members), and
two people staffed in one role behaves exactly as two opposing parties do: a marker, a note saying
there were two, and `{{supervisingAttorney.all}}` to list them.

**Bar numbers are protected values.** `{{responsibleAttorney.barNumber}}` fills in only for a member
permitted to read protected identifiers, every fill-in is recorded, and it is held on the member's
Directory record — ask an administrator to record it there if the marker says none is held.

## The court and the case

A litigation or probate matter can record its **court case**: the court, the judge, the case number,
the division and department, the filing date — and the two words _this_ court's captions use for
each side. A caption then reads:

```
IN THE {{court.name:upper}}
{{client.displayName:upper}}, {{case.clientDesignation}},
v.
{{opposingParty.displayName:upper}}, {{case.opposingDesignation}}.
Case No. {{case.number}}
```

`{{case.clientDesignation}}` prints whatever you recorded — Plaintiff, Petitioner, Appellant — so
the same template files correctly in courts that use different vocabularies. The judge's name
(`{{court.judge}}`) takes every name rendering. A matter with no court case simply shows markers,
which is the honest state of a draft prepared before filing.

## The estate

A probate matter can record the **estate** it administers, and an estate has several names, each
used in a different place:

```
In the Matter of {{estate.style}}
The decedent, {{estate.decedent}}, died on {{estate.dateOfDeath:legal}}.
Correspondence concerning {{estate.shortStyle}} ...
```

The style — "the Estate of Rowan Ashcroft, Deceased" — is stored **exactly as the court has it**,
never assembled from pieces, because a court-fixed designation has to be stated verbatim. The
decedent's name takes every rendering; the record also carries the proceeding type and the date
letters issued. And when a template lists what the estate owns, the asset register's figures speak
**as of the date of death** automatically.

## Acting in a capacity

When you link a party to a matter you can record the **capacity** they act in — Administrator,
Trustee, Attorney-in-fact. `{{client.capacity}}` prints the word itself, and
`{{client.capacityLine}}` prints the whole phrase a petition opens with:

```
Petitioner: {{client.capacityLine}}.
-> Petitioner: Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased.
```

The phrase is put together for you from three recorded facts — the party's name, the capacity on the
link, and the estate's style. If any part is missing, the whole phrase shows **one** marker and the
result names which part to record. Do not build it by hand in the template: a hand-built
`{{client.displayName}}, as {{client.capacity}} of {{estate.style}}` renders stray punctuation and
three separate markers the moment one fact is unrecorded.

## Your firm's own fields

Every custom field you have defined **on matters** is a merge field too. Its name in a template is
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

**A field you defined on a contact or on an asset is not in this list.** Only matter fields are,
because a document is assembled against one matter and so has one matter row to read a value from. A
contact field's answers live on a contact record, and an asset field's answers live on one of a
matter's many assets — neither is a single value a template could fill in, so offering them here
would give you fields that look available and never print anything.

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

- **A party's own details** beyond their name, capacity, and whether they are a person or an
  organisation — an address, a telephone number, an email.
- **Addresses and signature blocks as fields** — a member's office address, the court's address, and
  the signature block a pleading signs off with. The facts are recorded today; the fields arrive
  with proper multi-line rendering, so an address never comes out flattened onto one line.
- **Protected details for anyone but the client and your members' bar numbers** — an opposing
  party's date of birth, say.
- **Marking one of your own custom fields as protected.** The protected fields today are the client's
  identifiers and members' bar numbers, held in the Directory.
- **A member editing their own professional profile** — today an administrator maintains profiles
  under Members.
- **Pronouns for the judge, the decedent, or one item inside a repeat.** The pronoun helper works on
  the people the matter names singly — the client, the other parties, your own staff. A sentence
  inside `{{#each opposingParty.all}}` cannot yet ask for that item's pronouns.
- **Sending an assembled document out to be signed.** Building it as a PDF puts it in the form a
  signature needs, but inviting someone to sign it — the request, the consent record, and the
  certificate that goes with it — is not built yet.
- **Writing templates in the browser** — today they are written in Word and uploaded.
- **Uploading a new version of a template from the library.** The catalogue keeps every version and
  moves to the newest, but the Documents screen does not yet offer the upload; today a new version is
  added through the API.
- **The field list on the Documents screen for a template that is still being checked** — a template
  shows what it binds once a version has cleared its checks.
- **Locking a filled form.** A document built from a fillable-PDF template keeps its boxes so it can
  still be corrected; making one permanent instead is a choice the firm has not made yet.
- **A library of court forms.** Fillable-PDF templates are the forms YOUR firm supplies. We do not
  publish or maintain a set of jurisdiction forms for you.
