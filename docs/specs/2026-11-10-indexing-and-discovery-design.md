# Indexing and discovery — design

**Date:** 2026-11-10
**Status:** Approved by the owner on 2026-11-10 ("I approve, begin work to fulfill this"). Steps 1
and 2 of the build order below are built by the change that adds this file. The owner moved file
contents in a matter's search ahead of steps 3 and 4 the same day; its reading half is built (step
6a below). The status screen's counts (section 4.1) and the search across matters (section 4.2)
followed, then the queued rebuild of a place that reads Behind (section 4.1), then the marking of
a reader's words in a result (section 4.3). The build order in section 5 says what is not built.
**Scope:** How the platform finds things: which indexes exist, what each one is for, who may ask
each one what, and the order the missing parts are built in. It adds one index — the **record
index**, over the text held in a firm's own database rows — and fixes the rules every index and
every asker follows.
**Excludes:** any change to the keyword engine's internals
([`2026-07-17-discovery-search-index-stateful-service-design.md`](2026-07-17-discovery-search-index-stateful-service-design.md)),
to natural-language search
([`2026-08-06-ai-search-integration-design.md`](2026-08-06-ai-search-integration-design.md)), or to
the Directory's own name index. Semantic search stays deferred on its open cost flag.

**Binding inputs, in order of authority:**

- The owner's direction of 2026-11-10: indexing and discovery "fundamentally deals with the
  structure of the program and data", and the approval above of the proposal this file records.
- The owner's ruling of 2026-11-10, given on the conflicts redesign: there are no private Magnus
  conversations, and general ones may be searched.
- Golden rules 3 (all business data through the firm-scoped data-access layer) and 10 (measure
  before optimizing) in the root `CLAUDE.md`.

## 1. Where things stood

Five things could find something, and none of them knew about the others.

| What                    | Finds                                    | How                                              | State on 2026-11-10                                 |
| ----------------------- | ---------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Directory name index    | People and organizations, by any name    | A trigram full-text table in the firm's database | Live                                                |
| Matter search           | Records on **one** matter, nine sections | A substring scan of each section's table         | Live                                                |
| Keyword engine          | Words **inside files**                   | Tantivy splits in the firm's bucket              | Built, dormant until the search service is bound    |
| Natural-language search | Passages in a matter's documents         | A managed index fed derived text                 | Feed built; retrieval waits on two live experiments |
| Discovery review        | Documents another party produced         | The keyword engine, one corpus per review set    | Reading built; coding has no screen                 |

Three gaps follow from that table.

1. **Nothing could search the text in rows across matters.** A note, a time narrative, a call
   summary, a task and a Magnus conversation are all rows, and the only search over them was fenced
   to one matter because a scan is affordable only behind that fence. A conflicts check and a search
   across matters have no such fence. The conflicts check was reading Messaging, Tasks and Magnus
   with firm-wide substring scans, and the firm-wide note search was recorded as waiting on "an
   index decision".
2. **There was no one list of what is searchable.** Matter search had a registry of sources; the
   conflicts check had its own; a status screen had nothing to read.
3. **The rules were restated per subsystem**: what may be indexed, who may read which corpus, what
   happens when an index is wrong.

## 2. The design: one front door, three indexes, three rules

**One front door.** One list of searchable places. Each place is declared once — which table, which
columns are its words, which matter a row belongs to, when a row is in or out — and everything else
is derived from the declaration. A search surface, a conflicts check and a status screen all read
that list.

**Three indexes, by where the text lives.**

1. **The record index (new).** Text that lives in database rows is indexed in the same database, in
   a full-text table kept current by triggers. Section 3.
2. **The keyword engine (unchanged).** Text inside files is bulk content, lives in object storage,
   and is indexed there. What it lacks for a firm-wide question is a way to know which matters could
   match without opening every matter's splits; step 6 adds a per-split word summary to the catalog
   for that.
3. **Natural-language search (unchanged).** Its own consent gate, feed and managed index.

**Three rules.**

