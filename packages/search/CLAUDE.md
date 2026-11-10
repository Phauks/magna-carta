# @magna-carta/search — CLAUDE.md

**Purpose.** The pure domain package behind the platform's three indexes: the discovery **keyword**
index over the words inside files (the corpus scope key, the split-key derivation, the extraction
and fusion types, and `SearchIndexPort`); the firm-facing **natural-language** search over a firm's
own working documents (its consent gate and versioned disclosure, the derived text feed and its
catalog, the managed-instance configuration and lifecycle, the usage meter, and
`NaturalLanguageSearchPort`); and the **record index** over the text a firm holds in its own
database rows (the declared sources, the triggers and statements rendered from them, and how a
reader's text becomes a question). Which index is for what, and who may ask each one, is
[`docs/specs/2026-11-10-indexing-and-discovery-design.md`](../../docs/specs/2026-11-10-indexing-and-discovery-design.md).

No binding, no `env`, no network, no bucket handle. Every function here takes a firm-scoped database
handle from its caller, which is the whole of how firm scoping works in this package — nothing in it
can reach two firms at once. The runtime halves live in `apps/api-worker/src/search/` (the queue
consumers, the sweeps, and the binding resolvers) and in `apps/search-worker` + `containers/search`
(the keyword engine).

**White paper:** _Core domain_ (search and discovery), with _AI / inference_, _Tenancy and data
isolation_, and _Settings & configuration_ as surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0003, ADR-0012,
ADR-0110, ADR-0111.)

## Key files / entry points

**Keyword search**

- `src/corpus.ts` — `CorpusScope`, the partition key both ports share
- `src/port.ts` — `SearchIndexPort`; `src/split.ts` — the derived split id and R2 key
- `src/extraction.ts`, `src/fusion.ts` — the extraction port and reciprocal rank fusion
- `src/settings.ts` — `search.indexing_enabled` and the compaction thresholds
- `src/keyword-query.ts` — `keywordQueryText`: a reader's text rebuilt as the engine's query from
  its words alone. The one place the application writes the engine's query language for a person
- `src/keyword-letter-folds.ts` — what the engine does to each letter beyond lowercasing it.
  Rendered by `scripts/render-keyword-letter-folds.mts` from the table the engine publishes about
  itself; never edited
- `src/extracted-text.ts` — the kept text of one indexed version of a matter's file: its key, its
  object class, its bytes, and `readExtractedPassage`, which reads one passage by range
- `src/keyword-excerpt.ts` — `keywordExcerpt`: the stretch of a passage where a reader's words are,
  found again by the engine's rules for cutting and folding a word
- `src/matched-text.ts` — a reader's words found again in the text a result shows, for both
  indexes: the two sets of word rules, the one finder, the excerpt cut around a match
  (`excerptAtWords`, `recordExcerpt`) and the marks (`markWords`, `markCharacters`) a screen draws

**Natural-language search** (every module prefixed `natural-language-`)

- `natural-language-settings.ts` — `search.naturalLanguageEnabled`, default `false`, and its total read
- `natural-language-disclosure.ts` — the versioned statement a firm's administrator accepts
- `natural-language-enablement.ts` — **the write path**: the only place the gate is flipped or a
  matter excluded, composing effects rather than performing them
- `natural-language-feed.ts` — the feed key, the one object class, and the document body
- `natural-language-instance.ts` — the derived instance name, the one configuration, the metadata schema
- `natural-language-port.ts` / `natural-language-provisioning.ts` — the two ports and their
  not-configured default resolutions
- `natural-language-statements.ts` (per-firm) / `natural-language-instance-statements.ts`
  (control-plane) — the SQL
- `natural-language-audit.ts`, `natural-language-topics.ts`

**The record index** (every module prefixed `record-index-`)

- `record-index-sources.ts` — **the list of searchable places.** One declaration per source: its
  table, its words, its matter, when a row is in or out, and which columns re-index it
