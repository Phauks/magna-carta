# @magna-carta/document-assembly — local notes

Pure TypeScript engine for **document automation**: prepare an uploaded `.docx` into a registrable
template version, and merge a registered template against a matter into a filed document. No D1
binding, no Hono, no `env`, no Svelte, no network — the caller hands in a firm-scoped database handle
and gets typed results back. Consumed by `apps/api-worker/src/http/routes/documents/templates.ts`,
`apps/api-worker/src/http/routes/documents/assemblies.ts`, and `apps/api-worker/src/background/assemblies/assembly-consumer.ts`.
Design: `docs/specs/2026-08-04-document-automation-design.md`.

## Shape

`prepareTemplateVersion(bytes, scrub, options)` (`src/register.ts`) is the registration pipeline and
runs in one defensible order — **macro consent gate → strip macros → re-emit and re-read → normalize →
scrub → verify the bytes that will be stored**. `assemble(templateBytes, mergeContext)`
(`src/assemble.ts`) is the per-assembly path. `resolveMergeContext(database, input)` (`src/resolve.ts`)
sits between them. `src/field-mapping-statements.ts` is the firm's confirmed-mapping store behind the
name resolver. `src/expression/` is the template expression language and `src/blocks.ts` is the
block-marker vocabulary the normalizer validates and the assembly walk expands.

**A template version has a KIND, and there are two.** `TemplateKind` (`src/types.ts`) is
`wordProcessing | pdfForm`, stored on `document_template_version` and read by every consumer instead of
assuming a `.docx`. The second kind has its own registration pass (`prepareFormTemplateVersion` in
`src/pdf-form.ts`) and its own per-assembly path (`fillFormTemplate` in `src/fill-form.ts`), and shares
everything else: the catalogue, the version ladder, the ingest gate, the manifest shape, the binding
index, the dictionary, the formatters, the absence model, and the provenance row. See _Fillable-PDF form
templates_ below.

## Local rules

- **Every zip read goes through `src/ooxml/package.ts`.** Nothing calls fflate's `unzipSync` directly:
  a template is an untrusted upload, and an unguarded inflate anywhere makes the entry-count and
  inflated-size caps decorative. `readPackage` returns a typed failure, never a throw.
- **A merge field never issues a query.** Resolution reads AT MOST ONCE PER SOURCE regardless of field
  count; `test/resolve-batching.test.ts` asserts it, because the natural implementation of a merge
  engine is a per-field resolver and that is an N+1 pointed at a document with a hundred fields. Adding
  a dictionary source means adding one batched read, never a lookup on the substitution path.
- **Every rewrite of a firm's own content is opt-in; detection never is.** Both registration transforms
  report unconditionally and act only on an explicit request flag — `convertMergeFields` and
  `stripMacros`. What differs is the no-opt-in path, and it differs because the two failures differ. An
  unconverted `MERGEFIELD` is RECORDED and the template registers: nothing substitutes it, so it renders
  Word's frozen cached result, and the manifest's `unconvertedMergeFields` entry (name, part, frozen
  text) is what puts that in front of the absence model instead of leaving it invisible — reported at
  registration, in the field list, and by every assembly, which lands on `succeeded_with_absences`. A
  live macro is REFUSED, with both remedies named: no manifest entry makes executable code safe to
  store, and stripping it unasked is still a rewrite of the firm's document.
- **`src/macros.ts` is security-boundary code.** Detection is driven by the content-types map and the
  relationship TYPES, never by file name — a VBA project parked at `word/embeddings/settings.bin` is
  exactly as macro-bearing as one at the conventional name. `macroContentFindings()` answers "is this
  macro-bearing" (the consent gate); `macroResidue()` adds the package-validity check and is a SEPARATE,
  independent scan run over the final bytes — the stripper never vouches for itself, and a stray content
  Override must never be read as a macro and refuse a template for want of a consent it does not need.
  Relationships are matched by RESOLVED TARGET, never by target filename (an external hyperlink can end
  in the same name, and dropping it leaves a dangling `r:id` that makes a reader declare the document
  damaged).