1. **Access is checked twice.** Once in the question, so a record the reader may not see cannot use
   up a place in the answer or reveal by its absence that it exists; and once on each result, by the
   statement that reads the record, behind that record's own rules. An index only ever proposes.
2. **Each asker has a named reach.** A person's search reaches the matters that person may see. A
   conflicts check reaches the whole firm, because a conflict is imputed across the firm. A
   discovery reviewer reaches one review set and nothing else, and nothing else reaches a review
   set. No index may be read without one of these named.
3. **Every index is a copy.** It can be derived again from the records it points at, so a rebuild
   loses nothing and a wrong index is repaired by rebuilding, never by hand.

## 3. The record index

### 3.1 What is in it

Eight sources, all prose:

| Key                    | Table                 | Words                                                               |
| ---------------------- | --------------------- | ------------------------------------------------------------------- |
| `notes`                | `matter_note`         | the note's text                                                     |
| `time`                 | `time_entry`          | the narrative                                                       |
| `costs`                | `cost_entry`          | the description                                                     |
| `calendar`             | `matter_event`        | the title and the description                                       |
| `communications`       | `communication`       | the summary, the body, the caller's name                            |
| `tasks`                | `matter_task`         | the title and the description                                       |
| `magnus-conversations` | `magnus_conversation` | the title, while the conversation is not deleted                    |
| `magnus-turns`         | `magnus_turn`         | a complete turn's content, under a conversation that is not deleted |

The declarations are `packages/search/src/record-index-sources.ts`.

**Deliberately not in it:**

- **Names and numbers** — a file's name, a party's name, a custody number, an invoice number, a
  telephone number. A person typing part of one means the characters, and a word index refuses the
  middle of a word. They stay on substring matches over their own columns.
- **Protected columns.** An index over an encrypted identifier would let somebody confirm a value
  without holding the capability to read it. A fitness test refuses a source that reads one.
- **Review-set tables.** Material another party produced is searched only from inside its own
  review set. The same fitness test refuses it.
- **Email.** One message can be filed on several matters, so its matter is not a column on the row;
  it joins when the Emails section has its own search.

### 3.2 Its shape in a firm's database

Two tables:

- `record_text_entry` — one ordinary row per indexed record: the source, the record's identifier,
  the container a reader opens where that is not the record (the conversation a turn belongs to),
  the matter, and a sort key.
- `record_text_fts` — a **contentless** full-text table keyed by the entry's row id. It holds terms
  and positions and none of the text, so a match is a pointer and the words a reader is shown are
  read from the record itself, behind the record's own access rules. The index cannot disagree with
  a record about what it says, because it cannot show anything.

The full-text table has three columns: `title`, `body`, and `scope`, which holds one token that is
not a word — the record's matter in hexadecimal, or `nomatter`. A question about one matter names
that token, so narrowing to the matter is an intersection inside the index.

### 3.3 How it stays current

**Triggers on the source tables are the only write path.** Each source has an insert, an update
(of only the columns it reads) and a delete trigger; a source with a container has two more on the
container. A trigger runs in the statement that changed the record, inside the same transaction, so
the index is never behind and a write that rolls back takes its index row with it. No domain
package calls the index when it saves, which is what makes it impossible for a write path to forget
it — including the write paths that erase.

Insert and update both remove whatever the index holds for the row and derive it afresh. That is
what makes a replacing insert safe (it deletes the old row without firing a delete trigger) and
what takes a record out of the index when it stops being searchable.

The triggers, the statements that fill the index for records that predate it, and the statements
that rebuild it are all rendered from the declarations by `packages/search/src/record-index-schema.ts`
through one select per source, so the three cannot come to index a record differently. A fitness
test applies the whole migration lineage to a fresh database and compares its triggers word for
word with what the declarations render today: a source edited after its migration shipped, a source
added without one, or a later migration that rebuilds an indexed table and silently drops its
triggers all fail there.

### 3.4 What a question means

A reader's text is never query syntax. It is taken apart into the tokens the index itself would cut
it into and the match is rebuilt from those tokens alone, each one quoted, so an operator or a stray
quotation mark is text.

