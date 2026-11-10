# Searching a Matter

A matter has a lot of screens and one case in it. The search at the **top right of every matter
screen** asks the whole case a question instead of making you remember which screen the answer is
filed under.

Press the magnifying glass and type. It starts on the screen you are already looking at, and you can
widen it to the whole matter in one click. The **New** button sits beside it, saying what it will
make on the screen you are on, and stays the same size whatever the search is doing.

## Choosing what to search

The dropdown at the left of the search field is the scope. It opens on **This section** — whichever
screen you are on — because that is usually the question. Above the list of sections is **Everything
on this matter**, which searches every part of the matter you have access to.

The scope never goes wider than the matter you are in. Searching the whole application is the job of
the box at the top of the window, which finds screens, settings and tools rather than records. Two
different searches, in two different places, so that neither one surprises you.

Sections that cannot be searched yet are still in the list, greyed out, each with a short line saying
what it is waiting for. They are shown rather than hidden so you can see what the search does and
does not cover.

## What answers today

| Section       | What is searched                                  |
| ------------- | ------------------------------------------------- |
| **Files**     | File and folder names, and the words inside files |
| **Time**      | What the timekeeper wrote about the work          |
| **Costs**     | What the cost was for                             |
| **Parties**   | Names, and the capacity a party acts in           |
| **Notes**     | What each note says                               |
| **Custodian** | Packet names and custody numbers                  |
| **Calendar**  | Event titles and descriptions                     |
| **Messaging** | What was said, the caller's name, and the number  |
| **Assets**    | Asset descriptions                                |

**Assets are searched by description only.** An asset's account, policy and certificate numbers are
sealed, and searching them would let somebody confirm a full number by typing it and seeing whether a
row came back. Its plain public-record identifiers — a parcel number, a vehicle identification number
— are not searched yet either.

**Files are searched two ways, and the results keep them apart.** **Files** lists the files and
folders whose _names_ match. **Inside Files** lists the documents whose _text_ matches, best match
first, and says which pages the words were found on ("Pages 3 and 7"). Open the file and turn to the
page; the result does not quote the sentence yet. See [Searching inside files](#searching-inside-files)
below for what has to be switched on first.

Four sections do not answer yet — Fees, Trust, Emails and Overview — and each says so in the
dropdown rather than being left out.

Fees is the one worth explaining, because a fee you have already billed **is** findable — under
**Billing**, as the line on the invoice that charged it. What is not searchable is an unbilled fee:
the Fees tab is designed around a fee as its own dated record with a description, and the server does
not keep one yet. The fee agreement itself holds only amounts and dates, with no words in it to
match.

## How your words are matched

Sections that hold writing — **Notes**, **Time**, **Costs**, **Calendar** and what was said in
**Messaging** — are searched by word:

- **Type several words** and a record is found when it contains all of them, in any order and
  anywhere in it. "fence neighbour" finds a note that mentions both.
- **The last word can be unfinished.** "ease" finds "easement", so results appear as you type.
- **Put quotation marks around a phrase** to find exactly those words together: "drainage easement".
- **Capital letters and accents do not matter.** "pena" finds "Peña".
- **Part of the middle of a word is not a match.** "sement" does not find "easement".

Sections that hold names and numbers — **Files**, **Parties**, **Custodian** and **Billing** — are
searched by any part of the name or number, so the last four digits of a custody number or a piece
of a file name is enough. A telephone number in **Messaging** is found the same way.

## Searching inside files

**Inside Files** searches the text of the matter's documents, including text recognized on
scanned pages. It follows the same rules as the sections that hold writing — every word you type, the last
one allowed to be unfinished, quotation marks for an exact phrase — with two differences:

- **All of your words have to be on the same page.** A search for "indemnify landlord" finds a
  document where both words appear on one page, not one where they are forty pages apart.
- **Accents matter here.** "pena" does not find "Peña" inside a document; type the name as it is
  written.

A result names the file, the folder it is in, and the pages that matched. When a long document
matches on many pages, the three best are named and the rest are counted ("Pages 3, 7, 12 and 5
more").

Three things have to be true before **Inside Files** can answer, and the results tell you which one
is missing instead of saying nothing matched:

- **"Soon"** means the part of the product that reads inside documents is not switched on yet. File
  and folder names were still searched.
- **"Off"** means your firm has not turned on searching inside its files. An administrator decides
  that for the whole firm, in Settings under
  [Search and Indexing](../admin/search-and-indexing.md). Once it is on, new files are read as they
  are added, and the files already on your matters are read over the following days, the oldest
  first.
- **"Unavailable"** means the service that reads inside documents did not answer this time. File
  and folder names were still searched; try again in a moment.

A file that was deleted is found inside only when **Include deleted** is on, and is marked
**Deleted**, the same as a file found by name.

## Reading the results

Top results appear under the field as you type, grouped by section, each group saying what it
matched on. Click any result to open the record on the screen that owns it.

Two things a group can tell you besides its results:

- **A count with a plus** ("6+") means there are more matches than are shown. It is not a total: the
  search does not count what it has not shown you, and will not pretend it has.
- **"You do not have access to this section"** means exactly that — not that the matter holds
  nothing there. If a section you cannot see were simply left out of the answer, you would come away
  believing the matter was empty when it was not.

## Deleted files

Next to the scope there is an **Include deleted** option, off by default. Turn it on and files the
firm has deleted join the results, each one marked **Deleted** so it can never be mistaken for a live
document — the point is to find something you know was there, not to act on it as though it still is.

It only appears where it means something. Most parts of a matter have no deleted set to offer: a note
is deleted outright rather than hidden, so nothing can bring one back.

## The full results page

**Open full results** at the top of the results panel gives the whole answer its own page, with more
results per section and room to work with them.

That page keeps the search in its address, so you can reload it, bookmark it, or send the link to a
colleague and they will land on the same search. Bear in mind that this puts part of what you typed
into your browser history, on a page that already names the matter.

## Two things it will never do

**It will not find another matter's records.** Every part of the search is bound to the matter you
are in.

**It will not reach material another party produced to you in discovery.** That holds for searching
inside files too. Those documents live in
their own separate index, under their own access rules, precisely so that an ordinary search of the
matter cannot surface something that may be restricted under a protective order. Search a review set
from the review screens, where those rules apply.

## Notes are searched as they read now

Searching Notes matches what each note **currently** says. If a note has been corrected, the earlier
wording is not matched, and a withdrawn note is not matched at all.

This is deliberate. Correcting a note to take out a name that should not have been there has to stop
the note being findable by that name — otherwise the correction changed what the note says without
changing what it gives away. The earlier versions are still readable from the note's own history,
where you have already chosen to look at that note.

## Related

- [Matter Notes](matter-notes.md) — writing, correcting and withdrawing notes
- [Matter Documents](matter-documents.md) — the matter's files and folders
- [Asking a Question of a Matter's Documents](asking-a-question-of-a-matters-documents.md) — the
  separate, opt-in question-answering surface over document text