- **A LEGACY WORD FORM FIELD is reported and never bound — there is no opt-in that converts one.**
  `w:fldChar` complex fields whose instruction is `FORMTEXT` / `FORMCHECKBOX` / `FORMDROPDOWN`, carrying
  a `w:ffData` block: what the appellate court forms and most legacy firm precedent are built from. The
  only name one carries is a Word-minted bookmark (`Text1`) beside a sentence of help text, so deriving
  a merge key from it would be the name-guessing failure with worse evidence than the rule below already
  refuses — which is exactly why the third opt-in does not exist. The manifest's `legacyFormFields`
  entry (name, kind, part, the author's prompt, the text it prints) is the whole answer: registration
  warns, the field list shows it, and every assembly reports it and lands on `succeeded_with_absences`.
  Before this existed such a template registered clean, declared no keys, warned only `no-placeholders`
  — "every assembly produces the same document" — and filed carrying `Click here to enter caption`.
  **It is a separate manifest list from `unconvertedMergeFields` on purpose:** blending them would offer
  "register again asking for conversion" as the remedy for a construct conversion does not answer.
- **AN UNFILLED CONTENT CONTROL is reported too, and the reason it is not converted is a step different
  from the form field's.** A `w:sdt` whose `w:sdtPr` carries `w:showingPlcHdr` is a region printing its
  own prompt — "Click here to enter text." — and one carrying `w:dataBinding` reads a custom XML part
  nothing here writes and the metadata scrub removes, so it prints whatever the document this template
  was made from last put there. Both are
  recorded on `unboundContentControls` (alias, tag, kind, part, occurrences, state, printed text), with
  the same reach as the form-field list: registration warns, the field list shows it, a refusal names it,
  and every assembly reports it and lands on `succeeded_with_absences`. **A control that is NEITHER is
  deliberately silent** — Word wraps ordinary content in controls constantly, and a filled one prints
  text an author typed, which is content rather than a hole. **The evidence for a NAME is better here
  than for a form field:** `w:alias` and `w:tag` are typed by whoever authored the document, where
  `Text1` is Word-minted, so the argument against binding is not "there is nothing to map from" — it is
  that a name means something only once a human has CONFIRMED it (which is what the field-mapping
  library is for), and that every rewrite of a firm's document here is opt-in. That makes a future
  alias-through-the-mapping-library conversion buildable on exactly what this records, and an owner
  decision rather than a default. **A third manifest list, not a widening of the second:** a legacy form
  field is a dead construct whose only remedy is replacement, while a content control is what Word
  produces today and the binding this engine intends to grow into, so the two stand for different
  futures as well as different repairs — and their kind vocabularies do not overlap.
- **The engine never guesses what a Word field name means.** `MergeFieldNameResolver` is identity by
  default; the firm's own confirmed mappings come from `src/field-mapping-statements.ts`, read ONCE per
  registration into the resolver (never a lookup per field), and written back in the same commit as the
  registration whose conversion confirmed them. A name nobody has confirmed is reported unmapped — a
  `ClientName` that becomes `client.displayName` because it looked close is a silent binding decision on
  privileged content.
- **Formatting moves a decimal point; it never multiplies.** What a stored integer means is its kind
  plus its scale — `500` is five hundred on a number field and five dollars on a currency field. Money
  is `amount_minor`, rates are `rate_e4`, and `src/format.ts` renders both by moving the point on the
  digits.
- **Dates render in the MATTER'S OFFICE'S time zone**, never the server's or the member's.
  `timeZoneForLocation` in `src/resolve.ts` is the single place `location.time_zone` is read — do not
  scatter a default through the formatters. An office that carries no zone still resolves to the
  platform's normalized zone, so a document that rendered correctly before the column existed renders
  identically now.
- **Absence is a decision, not an accident.** Every dictionary entry declares `blank` / `placeholder` /
  `fail`; the default bias is a visible marker, because a blank where a party name should be, filed
  without anyone noticing, is the worst outcome this subsystem can produce. Where resolution KNOWS why a
  key could not be answered, it says so: `MergeContext.absenceReasons` carries a sentence per key and
  `AssemblyAbsence.reason` hands it to the caller. A reason is for a question the firm's data cannot
  answer as asked, not for an ordinary blank — the marker already says "nothing here", and a reason on
  every absence would bury the ones that need reading.
- **Resolved values never leave memory.** Nothing here persists, logs, or enqueues one. The provenance
  row records absent KEYS; a failure names WHICH key failed, never what it held.
- **The merge emits a word-processing package and nothing else.** `document_assembly.output_format`
  (`src/assembly-statements.ts`) records what a JOB was asked to produce, not what this package
  produced: a `pdf` job carries these bytes across the office-suite conversion edge in
  `apps/api-worker/src/background/assemblies/assembly-consumer.ts` before filing them. No renderer, no page model,
  and no second opinion about layout belongs in here — that is the whole reason the engine can be
  pure TypeScript over OOXML.
- **`buildXml` writes the XML declaration; the parser drops the source one** (`ignoreDeclaration`).
  Turning that off puts two declarations in every rewritten part — not well-formed XML, a document no
  reader will open, and nothing in a text-content assertion catches it.

## The catalogue is generated — `src/catalog/`

**`DICTIONARY` is a cross product, not an array.** `src/catalog/subjects.ts` declares the things a
document can talk about (the matter, the client, the opposing counsel, this office, the firm, the
document itself); `src/catalog/facets.ts` declares the facts a subject of a given KIND carries;
`src/catalog/generate.ts` crosses them and adds the written-out facts of the one-of-a-kind subjects.
`src/catalog/groups.ts` is the picker's heading registry and `src/catalog/entry.ts` is the entry
shape plus the availability derivation. Everything downstream takes `readonly DictionaryEntry[]` and
is indifferent to how the array was built.

- **Adding a party subject is ONE ROW** in `MERGE_SUBJECTS`, and its whole facet set follows — the
  keys, their entries, their resolution, and their search vocabulary. `DIRECTORY_ROLE_SOURCES` is
  derived from that registry rather than living beside it.
- **Adding a facet is ONE ROW** in `MERGE_FACETS`, and every subject of that kind gains it with
  identical absence behaviour, identical formats, and identical description wording. A facet that has
  to behave differently on one subject is a visible line in `FACET_OVERRIDES` naming the key — there
  is exactly one today, `client.displayName`, which fails the assembly where its siblings show a
  marker.
- **A one-of-a-kind subject's facts are written out**, in `NAMED_FACETS`. That is correct: there is
  exactly one matter, one office, one firm, one document, and their facts are their own columns
  rather than a vocabulary shared with siblings.
- **Presentation lives on the entry.** Label, group, subject, prominence, synonyms, and one example
  rendering per legal format. Availability and its note are DERIVED (`availabilityFor`,
  `availabilityNoteFor`) from the source and the subject's optionality, never declared per row.
- **Example renderings are produced by the real format table** (`src/catalog/examples.ts`), from an
  invented value. A hand-written example is a second copy of what the formatter does, free to
  disagree with it; this cannot.
- **The client's name is answered by the matter read, not the party read.** `client` declares
  `facetsAnsweredElsewhere: ["displayName"]`, which keeps `client.displayName` out of the party
  subject's key set — so a template naming only the client's name still pays for no party read.

**A KEY IS PERMANENT, and `test/key-permanence.test.ts` is what makes that a property.**
`test/fixtures/shipped-keys.json` is a COMMITTED RECORD, not a generated artefact: a key that
disappears, changes type, changes source, changes its default rendering, or makes its absence LESS
visible is a failing test naming the key and the property. Adding a key is safe and is deliberate —
it lands as a diff to that file that a reviewer sees. Absence may only move `blank` → `placeholder` →
`fail`, never back.

## Adding a merge field

If it is a fact a whole subject KIND carries, it is a row in `src/catalog/facets.ts`. If it belongs
to one subject only, it is a row in that subject's `NAMED_FACETS` list in `src/catalog/generate.ts`.
Either way, add one line to the matching `valuesFrom*` function in `src/resolve.ts` (or an arm in
`facetValue` in `src/directory-role-bindings.ts` for a party facet) and one row to the golden key
list. `test/dictionary-wellformed.test.ts` checks the entry is internally consistent and
`test/catalog-generation.test.ts` checks the generator produced it for every subject it applies to —
a hole in the cross product is a defect, not a choice.

## Names (`<subject>.displayName`)

- **A name is PARTS, not a string.** A format can only render what the value carries: a surname-first
  rendering is not derivable from a display string. The parts ride the party read that already joins
  the Directory name tables, so they cost nothing.
- **`full` is byte-identical to what the key printed before it carried parts** — for a person, for an
  organisation, and for a record that separates out nothing. That is what let the value type widen
  under registered templates without moving a single document.
- **A RENDERING THE RECORD CANNOT SUPPORT IS A DECLARED ABSENCE WITH A REASON**, never a fallback to
  a different rendering (`renderingAbsenceReason` in `src/format.ts`). A document that printed the
  whole name where a surname was asked for looks finished and is wrong in a way nobody catches by
  reading it — the same failure the ambiguity rule refuses one level up.
- **An organisation is a different absence from an unrecorded part.** "This party is an organisation"
  and "this record has no family name recorded separately" want different repairs, so they are
  different sentences; a value whose read does not record which it is says the second.

## The field-binding index

`document_template_field_binding (template_version_id, merge_key)` records which merge keys a
registered version binds, written by `insertTemplateFieldBindingStatements` in the SAME BATCH as the
version. **The reason an index is acceptable where the argument used to be that it duplicates the
manifest: a template version is immutable.** Neither side ever changes after that batch, so there is
no update path, no reconciliation, and no staleness mode. It turns the custom-field hard-delete
guard's `instr()` scan over every stored manifest into an index seek, and it is the read behind
"where is this field used". The keys come from `manifestKeys` — placeholders, block conditions, and
computed fields alike — because "which templates break if this key goes away" has to mean all of them.

## The matter's other parties (`opposingParty.*`, `opposingCounsel.*`, `guardian.*`, `witness.*`)

- **The role IS the key, with the punctuation taken out.** `matter_party.role` is free text — the firm's
  own role catalogue is what a screen lists from, not a constraint on the column — so `opposing_party`,
  `Opposing Party`, and `opposing-party` are the same role. `normalizedRoleToken` in
  `src/directory-role-bindings.ts` lowercases and drops every non-alphanumeric character, and a party
  matches a source when its stored role and the source's key normalize alike. That makes the mapping
  derivable rather than a second table to keep in step, and it is why no two shipped sources may
  normalize to the same token (asserted in `test/directory-role-resolution.test.ts`).
- **Ambiguity resolves to NOTHING, with a reason that names the count.** Two opposing parties means
  there is no single one to name, so `opposingParty.displayName` is an absence carrying "this matter
  links 2 parties in the opposing party role … walk them all with a repeating block over
  `opposingParty.all`". Picking the first by created-at would produce a document that is wrong in a way
  nobody can see. A reason names COUNTS and ROLES only — never a candidate's name, which is the value
  resolution refused to choose between.
- **The collection is the answer to the many case, and it is the repeat machinery that already exists.**
  `<role>.all` is an ordinary list entry; `{{#each opposingParty.all}}` binds items as
  `opposingParty.all.displayName`, which is the same `<collectionKey>.<field>` binding `matter.parties`
  produces. Nothing new iterates.
- **Every role rides the ONE party read.** `selectMatterPartiesForMergeStatement` is unchanged and there
  is no role filter in SQL: a role is a pass over rows already in memory. Filtering per role would be one
  narrowed read per role, which is more reads, not fewer — the batching rule in a new disguise.
- **A role source is platform-declared, never firm-derived.** A firm's own role names are free text and
  cannot be trusted to lex as a merge key (that is what makes custom fields bind by minted HANDLE
  instead). A role a firm uses that no source covers is still reachable through `matter.parties`, whose
  items carry the role they were linked in.

## The firm's own people (`responsibleAttorney.*` and the other member subjects)

- **Five member subjects ride ONE staffing read** (`selectMatterStaffingForMergeStatement`): the
  responsible attorney off the matter row's own column — the statement's first arm labels that row
  with the subject's token, and `matter.responsible_member_id` stays the fact's one home — and the
  rest off `matter_assignment` rows whose free-text role normalizes to the subject key, exactly as
  party roles match. Resolution in `src/staffing-bindings.ts` is the party grammar verbatim: level-1
  ambiguity is an absence naming the count, `<subject>.all` is the way out.
- **A member's name is parts-carrying**: display from the member row, separated parts from the
  member's mapped Directory person (resolved through a correlated sub-select so a duplicate mapping
  can never fake an ambiguity), `isOrganisation: false` always — a member is a person.