- every word typed must be in the record;
- the last word matches as the start of a word, unless the text ends in a space;
- words inside quotation marks match as that exact run;
- a word with punctuation in it ("O'Brien", "2026-0142") matches as its pieces, adjacent and in order;
- case and accents do not matter.

It is a word match, not a substring match: "ease" finds "easement" and "sement" does not.

### 3.5 What was measured, and what it changed

Basis: `packages/search/scripts/measure-record-index-shapes.mjs`, run on 2026-11-10 in the build
container (Node 22 with its bundled SQLite 3.53) over a generated firm of 200,000 records and 42.8 MB
of text. The corpus is synthetic and the timings are that machine's; the comparisons between shapes
are the finding, not the absolute figures.

| Question                                    | Substring scan           | Record index (as built)    |
| ------------------------------------------- | ------------------------ | -------------------------- |
| A rare word, across the firm                | 64 ms                    | 0.015 ms                   |
| A two-word phrase, across the firm          | 87 ms                    | 0.1 ms                     |
| A mid-frequency word, across the firm       | 4.2 ms                   | 1.3 ms                     |
| A word in most records, ranked              | 0.05 ms (first 51 found) | 77 ms (every match scored) |
| A rare word, inside one 3,000-record matter | 2.1 ms                   | 0.03 ms                    |

Three decisions came from the first cut being measured rather than assumed:

1. **No prefix indexes.** They took the index from about 60% of the size of the text to about 160%
   and made a part-typed word no faster a reader could notice.
2. **The source is a column on the entry row, not a token in the index.** As a token it was the
   slowest step of every selective question (3.7 ms added to a 0.015 ms read), because a source's
   token is on every one of its records.
3. **The matter stays a token.** For a mid-frequency word inside one matter it is 0.14 ms against
   0.6 to 0.8 ms filtering afterwards, for at most 5% more index.

Two limits the measurements show, stated so nobody finds them later:

- **A ranked read costs in proportion to the records that match.** A word in nearly every record is
  the slow case. The top-bar search (step 4) takes unselective text from a person and must bound
  that — a minimum length, or recency order for an unselective question.
- **The fill runs inside the migration.** It took about four to six seconds per 200,000 records
  here. That is right for the firms that exist today; a firm past roughly a million indexed records
  should have its fill moved to the rebuild path in batches before it applies this.

Inside one matter, measured with the real matter-search statements on a 3,000-entry matter in a
63,000-entry firm: 0.08 ms against 1.6 ms for a rare word, 0.25 ms against 2.5 ms for a word in
about 1% of entries, and 2.0 ms against 1.8 ms for a word in a quarter of them. The index is much
faster where a search is selective and about the same where it is not.

### 3.6 Erasure

A record that is deleted or scrubbed leaves the index in the same statement, by trigger, and stops
being findable at once. What the index's storage still holds until it next reorganizes is a marker
beside the old terms, as a deleted row of any table lingers on its page. `optimizeRecordIndexStatement`
rewrites the index without them; a test reads the stored bytes to prove it. An erasure pass that
needs the words gone, not merely unreachable, ends with it.

## 4. File contents in a matter's search

The words inside a matter's files are in the keyword engine's index, one corpus per matter, outside
the firm's database. A matter's search reads it as a second source on the Files section, beside the
match on file and folder names.

- **Two answers, not one fused list.** A name match is a listing, newest first. A match inside a
  document is ranked by how well the page answers the words. The two cannot be ordered against each
  other, so each is its own group with its own heading, as every other pair of sources is.
- **The index proposes; the firm's own table decides.** The engine answers with file identifiers and
  the page each match was on. The source then reads those files from `file` in an ordinary bounded
  statement that binds the matter and composes the visibility predicate. A file the index names
  that is filed elsewhere, or is gone, is not a result. This is the first rule of section 2 applied
  to an index that is not in the database.
