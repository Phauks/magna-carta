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
  kept in your firm's own storage. The text that was read is kept beside it, also in your firm's
  own storage, so that a result can quote the passage it matched.
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
The index already built, and the text kept beside it, stay in your firm's storage, so turning the
switch back on picks up where it stopped instead of reading every file again.

## When the page says the search service is not connected

Beneath the switch the page may say that the platform's search service is not connected yet. That
is about the platform, not about your firm, and nothing you do on this page changes it. You can
still turn the switch on: nothing inside a file can be searched until the service is connected, and
the reading starts once it is.

## What is indexed

Beneath the setting, the page shows what your firm's indexes hold. The figures are counted from
your firm's own records at the moment the page opens; **Count Again** counts them afresh.

**What Is Indexed** has a line for each of the three indexes:

- **Records** covers notes, time, costs, calendar events, calls and texts, tasks and Magnus
  conversations. It reads **Up to Date** when the index holds exactly the records your firm does,
  and **Behind** when it does not. Behind should not happen in ordinary use. When it does, a
  **Rebuild** line appears beneath it; see [Rebuilding a place that is behind](#rebuilding-a-place-that-is-behind).
- **Inside Files** shows how many of your firm's files have had their words read. It reads **Turned
  Off** while the setting above is off, **Not Connected** while the platform's search service is not
  connected, **Partly Indexed** while some files are not in the index, and **Up to Date** when all
  of them are.
- **Search by Meaning** shows whether your firm has turned that on.

Hover over any of these words to read what it means.

**Indexed Places** lists every place whose text is indexed, with how many of its records are
indexed, how many are not, and which searches read it. The table sorts and filters like every other
table in the product.

Three things the figures do not include:

- A file with no words that can be read, such as a scanned page that has not been through text
  recognition, stays in **Not Indexed** for as long as that is true. So Inside Files can read Partly
  Indexed after every readable file has been read.
- The files your firm held before it turned the setting on are read in the background, up to
  1,000 started each day, so a large firm's figure climbs over several days.
- A discovery review set is searched only from inside that set, by the people with access to it, and
  is not counted on this page.

Names and numbers, such as a file's name, a party's name or an invoice number, are matched where
they are kept and do not appear in the table, because they need no index.

## Rebuilding a place that is behind

An index is a copy of what your firm's records say. If a place reads **Behind**, the copy and the
records disagree, and a search of that place can miss a record or find one that has since changed.

1. Under **What Is Indexed**, find the **Rebuild** line beneath **Records**. It is there only while
   a place is behind.
2. Click **Rebuild**.

The line changes to **Rebuild Asked For** with the time you asked. The rebuild starts within a few
minutes and runs in the background, so you can leave the page. It reads the places that are behind
again from your firm's records. It changes nothing your firm holds: no note, time entry or message
is edited, and nothing is deleted.

Click **Count Again** to see where it stands. When the rebuild has finished, the line goes away and
Records reads **Up to Date**. If Rebuild Asked For is still showing after a quarter of an hour,
click **Ask Again**, and if the place still reads Behind afterwards, tell support which place it
is.

The firm's audit log records who asked for a rebuild, and which places each rebuild read again.

Rebuild covers the records. Files are different: the files not yet read are picked up by the daily
background reading described above, and there is nothing to press for them.

## Who can change it

Only a member whose role carries the right to manage the firm's search settings, which the firm's
Owner and Administrator roles hold. Everybody else sees the firm's answer on the same page, stated
as a fact rather than as a control they cannot use. What the indexes hold is shown to the same
members who can change the setting, and the same members can ask for a rebuild.