- **`<subject>.barNumber` is protected and slot-gated.** It resolves through the SAME chokepoint
  reader the client's identifiers use, against the mapped person's `bar_number` identifier — and
  ONLY for a slot that resolved. An ambiguous or empty staffing slot is an absence BEFORE any
  decrypt, so an assembly can never write a decrypt audit row for a member the document never names
  (`memberProtectedValues` in `src/protected-bindings.ts`; proven against the real audit table in
  the worker suite).
- **Missing profile facts are ordinary absences with no reason** — a profile the member has not
  filled in yet is what the marker already says. Only a nameless member row gets a sentence, because
  that is a data defect worth naming.

## The court, the case, and the estate (`court.*`, `case.*`, `estate.*`)

- **Two one-of-a-kind reads.** The court-case read joins the record to the court's Directory
  organisation and the judge's Directory person; the estate read joins the decedent's Directory
  person. Both subjects of the court kind share the one court read. A matter without either record
  is the conditional absence the availability derivation already declares — never a defect.
- **The estate's styles are STORED designations printed as recorded** — never composed here, never
  composable in a template. The judge's and decedent's names are parts-carrying, so every name
  rendering applies with no new machinery.
- **`capacityLine` composes in the RESOLVER** (`capacityLineValue` in
  `src/directory-role-bindings.ts`), from the party's name, the `capacity` recorded on the party
  link, and the estate's stored style — ONE absence for the whole phrase naming the missing parts,
  which is the whole reason it exists: the template-side concatenation renders stray punctuation and
  three markers. Naming a capacityLine key is the one party facet that adds a read (the estate's,
  once); everything else on the party kind stays a pass over the party rows.