- **A reader's text is never the engine's query syntax.** The text is taken apart by the record
  index's parser and the engine's query is rebuilt from the words: every word required, quoted runs
  as phrases, the last word as the start of a word. The engine accepts a pattern over its one field
  for that last case, and only the application builds one, from letters and digits.
- **A review set stays out of reach.** The application asks for the matter's corpus and no other,
  and a review document is not a row of the table the source reads.
- **Three answers that are not "no matches".** The search service not being part of the deployment
  yet; the service failing to answer; and the firm not having turned indexing on. A reader acts
  differently on each, and differently again on an index that was asked and found nothing, so each
  is said.

**A result quotes the sentence it matched, and the words come from the firm's storage, not from the
index.** The index stores which words are on which page and not the sentences, and it is asked by a
service that is believed about candidates and nothing else. So the index job keeps what it
extracted: one object per indexed version of a matter's file, in the firm's own bucket, holding the
same passages the split was built from. Three things follow from where it sits.

- **It is written before the catalog says the document is searchable.** A failed write fails the
  job and the queue retries it, so a search never returns a file it could not quote because of a
  write nobody noticed. A version indexed before the text was kept simply has none, and its result
  names its pages alone.
- **It is read only for a row the search is about to show.** The search's own statement has by then
  returned the file under the matter binding and the visibility predicate. The reader then asks one
  more statement which version of each file the index holds, and it answers only for a file on this
  matter, not deleted, whose indexed version is still clean. The passage the index named is read
  from that version's object by range, and the reader's words are found in it again by the engine's
  own rules for cutting and folding a word, so a match the engine made is a match the excerpt finds.
- **It lives exactly as long as the version's own bytes.** It says nothing the version does not. A
  review document is not written: its text is the review pipeline's own object, released when the
  review set closes, and a second copy would outlive it.

A quote is an addition to an answer. A missing object, a passage the words are not in, or storage
that does not answer leaves the result naming its pages, and is never a failed search. The excerpt
is plain text, and where the reader's words are in it is said beside it (section 4.3).

Three things are recorded and not solved. Nothing destroys a derived copy of a version today, the
split, the natural-language feed object or the kept text, because nothing destroys a committed
version: the purge point in `packages/file-manager/src/file-service.ts` is where all three go
together when the retention engine calls it. Turning a firm's switch off stops new reading and
deletes nothing. And a document read as one passage (plain text, a spreadsheet) is read to its
first 256 kibibytes for a quote, so a match past that point names the file and quotes nothing.

One limit recorded earlier is closed. The engine lowercased a word and left its accents; now it
composes a letter and its accent into one character, folds Latin letters to their unaccented form
and lowercases, so a file search ignores accents as the record index does. That changed how every word is cut, so it is a new
schema generation, taken before the first production index existed because afterwards it means
rebuilding every index. What remains recorded is the mechanism for that rebuild: the catalog keeps
each split's generation, and nothing yet re-indexes the splits of an older one.

### 4.1 What a firm is shown about its indexes

Beneath the switch, the Search and Indexing settings page states what each index holds. It is one
read, `GET /api/v1/firm/search-status`, behind the permission that governs the switch, and it
follows three rules.

**Every figure is counted when asked.** Nothing is stored between reads. For each declared source
of the record index the read counts the index's rows and, separately, the records that belong in
the index, from the source's own table through the same select the triggers and the rebuild are
rendered from (`recordIndexExpectedCountSelect`). The two agree unless the copy has fallen behind
its records, which is the one condition the screen exists to show: a place whose counts differ
reads **Behind**. For files it counts the current, clean version of every live file and how many of
those the catalog holds, as a version's own live split or as a live member of a merged one.

**The count and the repair use one definition.** The daily repair pass finds the files to index
with the same "held by the index" predicate the screen counts with
(`packages/file-manager/src/queries.ts`), so a firm is never shown nothing outstanding while the
pass still has work. Writing that predicate once also corrected the pass: it had looked only for a
version's own split, so every file a merge had folded into a larger split would have been sent to
be indexed again each day.

