# @magna-carta/document-assembly — local notes

Pure TypeScript engine for **document automation**: prepare an uploaded `.docx` into a registrable
template version, and merge a registered template against a matter into a filed document. No D1
binding, no Hono, no `env`, no Svelte, no network — the caller hands in a firm-scoped database handle
and gets typed results back. Consumed by `apps/worker/src/routes/templates.ts`,
`apps/worker/src/routes/assemblies.ts`, and `apps/worker/src/assemblies/assembly-consumer.ts`.
Design: `docs/specs/2026-08-04-document-automation-design.md`.

## Shape

`prepareTemplateVersion(bytes, scrub, options)` (`src/register.ts`) is the registration pipeline and
runs in one defensible order — **macro consent gate → strip macros → re-emit and re-read → normalize →
scrub → verify the bytes that will be stored**. `assemble(templateBytes, mergeContext)`
(`src/assemble.ts`) is the per-assembly path. `resolveMergeContext(database, input)` (`src/resolve.ts`)
sits between them. `src/field-mapping-statements.ts` is the firm's confirmed-mapping store behind the
name resolver. `src/expression/` is the template expression language and `src/blocks.ts` is the
block-marker vocabulary the normalizer validates and the assembly walk expands.

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
- **Dates render in the MATTER'S OFFICE'S time zone**, never the server's or the member's. Locations
  carries no time-zone column yet, so `timeZoneForLocation` in `src/resolve.ts` is the single place
  that column plugs in — do not scatter a default through the formatters.
- **Absence is a decision, not an accident.** Every dictionary entry declares `blank` / `placeholder` /
  `fail`; the default bias is a visible marker, because a blank where a party name should be, filed
  without anyone noticing, is the worst outcome this subsystem can produce.
- **Resolved values never leave memory.** Nothing here persists, logs, or enqueues one. The provenance
  row records absent KEYS; a failure names WHICH key failed, never what it held.
- **`buildXml` writes the XML declaration; the parser drops the source one** (`ignoreDeclaration`).
  Turning that off puts two declarations in every rewritten part — not well-formed XML, a document no
  reader will open, and nothing in a text-content assertion catches it.

## Adding a merge field

One row in `src/dictionary.ts` (key, source, value type, default format, sensitivity, absence
behaviour, description) plus, if its source already reads, one line in the matching
`valuesFrom*` function in `src/resolve.ts`. The well-formedness fitness test
(`test/dictionary-wellformed.test.ts`) checks the row is internally consistent.

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

## Named seams (not built here)

- **The widened dictionary** — Directory role sources, `custom.<handle>` bindings, the letterhead logo,
  and protected-value binding through the decrypt-permission-plus-audit path. Until they land,
  `matter.parties` is the only list-valued source and there is no money-typed or rate-typed merge field,
  so the money helpers and the aggregates are exercised against synthetic merge contexts rather than
  against a real one — `matter.parties`'s item fields are all text, so nothing shipped can be totalled
  yet.
- **Content controls (`w:sdt`)** — structurally the best placeholder binding and immune to run
  splitting, deferred until a browser authoring surface can emit them.

## Gotchas

- Pure-package `tsconfig.json` MUST carry its own `compilerOptions` (`allowImportingTsExtensions`,
  `noEmit`, `lib`, `types`); `{extends, include}` alone breaks `.ts` imports under `tsc`. Vitest does
  not typecheck — only `pnpm check` runs `tsc`.
- A `w:t` this package writes always carries `xml:space="preserve"`: Word strips leading and trailing
  whitespace from a text element that does not declare it, and a merge value legitimately begins or
  ends with a space.
- Output is byte-reproducible on purpose — `writePackage` pins the entry timestamp, so the same
  template version plus the same merge context yields the same bytes. Do not reach for `Date.now()`
  there.