- **The asset register's as-of date is the estate's date of death** when the matter records one —
  supplied by the caller (`assetsAsOfDate`), read in the assembly consumer, never stored twice.

## Pronouns (`pronoun`, `pronounVerb`, and `<subject>.pronouns`)

- **Recorded, never inferred.** The five forms and the verb-agreement number come off the
  `directory_person` row the party read and the staffing read already join. Nothing here derives a
  pronoun from a name, a prefix, or a party kind, and nothing must start.
- **THE HELPERS ARE THE ONE PLACE ABSENCE IS ANSWERED RATHER THAN REPORTED.** `pronoun()` never goes
  unresolved: an unstated set, an organisation, and a role the matter does not resolve to one person
  all render the neutral they/them (`NEUTRAL_PRONOUNS` in `src/expression/pronoun.ts`). That inverts
  the visible-marker bias on purpose — the sentence is grammatical either way, and a marker mid-clause
  would put "[CLIENT PRONOUNS]" on every ordinary letter and teach a firm to ignore markers. The
  `<subject>.pronouns` KEY keeps the ordinary contract: it states a fact, so it is blank when
  unrecorded and never invents one.
- **A declension is not a merge value.** It travels on `MergeContext.pronouns`, keyed by SUBJECT, not
  in `values`: a merge value is something a document prints and whose gap a marker stands in for, and
  a declension is neither. `src/pronoun-bindings.ts` is the one projection from columns to declension,
  shared by both reads so they cannot disagree about what a half-recorded row means — and it re-checks
  all-or-nothing rather than trusting the table CHECK, because the failure is invisible on the page.
