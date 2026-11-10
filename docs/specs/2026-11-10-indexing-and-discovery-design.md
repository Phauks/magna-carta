# Indexing and discovery — design

**Date:** 2026-11-10
**Status:** Approved by the owner on 2026-11-10 ("I approve, begin work to fulfill this"). Steps 1
and 2 of the build order below are built by the change that adds this file. The owner moved file
contents in a matter's search ahead of steps 3 and 4 the same day; its reading half is built (step
6a below). The rest are not.
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

Two limits are recorded. A result names the file and the pages and **quotes nothing**, because the
index stores which words are on which page and not the sentences, and a matter file's extracted text
is not kept after it is indexed. Keeping it is step 6c. And the engine lowercases a word and **leaves
its accents**, so a file search is accent-sensitive where the record index is not; changing the
engine's tokenizer means rebuilding every index, which costs nothing before the first production
index exists and a great deal after.

## 5. Build order

| Step | What                                                                                        | State                                                                               |
| ---- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | This specification and its decision record                                                  | Built                                                                               |
| 2    | The record index, the list of searchable places, and matter search reading it for prose     | Built                                                                               |
| 3    | The Search and Indexing status screen: what is searchable, how much is indexed, rebuild     | Not built                                                                           |
| 4    | Search across matters from the top bar, snippets shown                                      | Not built                                                                           |
| 5    | The conflicts check reads the record index instead of scanning                              | Not built                                                                           |
| 6a   | A matter's search reads the file contents index: files whose text matches, and their pages  | Built; answers once 6b is done                                                      |
| 6b   | File contents turned on: the firm's switch, and the search worker deployed and bound        | Switch built; needs the owner's steps in [`../deploy-queue.md`](../deploy-queue.md) |
| 6c   | The kept text that lets a file result quote its sentence, and the per-split word summary    | Not built                                                                           |
| 7    | Discovery review screens: coding, and refusing removal of the last person on an access list | Coding panel waits on two owner questions                                           |

## 6. Open with the owner

- **Step 6** needs the search service bound in Cloudflare, and natural-language retrieval needs the
  two live experiments in
  [`../research/2026-08-07-ai-search-filter-wall-experiment.md`](../research/2026-08-07-ai-search-filter-wall-experiment.md)
  run against a real instance.
- **Step 7's coding panel** waits on the two discovery questions recorded on the review-coding
  nodes in [`../../roadmap.d/discovery.md`](../../roadmap.d/discovery.md).
- **File text extracted before a fix to the extractor** keeps the old extraction until the file is
  indexed again. Step 6 needs a re-extraction pass for those, and the scanned-document page limit
  lifted, before a firm-wide file search can be called complete.
