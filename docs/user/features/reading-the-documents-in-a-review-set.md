# Reading the documents in a review set

_Reading a review set is built, along with the API behind it. The engines that do the reading are
switched on at deployment; until they are, documents wait rather than being marked unreadable, and
the set says so. The screens — the progress view and the exception report a person prints — are
authored when those surfaces ship._

## What it does

Takes every document in a [review set](review-sets-and-loading.md) and reads it: works out what the
file actually is, pulls out its words, counts its pages, finds its date, and records the result. That
is what turns a pile of files into something you can search, sort, code, and produce.

It also does the less obvious half, which is the half you will be asked about: it records, for every
single document, either the text it read or the reason it could not read it. There is no third
outcome and no document that simply goes quiet.

## Why the reason matters as much as the text

The question you will be asked is not "did you search everything". It is "what could you not read,
and what did you do about it". A set of 40,000 documents will always contain some that nothing can
read — a spreadsheet locked with a password nobody at the other firm remembers, a file corrupted in
transfer, a photograph of a whiteboard with nothing legible on it.

The honest answer to that question is a list. Magna Carta produces one.

Every document that could not be read carries a **reason**, and the reasons are specific:

| What you will see           | What it means                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Encrypted**               | The file's contents are scrambled and need a key nobody has supplied. It is not damaged.                       |
| **Password protected**      | The file is locked with a password. Different from encrypted, because a password can be asked for.             |
| **Corrupt**                 | The file is the kind of file it says it is, but damaged past reading.                                          |
| **Unsupported format**      | Read successfully as a file, and nothing here can open that kind of file. The kind is recorded.                |
| **No text extracted**       | Read start to finish and found no words at all. A blank page, a photograph of a wall, an empty spreadsheet.    |
| **Oversize**                | Past a size limit the system will not read past, so that one enormous file cannot stall a whole load.          |
| **Container not expanded**  | A zip or similar. It is in the set as itself; opening it up into its contents is a separate step.              |
| **Container guard tripped** | An archive that tried to expand to an implausible size or write outside where it should. Refused deliberately. |
| **Recognition failed**      | The engine that reads scanned pages could not read this one.                                                   |
| **Conversion failed**       | An older file format that has to be converted before it can be read, and the conversion did not work.          |
| **Virus flagged**           | The file was quarantined when it arrived. It stays in the set and is never opened. See below.                  |
| **Source file missing**     | The document was loaded and its file is no longer in storage.                                                  |

"No text extracted" deserves a note, because it is the one people misread. A document that yields no
words is **not** recorded as an empty document. If it were, a search of the set would confidently tell
you it contains nothing — which is precisely the answer a discovery search must never give wrongly.
It is listed as read but unsearchable, which is the truth, and a person can open it and look.

## The counts always add up

A load is finished only when the number of documents it brought in equals the number read plus the
number with a reason. If a single document is unaccounted for, the load does not finish, and it says
so. That arithmetic is the whole point: it is what turns "we produced everything we could read" from
something a lawyer asserts into something a document shows.

## Some documents are waiting, not failed

If the engine that reads a particular kind of document is not switched on in your deployment yet,
those documents are recorded as **waiting**, with the reason on each one. They are not marked
unreadable, because nothing has tried and failed — nothing has tried at all.

The difference matters. A document marked unreadable is a fact about the document. A document marked
waiting is a fact about the system, and it clears itself when the engine is switched on and the set
is run again. You will never find that a number in an exception report you handed to the other side
quietly changed after a software update.

## How a document gets read

You do not choose. The system decides from the file's own bytes — never from its name, because the
names in a production received from another party are wrong often enough that trusting them is how a
spreadsheet gets read as a picture.

- Most documents are read directly, exactly as written. A contract typed in a word processor gives up
  its real words.
- A page that is a **picture** of text — a scan, a fax, a photographed letter — goes to text
  recognition, which reads the picture.
- A document with **both** kinds of page (a signed contract with a scan stapled on the end) is read
  page by page: the typed pages read directly and the scanned pages recognized. Neither half is lost.
- An **older file format** from the 1990s is converted to its modern equivalent first, then read.

Whichever way it went, **the set records which**, per document, and how many pages were recognized
rather than read directly. That is not bookkeeping. Text read directly from a document is the exact
characters somebody typed; text recognized from a scan is a machine's reading of a picture of those
characters, and it is occasionally wrong. When you find a keyword hit, knowing which kind of text you
found it in tells you how much weight it carries — and if you ever have to explain how you read a
production, you can name it.

## A flagged file is evidence

A file the virus scan quarantined stays in the set, appears in the report, and is **never opened by
anything** — no reading, no recognition, no conversion. It is not deleted. Deleting evidence because
it is unpleasant is not something this system does, and a file the other side produced that turned
out to carry malware is itself a fact somebody may want.

## What this does not do yet

- **Grouping duplicates.** The same document produced by three people is currently three documents.
  Grouping them, while keeping a record of whose files each copy came from, is the next piece of work.
- **Opening up zip files.** An archive is recorded as itself, with the reason above.
- **The printed manifest and exception report.** The counts and the reasons are all recorded per
  document; the two documents a firm hands to opposing counsel are assembled in the next piece of
  work.
- **Searching.** Reading a set is what makes searching possible; the search itself is separate.

## Related features

- [Review sets and loading](review-sets-and-loading.md) — building the set in the first place.
- [Coding documents in review](coding-documents-in-review.md) — deciding what each document is.
- [File hash and integrity](file-hash-integrity.md) — the fingerprints recorded for each document.