- `record-index-schema.ts` — everything the index is in a firm's database, rendered from the
  declarations: the full-text table, each source's triggers, the fill and the rebuild
- `record-index-query.ts` — a reader's text taken apart into tokens and rebuilt as a match, and the
  three forms a consumer composes the index into its own statement in: leading, beside another
  condition, and the newest matches up to a cap, which is the form a read with no matter to narrow
  by uses
- `record-index-statements.ts` — the reads the index offers directly (ranked pointers, counts per
  source, and `readRecordIndexPlaces`: each source's indexed rows beside the records that belong
  in it) and its maintenance statements (rebuild one source, optimize)
- `record-index-rebuild.ts` and `record-index-topics.ts` — a rebuild as the firm's records keep
  it: the effect a request writes (an audit row and the outbox message that carries the work), the
  row a completed rebuild leaves, and the read that says whether one is outstanding. The work
  itself is `apps/api-worker/src/search/record-index-rebuild.ts`
- `contract.ts` — the bodies of the firm's search status read and of the search across matters, as
  plain zod; the route modules in `apps/api-worker/src/http/routes/firm/search-status.ts` and
  `apps/api-worker/src/http/routes/matters/search-across-matters.ts` declare their routes over them
- `scripts/render-record-index-migration.mts` — prints the migration text for one source or all
- `scripts/measure-record-index-shapes.mjs` — the measurement the index's shape was chosen on

**`test/natural-language-filter-wall/`** is not production code and is exported from nothing. It is
the runnable protocol for verifying the managed index's metadata-filter semantics against a real
instance, built and sensitivity-proven ahead of the retrieval adapter. Its filter and feed-key shapes
are the ones the production modules adopted; keep the two in step.

## Local rules — natural-language search

- **The filter is not the boundary. Read-time re-authorization is.** Between firms, isolation is
  structural: one instance per firm, and a query against one firm's instance cannot reach another's
  bytes for the same reason a query against its database cannot. **Within** a firm the matter scope is
  a filter argument constructed on every request, which is weaker than anything else this platform
  relies on — so every pointer a hit carries is re-resolved through the firm-scoped data-access layer
  and re-checked against the caller's entitlement **before a single character of it is returned**. The
  metadata filter is a recall and cost optimization. A hit that fails the check is dropped, and the
  drop is a platform defect of the most serious kind, not a routine condition. Never write code that
  treats a filter argument as the thing keeping one matter out of another's results.
- **No filter value ever comes from a request.** Every value is derived server-side from the
  authenticated session and the route's path. `NaturalLanguageSearchInput` has no filter field and no
  slot for one; a fitness test asserts that, and asserts the object-class include list stays a closed
  literal union rather than becoming `string[]`.
- **The feed is an ALLOW-LIST with exactly one entry.** Nothing reaches the managed index except by the
  feed writer producing an object for it, and it produces objects for one class — committed file
  versions — and nothing else: not the mutable working copy of an open editing session, not
  conversions, not bundles, not captured email originals, not keyword-index splits, and above all not
  a discovery review set, which is material an opposing party produced. Assistant transcripts are rows
  in the per-firm database and are not R2 objects at all, so no misconfiguration reaches them. This is
  why the instance is pointed at a derived feed prefix and **never at a firm's bucket**.
- **The metadata schema is a foundation, not a setting.** Changing it re-indexes every document in
  every firm's instance, so it is declared complete at creation from one constant in
  `natural-language-instance.ts`. A second literal spelling of the field list anywhere else is a
  second place it can drift from what the instances were actually created with — a drift whose symptom
  is a filter that matches nothing while looking like it works. A fitness test refuses one.
- **Both gates are read at the moment of writing, never inherited.** `mayFeedMatter` reads the firm
  setting and the matter's exclusion flag together, and both reads are total in the safe direction: an
  unreadable setting is a shut gate, and a matter that cannot be found is an excluded one.