- **`personSubject` is the only place the grammar takes a bare word.** `pronoun(client, "subject")`
  reads `client` straight off the token in `parse.ts`, confined to that declared parameter position;
  the checker resolves it by looking `client.pronouns` up in the scope, so the set of legal subjects is
  derived from the firm's own catalogue rather than listed twice. Still one atom and one `Map.get` —
  the structural property the language rests on is untouched. Do not widen the position.
- **NO VERB IS EVER INFLECTED.** `pronounVerb(person, singularForm, pluralForm)` picks between two
  forms the author wrote, by the agreement the set declares — singular they takes plural verbs, and no
  rule short of a dictionary turns "signs" into "sign" and leaves "shall" alone. A verb table here
  would be the name-guessing failure one part of speech over.
- **Pronouns are a PERSON fact.** Party and member subjects carry them; the court, case, and estate
  subjects deliberately do not yet, and a list item inside `{{#each}}` does not — the helper works on
  the singular subjects only.

## The firm's own fields (`custom.<handle>`)

- **Bound by HANDLE, never by name.** `src/custom-field-bindings.ts` derives one dictionary entry per
  active `custom_field` row at read time — the key is `custom.` plus the field's `customField_` handle,
  so a rename changes the label and nothing a registered template stores. A name-bound merge field would
  put every firm one rename away from a template that silently stops filling in a number.
- **The catalogue is per firm and derived, not declared.** `dictionaryForFirm(customEntries)` widens the
  shipped list; `readCustomFieldCatalog` (`src/resolve.ts`) is the one read behind it, shared by
  registration, the field-list surface, and assembly. Every caller must pass the firm's catalogue —
  `lookupDictionaryEntry(key)` with no entries answers "does the PLATFORM have this key", which is a
  different question from "does this firm".
- **Archived means ABSENT, in both directions.** An archived field contributes no dictionary entry (so a
  template bound to it fails at assembly naming the key — the drift detection the stored-source rule
  exists for) and its stored value is skipped at resolution (so a template resolved before the archive
  reports it as an absence rather than printing what the firm withdrew).
- **The scale rule is reused, not restated.** `effectiveNumberScale` from `@magna-carta/custom-fields`
  decides what a `value_number` integer means; the same `500` is five hundred on a number field and five
  dollars on a currency field. A currency field whose declared scale is not the currency's minor unit
  renders as the exact decimal it is rather than as money that would look right and be wrong.
- **One read per template, not per field.** `src/custom-field-statements.ts` joins the picklist option's
  label and the referenced record's display name into the SAME statement, because fetching either per
  value is precisely the N+1 the batching rule forbids. Handles ride as bound parameters; the statement's
  shape depends only on how many there are.
- **Deleting a bound field is refused elsewhere.** The hard-delete guard's template-binding arm lives in
  `packages/custom-fields/src/custom-field-service.ts` and names `document_template_version` by string —
  that package imports nothing from this one, and must not start.

## Pictures

- **A picture is FOUR things, and `src/ooxml/image.ts` owns all four**: the part, its declared content
  type, the relationship on the part that draws it, and the drawing. Emit three of them and a reader
  calls the document damaged — and every assertion about the document's TEXT still passes, which is why
  `packageIntegrityViolations` reads the package structure and `test/letterhead-image.test.ts` asserts
  over the emitted parts rather than over words.
- **PNG and JPEG, decided by the first bytes.** Not by a declared content type, not by a file name. SVG
  is a document (markup and script surface inside a package we assert carries neither), EMF and WMF are
  replayed record streams, and the rest widen the content-type set for worse reader compatibility than a
  printed mark needs. The policy is enforced at the write (`@magna-carta/locations`) AND re-checked here,
  because it is worth what the last place enforcing it is worth.
- **Relationship ids are LOCAL TO A PART.** `rId4` in the main document and `rId4` in a header are
  different relationships, so the next free id is computed per relationship part, by scanning the ids
  present rather than counting them — a package with a deleted relationship has gaps.
- **Every namespace is declared on the element that uses it.** A template's `w:hdr` may declare `w:` and
  nothing else; a prefix used but not bound is not well-formed XML.
