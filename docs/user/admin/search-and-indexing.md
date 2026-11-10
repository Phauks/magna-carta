# Search and indexing

What your firm's searches read is set under **Settings › Data & Platform › Search and Indexing**.
There is one setting today: whether the words inside your firm's files are searched.

Notes, time entries, costs, calendar events, calls, texts and tasks are always searchable. They are
indexed the moment they are saved and there is nothing to turn on.

## Search inside files

**Search Inside Files** is off for every firm until an administrator turns it on. While it is off, a
file is found by its name and its folder's name only.

Turning it on does three things:

- Every file added from then on is read when it arrives, and the words in it are added to an index
  kept in your firm's own storage.
- The files your firm already holds are read in the background. The first hundred or so start
  straight away and the rest follow over the following days, the oldest first, so a large firm is
  not searchable in full on the first day.
- A matter's search gains an **Inside Files** group under Files, naming the documents whose text
  matches and the pages they matched on. See
  [Searching a matter](../features/searching-a-matter.md#searching-inside-files).

The index is a copy made from your files. It does not change who can see anything: a search shows a
file only to somebody who could already open it, and a matter's search reads that matter's files
and no other's.

Turn the switch on or off, then **Save** at the bottom of the page. The change is written to your
firm's audit log.

## Turning it off

With the switch off, no new file is read and **Inside Files** says "Off" in every matter's search.
The index already built is kept, so turning the switch back on picks up where it stopped instead of
reading every file again.

## When the page says the search service is not connected

Beneath the switch the page may say that the platform's search service is not connected yet. That
is about the platform, not about your firm, and nothing you do on this page changes it. You can
still turn the switch on: nothing inside a file can be searched until the service is connected, and
the reading starts once it is.

## Who can change it

Only a member whose role carries the right to manage the firm's search settings, which the firm's
Owner and Administrator roles hold. Everybody else sees the firm's answer on the same page, stated
as a fact rather than as a control they cannot use.
