# Reading the documents in a review set

_Open a review set and it lands on **Documents**, one row per document with how far each one got, why
it got no further, and whether it is searchable yet — and opening a row opens the document itself,
with what the engine read out of it and everything the platform knows about it. The engines that do
the reading and the searching are switched on at deployment; until they are, documents wait rather
than being marked unreadable, and the screen says so. Coding a document, and seeing the original
rather than its text, are the next piece of work._

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

## Being searchable is a separate step, with a separate answer

Reading a document is what makes it possible to search; it is not the same as having searched it. Once
a document has been read, the set queues it to go into that review set's own search index, and each
document says where it got to: **in the index**, **waiting**, or **could not be indexed**.

Three things worth knowing about it.

**Waiting is not a problem with your document.** Exactly as with reading, a document waiting to be
indexed is a fact about the system rather than about the file, and it clears itself when the search
engine is switched on. Because of that, **it never appears in an exception report**. The report is a
list of documents you could not read and hand over; whether your own search has caught up with a
document you read perfectly well is nobody else's business and would be a misleading line to put in
front of the other side. You can see the counts whenever you want; they are just not in that document.

**The index of a review set is its own.** Material another party produced is searched from the review
set and from nowhere else — it does not turn up in an ordinary search of the matter's own files, and
it is never fed to the assistant. If a production is clawed back, the set and everything derived from
it go together.

**Duplicates are indexed once.** The copy a reviewer opens is the one in the index; the other copies
are still in the set, still attributed to the people who held them, and still findable through the copy
that stands for them. See [the manifest and exception report](discovery-exception-report.md).

## Narrowing the list

One control, **Narrow**, above the documents. It narrows by Custodian of Record, by the load a
document arrived on, by whether it was read, by the named reason it was not, and by family — a message
and its attachments, or an archive and its contents, which arrived together and are usually read
together. Opening a document narrows to its family.

The name search sits in there too, and so does the family — both are shown with a line saying where
they are set (the search field above the list; opening a document), because this control is the one
place that answers "why is this list short" and a reason missing from it is how somebody ends up
staring at an empty table.

Searching by keyword, narrowing by date, narrowing by how documents have been coded and grouping
near-duplicates all appear in the same control, unavailable, each saying what it is waiting for. They
are shown rather than hidden so the shape of the finished screen is visible now.

Whatever you have narrowed to is in the address bar, so a narrowed list is a link you can send to
somebody else on the review set — they will see the same documents in the same order.

## Searching the list

Beside **Narrow** is the magnifier every list screen in the product carries. It searches what each
document is **called** — its name, and the path it sat at in the production — across the whole review
set, not just the documents currently on screen. Type, pause, and the list comes back narrowed; the X
at the end of the field, or Escape, clears it, and **Show Everything** brings back what a search and
a narrowing were both holding out.

Three things follow from it being a real narrowing rather than a filter over what is loaded.

**It combines with everything else.** Searching inside a queue you have narrowed to one Custodian of
Record gives you the documents that answer both, never the whole corpus back.

**It goes into the address bar** with the rest of your narrowing, so a searched queue is a link you
can send to somebody else on the review set, and they see the same documents in the same order. Open
such a link and the search field is already open, showing the query that made the list.

**It is not searching inside your documents.** Words in a document's **text** are **Keyword**, in the
Narrow control, and Keyword is waiting on the search engine. The two sit next to each other in that
control so you can see which is which, and the search field says which one it is when you open it —
because believing you have searched a corpus when you have searched its file names is the one
misunderstanding this screen cannot afford.

## Reading one document

Open a row. What you get is three regions, and they are the same read the list was: the **queue** on
the left is the documents you narrowed to, in that order, so the walk is exactly what you were
looking at; the **document** is in the middle; and its **panels** are on the right.

Move with **Previous** and **Next**, or with the bracket keys — `[` and `]` — which work whenever you
are not typing into something. **Back to the list** returns you to the list still narrowed.

What the middle shows depends on the document:

- **A document that was read** shows the text the engine took out of it. That is the same text the
  review set indexed and compared for duplicates, so what you read is what the corpus has.
- **A document that could not be read** leads with the named reason. It is in the corpus, counted,
  and on the exception report — not lost and not skipped.
- **A document nothing has got to yet** says so, and that is temporary: every document ends read or
  not read, never neither.

Seeing the original document rather than its text, its pages, and recognized text laid over the page
it came from are all named on the screen and not built yet, each saying what it is waiting for.

## The panels beside a document

- **Facts** — what it was called and where, its format, size, pages and date (and where the date came
  from), which engine read it, how many of its pages had to be recognized rather than read, and the
  hashes recorded for it. Those hashes are the answer to "how do we know this is the document you
  gave us", and they are here so you do not have to leave the document to find one.
- **Family** — what arrived with it. A message and its attachments, or an archive and its entries.
  Every document belongs to a family even when it is alone in one, so this always has an answer.
- **Other copies** — every other copy of this document the review set holds, and which Custodian of
  Record held each. This is the one to know about: grouping duplicates decides which copy you open
  and never decides who held one, so a suppressed copy keeps its own record. "Which custodians had
  this document" is a question asked under oath, and this is where it is answered.

**Coding**, **Privilege**, **Redactions**, **Near-duplicates** and **History** are listed beside them
and unavailable, each saying what it waits on.

## What this does not do yet

- **Coding a document.** The panel is listed beside the others and says what it waits on.
- **Seeing the original.** You get the text the engine read, which is what a review is decided on;
  the document as it was produced comes through the file viewer, and is named on the screen.
- **Searching the documents' text.** The pipeline that makes a set searchable is built and the
  engine that answers the queries is switched on at deployment. Until then every read document shows
  _Not searchable yet_, which is the platform's own work outstanding and never appears on
  anything you hand over. Searching what your documents are CALLED is a different thing and works
  today — see [Searching the list](#searching-the-list).
- **Searching by meaning.** Keyword search across a review set is what is built. Searching by meaning
  rather than by word is a separate, deliberately unmade decision — it is expensive to run on a
  quarter-million documents and nobody has yet shown that it finds responsive documents a keyword
  search misses.

## Related features

- [Review sets and loading](review-sets-and-loading.md) — building the set in the first place.
- [Coding documents in review](coding-documents-in-review.md) — deciding what each document is.
- [File hash and integrity](file-hash-integrity.md) — the fingerprints recorded for each document.
- [The load manifest and the exception report](discovery-exception-report.md) — the two records a
  load produces, and what every named reason means.