- **The ASSET declares the box, not the template.** Only a width is stored, on the location; the height
  is derived from the intrinsic aspect ratio at resolution time, so no document can print a stretched
  logo and replacing a wide mark with a tall one re-lays every letterhead out correctly.
- **An image is not a value anywhere else.** It has no format (`legalFormatsFor("image")` is empty, so a
  `:format` suffix is a registration failure) and no expression type (`expressionTypeOf` returns
  undefined, so its key is simply not in the expression scope and `{{#if location.letterheadLogo}}` is
  refused as an unknown merge field).

## The expression language

`src/expression/` is a **closed, total language, not a sandbox**, and every local rule below follows
from that one sentence.

- **The folder imports nothing but itself and `@magna-carta/money`.** No OOXML, no zip, no XML —
  asserted by `test/expression-purity.test.ts`, because the checker has to stay runnable in a browser
  for the authoring surface built in slice 2·6·4. That test is also the source scan that refuses `eval`,
  `new Function`, dynamic `import`, `with`, `Reflect`, a runtime-built regular expression, a clock,
  randomness, a locale, and floating-point arithmetic.
- **Nothing in the folder throws.** Every stage returns a tagged result (`errors.ts`). A throw from a
  lexer handed a megabyte of unicode is indistinguishable at the call site from a defect in the caller,
  and the whole claim the language makes is that hostile input produces a NAMED refusal.
- **A merge key is ONE lexical atom.** The dot is part of the identifier, never an operator; there is no
  member-access, indexing, assignment, lambda, or regular-expression production anywhere in `parse.ts`.
  That is why `__proto__.constructor` is uninteresting here rather than dangerous — one atom, one
  `Map.get`, absent, reported as an unknown merge field. Do not add a traversal production; the security
  property is structural and a single production removes it.
- **Names resolve through a Map, layered by copying.** `layerScope` copies rather than chaining
  prototypes: an inherited scope built with `Object.create` would put a template-supplied name one
  lookup from a prototype property.
- **A call node carries a catalog signature resolved at PARSE time** (`catalog.ts`), so by evaluation
  the only callable things in existence are functions in this repository. Adding a helper is a row in
  that frozen table plus an arm in `evaluate.ts`'s switch — never a dynamic dispatch on a name.
- **An aggregate's argument is a NAME, never an expression.** `sum`, `minimum`, and `maximum` take a
  literal `<collection>.<field>` path — one lexical atom, split in `lex.ts` and resolved by exact match
  against a list binding's `itemFields` — so the set of values folded is fixed before evaluation starts
  and there is still no iteration an author can write. They are the only helpers whose cost grows with
  the firm's data, and they run under the SAME bound a repeating block does: one batched read for the
  collection, the items-per-repeat cap, a step charged per element. Money folds through the same
  `addOrSubtract` the `+` operator uses, so there is no second implementation of adding money.
- **An aggregate over an EMPTY collection is unresolved, not zero** — uniformly, for all three. A
  smallest of nothing has no answer in any type, and a total of no amounts would have to name a
  currency, which is a fact the firm's data carries and not one a template may invent (the same reason
  there is no money literal). An item carrying nothing for the field is likewise unresolved rather than
  skipped: skipping understates a total silently, which is the one failure this package exists to
  prevent. `isEmpty` and `default` are the total forms an author writes instead.
- **Every bound is in `limits.ts`, and each has a test that hits it exactly** and asserts the named
  refusal rather than a timeout. The declared tree-depth bound counts NODES; the parser's own recursion
  is guarded separately, because most precedence levels produce no node and conflating the two would
  make pretty-printing an expression change whether it is legal.
- **No floating point, and every intermediate is checked BEFORE the operation.** Money is minor units at
  scale 2, a rate is `rate_e4`, a number is an exact `(significand, scale)` pair. The money package's own
  `assertSafeInteger` throw is unreachable from here by construction. Rounding and splitting go through
  `roundLedger` and `allocate` rather than a second implementation; `test/expression-arithmetic-oracle.test.ts`
  checks both against an independent BigInt reference.
- **The fuzz harness and the denied-construct corpus are obligations, not extras.** Anything that ever
  produced a crash, a hang, or a wrong answer is committed to the corpus and runs forever after. The
  round-trip property (pretty-print, reparse, compare trees) is the parser-ambiguity detector and has
  already caught one real precedence bug.

## Blocks

- **Whole paragraphs and whole rows, never halves.** `src/blocks.ts` decides the unit: a `w:p` whose
  text is exactly one marker, or a `w:tr` whose FIRST CELL carries one. A partial removal is how a
  document becomes "damaged" in Word, and nothing in a text assertion catches it.
- **Markers match among SIBLINGS.** A block that opens in a table cell and closes after the table has
  no meaningful removal, so it is a `block-unbalanced` registration failure with a location.
- **Numbering and banding survive because whole units move.** Numbering is a paragraph property
  (`w:numPr`) and banding is a table property (`w:tblLook`) applied by position, so a deep clone per
  iteration — every clone carrying its own `w:pPr` and `w:trPr` — is what keeps both correct.