**It says only what it can know.** A file the index does not hold is "not indexed", never
"waiting": a file whose words nothing can read leaves no catalog row and stays in that number. A
discovery review set is not counted at all, because each set's index is its own corpus behind that
set's access list and a firm-wide total would be a read across it by a settings permission. Each
source declares which searches read it (`readBy`), and a test compares that declaration with the
source keys the matter search and the conflicts check name in their own statements, so the "Read
By" column cannot drift from the code.

The read is proportional to what the firm holds: one pass over each indexed table and one over the
live files. On a synthetic firm of 200,000 files with three quarters indexed the files count took
about a quarter of a second in an in-memory SQLite database, so it is asked once when the page
opens and again only when a member presses Count Again. It is not for polling.

**A place that reads Behind can be rebuilt, from a queue.** While any place is behind, a row
beneath Records offers Rebuild. A rebuild is work in proportion to the place, so the request
(`POST /api/v1/firm/search-status/rebuild`, the same permission) does none of it: in one batch it
writes an audit row naming who asked and a message on the firm's outbox, and answers at once. The
per-firm job queue's consumer does the work
(`apps/api-worker/src/search/record-index-rebuild.ts`), and four choices in it are deliberate:

- **The message names no place.** The consumer counts again when it runs and rebuilds the places
  that are behind at that moment. A list carried from the request would describe the past by the
  time it arrived, and a redelivered message would rebuild a place the first delivery had put
  right. As built, a second delivery counts, finds nothing behind and rebuilds nothing.
- **One place is one transaction**, so a search never reads a place half rebuilt, and the places
  are separate transactions so a large place does not hold the others inside its own.
- **"Behind" has one definition** (`recordIndexPlaceIsBehind`), shared by the screen and the
  rebuild, so a place the screen names is exactly a place the rebuild takes. It is "the counts
  differ", in either direction.
- **Whether a rebuild is outstanding is read from the audit log.** A completed rebuild writes its
  own row, with the keys of the places it took and no actor. A request with no completion at or
  after it is a rebuild still to run, and the status read says so, which is how the page shows
  "Rebuild Asked For" to a member who opens it later. These are moments and not figures, so the
  rule that nothing is stored still holds for every count.

The outbox is relayed every five minutes, so a rebuild starts within that and the page says "within
a few minutes". The cost of the work is the fill's: four to six seconds per 200,000 records where
the index's shape was measured (section 3). Two things are not built: a rebuild for the file
contents index, whose equivalent is the daily repair pass, and a rebuild in steps for a firm past
roughly a million indexed records, which should not run one place as one transaction.

A firm's database refuses a compound SELECT of more than five terms, and there are eight sources,
so the expected counts are one row with a column per source and not a row per source.

### 4.2 The search across matters

One question, asked of every matter the reader may see. It is the matter search's sibling: the same
registry of sources, the same two permission gates, the same groups in the same order, read through
a second door.

**A source says whether it answers across matters.** Each source in
`packages/matter-search/src/sources/all.ts` may carry an `acrossMatters` declaration beside its
one-matter statements: what it matches on across matters and the statements that do it. A matter's
own search is unchanged by this. Its builder still binds one matter and cannot be handed a
statement without one; the across-matters builder (`visibleMattersSearchSelect`) binds no matter
and composes the visible-matter predicate in its place, before the limit. A source with no
declaration is not run and is reported as `one-matter-only`, so the page can say what it did not
look at.

| Place        | Across matters                                  | Why not, where not                                         |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Files        | File names and folder names                     |                                                            |
| Inside Files | No                                              | The file contents index is one corpus per matter           |
| Time         | Narratives, through the record index            |                                                            |
| Costs        | Descriptions, through the record index          |                                                            |
| Billing      | No                                              | A substring scan of one matter's invoice lines and numbers |
| Parties      | No                                              | A substring scan; a person is found through the directory  |
| Calendar     | No                                              | Open with the owner (section 6)                            |
| Notes        | A note's current text, through the record index |                                                            |
| Custodian    | No                                              | Substring scans of one matter's packets                    |
| Messaging    | What was said and the caller's name             | A telephone number is matched inside a matter, not across  |