- **A matter exclusion DELETES, it does not merely stop.** Setting the flag enqueues deletion of that
  matter's existing feed objects. An opt-out that only stopped new writes would leave the material
  that prompted it sitting in the index.
- **Deletion is planned from the catalog, never from a bucket listing.** A listing-driven delete cannot
  tell an object it has never heard of from one it wrote. Driven from the catalog, that object is a
  reconciliation mismatch — a fact somebody can act on — instead of a silent miss.
- **Say only what can be demonstrated.** The platform deletes the extracted text it wrote, from storage
  it owns, and can enumerate the catalog to show it. Deletion of the managed index is a request whose
  completeness it cannot demonstrate, and the disclosure says exactly that. Do not add a sentence
  anywhere that upgrades "requested" to "gone".
- **No generation, ever, and no second model chokepoint.** Nothing here constructs a generation call,
  configures a text-generation model, or enables a public endpoint; fitness tests assert all three.
  The embedding model is read from `@magna-carta/inference`'s pin rather than named here, so this
  package names no provider.
- **No query text in any log, audit row, or error payload.** A member's question about a client matter
  is privileged content. The audit builders take typed inputs of identifiers, numbers, and closed
  labels — there is no field it could be passed in — and the dropped-hit count never reaches the
  caller, because "your query matched fourteen passages you may not see" is itself a disclosure.

## Local rules — keyword search

- **A reader's text is never the engine's query syntax.** A search box reaches the engine only
  through `keywordQueryText`, which takes the text apart with the record index's parser and
  rebuilds the query from letters and digits. The engine's language has operators, field prefixes
  and patterns; passing text through lets a stray quotation mark fail a search and lets a reader
  name a field. A caller that builds its own query (the conflicts check quotes each name as a
  phrase) owns the same duty.
- **The query shapes are pinned on the engine's side.** `crates/search-core/src/lib.rs` carries a
  test of what each shape `keywordQueryText` writes actually matches. Change a shape here and change
  that test with it: the two sides are in different languages and nothing else compares them.
- **The engine folds; the application folds only a pattern, and from the engine's table.** The
  engine composes a letter and its accent, folds Latin letters to their unaccented form and
  lowercases, for a document's words and for a quoted word in a question alike, so a quoted word
  goes to it as typed. It does nothing to a pattern, so the one unfinished word is folded here,
  from `keyword-letter-folds.ts`. That table is rendered from
  `crates/search-core/tests/fixtures/body-letter-folds.tsv`, which a test beside the engine's
  analyzer holds to the analyzer; `test/keyword-query.test.ts` holds the table to the file. Never
  add a letter by hand: re-render.
- **How the engine cuts a word is a schema generation.** A change to its analyzer (a filter, their
  order, a new engine version with a different folding table) changes what every index holds. It
  comes with a `SCHEMA_GENERATION` bump in `crates/search-core/src/schema.rs`, and after a
  production index exists it means rebuilding every one. The catalog records each split's
  generation; nothing yet re-indexes an older one.
- **A passage is a page.** Every word of a question has to be on the same page of a document. That
  is stated to the reader in the user guide.
- **A result's words come from the kept text, never from the index.** The index job writes the
  passages it built the split from to one object per version (`extracted-text.ts`), before the
  catalog commit, and the application reads a passage only for a file its own statement has already
  returned under the matter binding. Do not store passage text in a split to have the engine return
  it: that hands text back for candidates the database has not decided on.
- **The kept text is one extraction's third consumer, never a second extraction.** It is written
  from the same passages as the split, so the page a result names and the sentence it quotes are one
  reading of the document. A review document is not written; its text is the review pipeline's own.
- **The kept text's key and bytes are compatibility contracts**, pinned in
  `test/extracted-text.test.ts`. A change to the layout is a new `format` number that the reader
  refuses as malformed until it is taught, never an edit to format 1.