- **An unresolved CONDITION fails the assembly; an unresolved COMPUTED FIELD renders a placeholder.**
  The asymmetry is deliberate and load-bearing: a missing clause is invisible, a hole on the page is not.
  `has(key)` is the total form, so the safe reading is one word away.

## The client's protected details (`client.socialSecurityNumber`, and its five siblings)

- **`sensitivity: protected` is the ROUTING decision, not a label.** A protected entry resolves through
  `src/protected-bindings.ts` and nothing else, and that module holds no ciphertext column name, derives
  no key, and decrypts nothing. The plaintext arrives from `ResolutionInput.readProtectedIdentifier`, a
  seam the caller wires to the protected-field chokepoint (`apps/api-worker/src/background/assemblies/assembly-consumer.ts`
  → `@magna-carta/directory`'s `readIdentifier` → `readProtected`): permission gate, decrypt-audit row
  committed BEFORE any plaintext, AAD-bound decrypt — inseparable and in that order. Adding a merge
  field that reads an encrypted column any other way is the one change this subsystem must never take.
- **The refusal is caught by IDENTITY, never re-derived.** `ProtectedReadForbiddenError` from
  `@magna-carta/data-access/protected-fields` is what becomes an absence. Testing the permission set here
  instead would be a second copy of the rule deciding who may read a client's sealed details, free to
  drift from the one that guards the column. Anything that is not that error propagates — a decrypt that
  broke is not an absence, and filing a document short of a value nobody was denied is the worse failure.
- **A refusal is an ABSENCE, not an error and not a blank.** The assembly completes, the marker shows,
  and the reason names the field and the permission — the whole actionable content. Aborting would make
  one unreadable detail cost the document; a blank would file a document that reads as finished.
- **The decrypt count is bounded by the MANIFEST, not batched.** Each ciphertext is bound to its own row
  by its AAD and commits its own audit record, so there is no batch form of the chokepoint and inventing
  one would mean bypassing it. One decrypt per protected key the manifest names, deduplicated before any
  value is touched; a refusal costs exactly one attempt, because the permission guarding one sealed
  identifier guards them all.
- **The subject rides the party read.** Whose value it is comes from the matter's `client` party link —
  one column on a read that already happens. A matter linking no single client decrypts NOTHING and
  reports a reason naming the count, the same answer the ambiguous role sources give.
- **The audit shape is the chokepoint's, unchanged.** Same event, same subject, same table, no
  assembly-specific reason code. If assembly context ever needs recording, extend that one composition —
  never write a second event, or "who saw this value" becomes two answers.
- **A protected CUSTOM field is a different feature.** `custom_field` carries no protected declaration
  and `custom_field_value` no ciphertext column; the `sensitivity` line in `src/custom-field-bindings.ts`
  is where the declaration is read once they exist.

## Fillable-PDF form templates (`kind: "pdfForm"`)

- **The manifest is DISCOVERED, not authored, and that is the whole difference.** A Word template's
  binding is the key a person typed; a form's binding is a confirmed mapping from the form's OWN field
  name onto a key. `src/pdf-form.ts` reads the AcroForm field set through an injected reader, classifies
  each field, and produces a `FieldManifest` in the shape a Word registration produces — so the
  field-binding index, the custom-field hard-delete guard, and the field-list surface read it without
  knowing which kind they are looking at. A bound key's `formFields` sites carry the box names, kinds,
  pages, required flags, and option sets; `parts` carries the pages, which is the same "where in the
  document" answer an OPC part name gives.
- **NO NAME GUESSING, and the exact match is refused too.** A field binds only through a mapping this
  registration confirmed or the firm confirmed earlier — `document_template_field_mapping`, the same
  library the Word `MERGEFIELD` conversion writes to. A field name that IS a merge key character for
  character is reported as `proposedMergeKey` and stays unbound: a proposal is what a person confirms,
  and the platform has no standing to make the firm's statement about the firm's own document. Nothing
  resembling anything is ever proposed.
- **Every box is accounted for; none is dropped and none is defaulted to a type.** A field is either a
  site on a manifest field or an entry on `manifest.unboundFormFields` with one of three reasons:
  `no-confirmed-mapping` (confirm one), `not-fillable` (a push button or a signature field — no repair
  wanted), `unclassified` (the form does not state the field's type, and writing text into a widget
  nobody classified prints as a completed answer). The fourth manifest list, on the same terms the third
  and second are separate: the repairs differ. **A form that binds nothing warns `no-placeholders`** —
  the failure that bit this platform twice, in `FORMTEXT` and in a placeholder-showing content control.
- **The scrub clears the entries the upload arrived carrying**, along with metadata, attachments, and
  the XFA dataset, and the manifest is built from the SCRUBBED bytes — the ones an assembly will fill.
  A firm uploads the form it last filed; a template that carried the previous client's answers into
  every document assembled from it is the worst thing this subsystem could produce.
- **The absence model is unchanged, and where a form cannot hold a marker the absence is carried in
  words.** `fail` fails the assembly naming the key, `blank` empties the box, and a text box otherwise
  prints the same `[CLIENT ADDRESS]` marker a Word template would. A tick box and a set-answer box have
  nowhere to print one, so they are left unanswered with a reason that says which box and why —
  ticking one to mean "we do not know" would answer the form's question wrongly. A non-boolean value
  bound to a tick box, and a value outside a drop-down's option set, are reported absences rather than
  guesses: the engine would set a state with no appearance behind it, which looks unanswered and is not.
- **`FormFillFinish` is an owner decision held open as a required parameter.** Whether a filed form is
  `interactive` or `flattened` is not this package's call; `fillFormTemplate` takes it explicitly so no
  default can be acquired by omission. The platform's one answer lives in
  `apps/api-worker/src/assemblies/pdf-form-engine.ts`.
- **The engine is injected, three ways** — `AcroFormReader`, `FormTemplateScrub`, `FormFiller` — on
  exactly the terms the OOXML metadata scrub is. `src/` holds no WebAssembly and no PDF syntax
  (`test/purity.test.ts` is the scan); `@magna-carta/pdf` is a DEVELOPMENT dependency so the package's
  own tests can drive the real engine against the committed fixture.
- **The fixture is built, not copied.** `test/fixtures/build-fillable-form.mjs` emits
  `test/fixtures/intake-form.pdf` — an invented two-page intake form with one box of every kind the
  engine distinguishes plus one of no stated type. A real client document cannot be committed and a
  court's published form carries somebody else's asserted rights. `apps/api-worker` reads the same bytes
  through the `documentAssemblyFormFixtures` plugin rather than committing a second copy.

## Named seams (not built here)

- **A firm currency setting.** `ResolutionInput.currencyCode` is supplied by the caller precisely so
  this stays one line at the composition root when a firm may hold amounts in more than one currency.
- **BINDING a content control (`w:sdt`)** — structurally the best placeholder binding and immune to run
  splitting, deferred until a browser authoring surface can emit them. Detection is built (see the local
  rule above); what is deferred is emitting one, and any opt-in that maps an author's `w:alias` onto a
  merge key through the field-mapping library.
- **An aggregable collection.** Every list-valued item field (`matter.parties`, the role collections) is
  text and a firm's own fields are all scalars, so nothing a firm can bind today is foldable: the
  aggregates are exercised against synthetic collections, as the money helpers are against synthetic
  amounts.

## Gotchas

- Pure-package `tsconfig.json` MUST carry its own `compilerOptions` (`allowImportingTsExtensions`,
  `noEmit`, `lib`, `types`); `{extends, include}` alone breaks `.ts` imports under `tsc`. Vitest does
  not typecheck — only `pnpm check` runs `tsc`.
- A `w:t` this package writes always carries `xml:space="preserve"`: Word strips leading and trailing
  whitespace from a text element that does not declare it, and a merge value legitimately begins or
  ends with a space.
- **`w:documentProtection` survives registration, and nothing reports it.** The metadata scrub rewrites
  `word/settings.xml` only to drop `w:mailMerge`, `w:attachedTemplate`, `w:docVars`, and the revision
  identifiers (`packages/metadata/src/ooxml/parts.ts`), so a `w:documentProtection` element declaring
  `w:edit="forms"` with enforcement on is stored verbatim, and every document assembled from that
  template opens edit-restricted. It travels with legacy form fields — Word writes it when a form is protected — so
  the two arrive together. Not fixed here: clearing a firm's own protection setting is a rewrite of
  their document and wants the same opt-in reasoning the macro strip got.
- **`crates/pdf-core`'s scrub does not remove document-level JavaScript or additional actions.**
  `sanitizeDocument` takes out metadata, attachments, the XFA dataset, field values, the structure tree,
  bookmarks, and optional content — it does not touch `/Names /JavaScript`, `/OpenAction`, or a field's
  `/AA`. So a fillable PDF is NOT made inert the way the OOXML macro strip makes a `.docx` inert, and
  there is no consent gate here matching the macro one. What stands between a hostile form and a firm
  today is the same scan every uploaded byte crosses, run over the stored bytes at registration. Closing
  it properly is a change to that crate's scrubber (which other consumers share), and the decision it
  waits on — strip always, strip with an exception a firm marks at upload, or report without removing
  — is recorded on the `documents.pdf.scrub` node of the feature ledger, which is where the register
  and the decision desk read it from. What is named here is the consequence for assembly; what the
  owner is being asked lives there, once — rather than half-answered here.
- Output is byte-reproducible on purpose — `writePackage` pins the entry timestamp, so the same
  template version plus the same merge context yields the same bytes. Do not reach for `Date.now()`
  there.