**What it costs is bounded before it runs.** Inside a matter the record index is narrowed by the
matter's token, so a common word costs what that one matter holds. Across matters there is no such
fence: a statement that joined every match to its own table and then sorted would read every
record containing the word. So the across-matters form (`recordIndexNewestMatchesFrom`) takes the
newest matches of the index first, up to a cap of 2,000 across all sources, and only those are
joined, checked against the visible-matter predicate and the source's own conditions, and sorted.
A second statement counts the matches up to one past the cap. When it reaches that, the answer is
marked `broad`: the groups then hold the most recent records with those words and not every one,
and a group with no hits has not shown that its place holds none. The page says so in words.

`packages/matter-search/scripts/measure-across-matters.mts` builds 200,000 records and 200,000
files over 400 matters and times the read. On the machine that built this:

| Question                             | Capped at 2,000 | Uncapped |
| ------------------------------------ | --------------- | -------- |
| A word few records hold              | 0.7 ms          | 0.7 ms   |
| A word one record in a hundred holds | 6.8 ms          | 6.8 ms   |
| A word every record holds            | 25.7 ms         | 362.8 ms |
| A common word typed part way         | 25.7 ms         | 346.6 ms |

A cap of 500 saved about two milliseconds on the worst case and marked the one-in-a-hundred word
broad; a cap of 10,000 cost thirteen more. File and folder names read no index. They are a
substring match over the firm's file table, which cost between 21 and 71 ms on 200,000 files, and
that cost grows with the number of files a firm holds. A name index is the step to take for a firm
several times that size, measured first.

**Matters and people are found by the reads their own screens use.** The page asks the matters
listing for its title, number and client match and the directory for its name match, beside the
search across matters, and presents the three as one list of places. Nothing new matches a name.

**No totals.** A group says how many results are on screen and whether there are more, measured by
reading one row past the limit. The proposal's drawing showed "Top 3 of 14". Counting to fourteen
is a second read of everything the first one bounded, so the page does not claim it.

**A snippet is shown.** The notes design held that a firm-wide result should carry no excerpt and
put the question to the owner as its flag W6
([`2026-08-15-notes-and-activity-design.md`](2026-08-15-notes-and-activity-design.md), section 10).
The proposal the owner approved on 2026-11-10 drew a line of matched text under each result and
its build order says "snippets shown", so that is what is built. Each excerpt is returned only for
a record on a matter the reader may see, from a place whose own read permission the reader holds.
Turning it off for one place is that place's `acrossMatters` declaration answering no excerpt.

**One permission.** The route, `GET /api/v1/search`, is gated by `search:matter`, the key the
matter search already uses, with the firm as its resource. A second key would have been refused to
every member of every firm until a seed migration granted it, and it would have asked a firm to
understand two permissions for one capability whose reach is decided by the visible-matter
predicate and each place's own read permission in both cases.

**Reached from the top bar.** The palette there finds the application's own screens, as before.
Its last row sends whatever was typed to the page at `/search`, where the question and the chosen
place ride in the address.

Not built in this step: the scope choices other than every matter the reader can see (one client,
only my own matters), and the places the table above answers "No" for.

### 4.3 Where the words are in a result

A result marks the words that answered, in a matter's own search and in the search across matters
alike. Both answers carry, on every hit, `titleMarks` and `snippetMarks`: where each run of the
reader's words begins and ends in the text beside it. Four choices in it are deliberate.

**The words are found again on the server, by the rules of the index that made the match.** An
index says a record answers and not where in the record. So the text is cut into words and each
word folded the way that index does it, and each term is matched the way the question asked for
it: a whole word, the start of the last word typed, or a quoted run in order
(`packages/search/src/matched-text.ts`). The record index and the file contents index cut and fold
differently, so there are two sets of rules and one finder. A browser that looked for the words
itself would be a third opinion about what a word is, written in the one place that cannot see
either index.