- **An excerpt finds words the way the engine does.** `keywordExcerpt` cuts and folds with
  `engineWordsOf` and `asIndexed` from `keyword-query.ts`, the same word pattern and fold the query
  is built with. Give it a rule of its own and a result will name a page and quote nothing.

## Local rules — marking a reader's words

- **One finder, a set of rules per index.** `matched-text.ts` finds a question's terms in a text
  under `RECORD_WORD_RULES` or `FILE_WORD_RULES`. A third index brings a third set of rules, never
  a second finder: the excerpt and the marks are cut from the same finding, so they cannot name
  different words.
- **A mark decides nothing.** It is made for a text a consumer's own statement already returned,
  and it may cost a mark but never a result. That is why `asRecordIndexed` is allowed to be close
  to the record index's tokenizer and not held to it by a table, where the file engine's fold is:
  the engine's fold also builds a query, and a wrong letter there loses a match.
- **Marks are offsets into the text returned with them.** Rules whose index composes return the
  composed text, and a caller sends that text and not the one it passed in.
- **No markup leaves this package.** A mark is two numbers. What a marked word looks like is the
  screen's.

## Local rules — the record index

- **Triggers are the only write path. Nothing calls the index when it saves.** That is the property
  that makes it impossible for a write path — an editor, an import, an erasure — to forget it. Do
  not add a function that writes an index row from application code; if a record is not being
  indexed, the fix is its source's declaration and a migration.
- **Adding or changing a source is a migration.** The triggers a firm's database carries are text in
  a migration, rendered from the declarations at the time. Declare the source, run
  `node packages/search/scripts/render-record-index-migration.mts <key>`, and put what it prints in
  a new per-firm migration; to change one, the new migration drops the source's triggers first. A
  source key is stored in every index row, so it is permanent once shipped.
  `test/record-index-lineage.test.ts` applies the whole lineage and compares its triggers word for
  word with what the declarations render, so the two cannot part quietly.
- **A migration that rebuilds an indexed table drops that table's triggers.** SQLite removes a
  table's triggers with the table. Recreate them in the same migration; the lineage test fails
  until they are back.
- **The index proposes; the consumer's own statement decides.** A consumer composes the index into
  a statement over its own table (`recordIndexLeadingFrom`, or `recordIdsMatchingSubquery` beside
  another condition) and still binds the matter and composes the visibility predicate there. Never
  return an index match as a result on the index's say-so.
- **A read of the firm names its reason.** `RecordQueryScope.matter` left undefined reads every
  matter. A conflicts check may; a person's own search may not, and passes a matter or composes the
  visible-matter condition (`matterCondition`) so it is applied before the limit.
- **A read with no matter is capped before it joins.** A matter's token keeps a common word to
  what that matter holds. With no matter, `recordIndexNewestMatchesFrom` takes the newest matches
  up to a cap first, and `countRecordIndexMatchesUpToStatement` tells the caller when there were
  more, so the answer can say it is the most recent matches and not every one. The count is for
  that one decision and is never shown to a reader.
  `packages/matter-search/scripts/measure-across-matters.mts` is the reading the cap was chosen on.
- **A reader's text is never match syntax.** It reaches the index only through
  `recordMatchExpression`, as a binding. Do not build a match string anywhere else.
- **Prose only.** Names and numbers stay on substring matches over their own columns; a source may
  not read a protected column or a review-set table, and a fitness test refuses one that does.
- **A source says who reads it, and a reader that starts or stops says so here.** `readBy` on each
  declaration is what a firm is shown on the Search and Indexing page. `test/record-index-readers.test.ts`
  scans `packages/matter-search/src` and `packages/conflicts/src` for the source keys their
  statements name and fails when the declaration differs. A third reader is a new member of
  `RecordIndexReader` and a new directory in that test.
