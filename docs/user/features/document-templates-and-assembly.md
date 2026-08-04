# Document templates and assembly

_The template catalogue and the assembly engine are built. The template library, the field inspector, and the assemble dialog are authored when those screens ship; today templates are registered and documents assembled through the API._

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
- **Macros are taken out, and we tell you they were.** If your document contains a macro project, it is
  removed and the count is reported back to you. The template is then re-checked from scratch to
  confirm nothing was left behind; if anything survives, the template is not registered at all.
- **The file is scanned**, exactly as any file you upload is.

You can narrow a template to a matter type or an office, which limits which matters offer it. Every
template is otherwise visible to everyone in the firm who can assemble documents.

Registering a template needs the **manage templates** permission, which owners and administrators
have.

## If your template came from Word mail merge

Word's own merge fields (the grey ones you insert from the Insert Field dialog) are **not** filled in
by this system as they stand — left alone, they would print whatever text Word last cached in them,
which is how a document ends up looking finished and being wrong.

So we look for them and tell you: registering a document that uses them reports **every merge field it
found**, by name, with how many times each appears and which of our fields it would become. Nothing is
changed yet — the document you uploaded is still exactly as you wrote it.

You then choose:

- **Convert them.** Register again asking for conversion, and each merge field is rewritten into the
  `{{field}}` form. This changes the document we store — it is no longer byte-for-byte the file you
  uploaded — which is why it happens only when you ask.
- **Replace them yourself in Word.** Delete the merge fields and type the field names between braces.

If your Word fields are named differently from ours (`ClientName` where we have
`client.displayName`), the report says so rather than guessing at a match, and conversion leaves those
fields unrecognized. Fix the names in Word for now; remembering your firm's own naming between imports
is coming.

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

Assembling needs the **assemble documents** permission, which attorneys, paralegals, and administrators
have.

## What is not here yet

- **Clauses that appear only sometimes,** and sections that repeat once per item (a schedule of
  parties, an exhibit index).
- **Your firm's own fields** — the custom fields you defined — and fields drawn from a matter's other
  parties.
- **Your letterhead logo** as a field.
- **Producing a PDF** directly, and sending an assembled document straight for signature.
- **Writing templates in the browser** — today they are written in Word and uploaded.