**A place declares how each text it shows was matched.** Every source of the matter search carries
a `marking`: the rule for its title and the rule for its excerpt, or none
(`packages/matter-search/src/sources/all.ts`). A note's words are found by the record index's
rules and its title, a date, is left alone. A file's name is matched as the characters typed,
wherever they fall, so "0142" is marked in the middle of a name. A file found by the words inside
it marks the sentence and not the name. One rule for every place would mark a date, or mark a name
for words that are not in it.

**A long text is quoted at its match, and no longer sent whole.** A note's excerpt used to be the
note. A result shows two lines of it, so a match on the fortieth line was below what the result
showed, and a page of fifty results carried fifty notes to draw a hundred lines. A text matched
through the record index is now cut to about two hundred characters around the stretch that holds
the most of the question, by the same cutting a file's sentence already had. A text short enough
to show is sent as it is. A record that matched on something its text does not hold (a call found
by the caller's name) shows the opening of what was said, with nothing marked.

**It is the last step and decides nothing.** The marks are made after the statement has bound the
matter or composed the visible-matter predicate, after the limit, and after the source has
projected its row. The step rewrites two texts of a hit and attaches offsets. It cannot add, drop
or reorder a result, so nothing about access rests on it, and a word it fails to find costs a mark
on a result that is still there. That is also why the record index's folding is allowed to be
close and not exact here: it takes accents off and lowers capitals, which is what the index's
tokenizer does to Latin letters, and a script the tokenizer treats differently loses a mark.

A mark is two offsets in UTF-16 code units, the end not included. The screen draws each run with
the `mark` element over a pale wash of the accent colour, with the text colour of the line around
it, and treats the offsets as untrusted: marks that are absent, out of order or past the end of
the text are dropped, and the text is shown whole.

Not built: marking a matter's title or a person's name in the two groups the Search page reads
from the matters listing and the directory, which carry no marks of their own.

## 5. Build order

| Step | What                                                                                        | State                                                                               |
| ---- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | This specification and its decision record                                                  | Built                                                                               |
| 2    | The record index, the list of searchable places, and matter search reading it for prose     | Built                                                                               |
| 3    | The Search and Indexing status screen: what is searchable, how much is indexed, rebuild     | Built (section 4.1): counts, standings, and a queued rebuild of the record index    |
| 4    | Search across matters from the top bar, snippets shown                                      | Built for five places, with matters and people by name; words marked (4.2, 4.3)     |
| 5    | The conflicts check reads the record index instead of scanning                              | Built                                                                               |
| 6a   | A matter's search reads the file contents index: files whose text matches, and their pages  | Built; answers once 6b is done                                                      |
| 6b   | File contents turned on: the firm's switch, and the search worker deployed and bound        | Switch built; needs the owner's steps in [`../deploy-queue.md`](../deploy-queue.md) |
| 6c   | The kept text that lets a file result quote its sentence, and the per-split word summary    | Kept text and the quoted sentence built; the word summary is not                    |
| 7    | Discovery review screens: coding, and refusing removal of the last person on an access list | Coding panel waits on two owner questions                                           |

## 6. Open with the owner

- **Calendar events across matters.** The firm-wide timeline withholds an event's title from a
  reader outside its matter. A search across matters that matched event titles and descriptions
  would show them. The source declares no across-matters reading until the owner says which
  stands; adding it is one declaration.

- **Step 6** needs the search service bound in Cloudflare, and natural-language retrieval needs the
  two live experiments in
  [`../research/2026-08-07-ai-search-filter-wall-experiment.md`](../research/2026-08-07-ai-search-filter-wall-experiment.md)
  run against a real instance.
- **Step 7's coding panel** waits on the two discovery questions recorded on the review-coding
  nodes in [`../../roadmap.d/discovery.md`](../../roadmap.d/discovery.md).
- **File text extracted before a fix to the extractor** keeps the old extraction until the file is
  indexed again. Step 6 needs a re-extraction pass for those, and the scanned-document page limit
  lifted, before a firm-wide file search can be called complete.