- **"Behind" is counted from the records, never remembered.** `readRecordIndexPlaces` counts what
  belongs in the index through `recordIndexExpectedCountSelect`, the same row select the triggers
  and the rebuild are rendered from, so the count cannot disagree with them about what a record
  is. It reads every row of every source table: it is for a screen a person opened.
- **A rebuild decides what to rebuild when it runs.** The message that asks for one carries
  nothing. The consumer counts with `readRecordIndexPlaces` and takes the places
  `recordIndexPlaceIsBehind` names, the same definition the screen shows a place as behind by, so
  a late or repeated delivery does the work needed then and no more. Do not add a list of places
  to the message. One place is one batch; never rebuild two places in one transaction.
- **No compound SELECT of more than five terms.** A firm's database refuses one, and plain SQLite
  in a package test does not, so a statement that works here can fail in a firm. There are eight
  sources: a read across all of them is a column per source or a `GROUP BY`, never a `UNION ALL`
  with a term each. `apps/api-worker/test/firm-search-status.test.ts` runs the expected-count read
  in real firm storage.
- **The shape was measured; measure before changing it.** No prefix indexes, the source as a column
  and the matter as a token each came from `scripts/measure-record-index-shapes.mjs`.

## Invariants that apply here

- **All business data through the firm-scoped data-access layer** (golden rule 3): this package holds
  no binding and crosses no firm; the caller supplies the handle.
- **Every outcome is a typed value, never a thrown error** — the discipline `SearchIndexPort`,
  `ConversionPort`, and the integrations `Dispatch` already share. That includes the two
  not-configured resolutions: an absent binding produces `instance-not-provisioned` /
  `binding-not-configured`, never a throw at construction and never a clean empty success, which would
  be indistinguishable from a corpus in which nothing matched.
- **Derived keys and names are compatibility contracts.** The split key, the feed key, and the
  instance name are all derived rather than minted, and their exact bytes are pinned in the tests
  beside them. Changing one orphans everything already written under it.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` (statement and effect shapes), `@magna-carta/identifiers`,
  `@magna-carta/object-dimensions` (the one home for what a bucket object is stamped with), and
  `@magna-carta/inference` (the embedding pin only — never a provider).
- Consumed by `apps/api-worker/src/search/` and, for the keyword half, by `apps/search-worker`.
- Table names are tracked against `@magna-carta/database` by
  `test/natural-language-schema-name-sync.test.ts`; renaming a table there fails here. The record
  index's source tables and columns are held the same way by `test/record-index-lineage.test.ts`.
- The record index is consumed by `@magna-carta/matter-search` (its prose sources), which also
  consumes `keywordQueryText` for its file contents source.

## Gotchas

- **The managed-search bindings are declared and commented out in `apps/api-worker/wrangler.jsonc`.**
  Uncommenting them is a decision rather than a configuration step: the first instance the management
  binding creates fixes an embedding model that cannot be changed afterwards without re-embedding the
  corpus, and the platform's embedding pin still reads open in
  `packages/inference/src/catalog.ts`. Freeze the pin before the first instance exists.
- **The retrieval adapter is deliberately unwritten.** The query port resolves to a
  `instance-not-provisioned` outcome in every deployment. What is missing is not the code but the
  evidence: the managed index's filter semantics have not been observed against a real instance, and a
  filter that fails open — or is accepted and silently ignored — cannot bear even the
  recall-optimization weight this design puts on it. The protocol that closes that question is already
  runnable in `test/natural-language-filter-wall/`.
- **`client` and `confidentiality_scope` are declared on the instance and written by nothing.** They
  are declared because adding a metadata field later re-indexes every firm, and unwritten because the
  platform reserves both names in `@magna-carta/object-dimensions` and a dimension absent on every
  object is worse than no dimension. Lifting one reservation is a change in both places.
- `vp test` runs the whole repo. For this package alone: `npx vitest run --root packages/search`, and
  never two test invocations at once.
