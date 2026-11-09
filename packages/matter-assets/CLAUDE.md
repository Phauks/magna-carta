# @magna-carta/matter-assets — CLAUDE.md

**Purpose.** The matter asset register: what a client or an estate owns, recorded against one matter.
The asset row and its closed platform class, the per-firm type catalog under that class, the
structured attributes for the classes that have them, the append-only valuation history and its
as-of reads, interests held by Directory entities, links to already-ingested matter files, and the
credential-adjacent identifiers sealed to their last four characters. Validates in memory and
composes statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no binding, reads
no clock, and never calls an external service.

**White paper:** _Core domain — Matters and File Manager_, with _Directory_ (whose interests these
are), _Custodian_ (the physical originals, and the boundary below), _Document Automation_ (the
schedule as a document), and _Tenancy and data isolation_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0003, ADR-0084,
ADR-0008, ADR-0081.)
**Spec:** [`docs/specs/2026-08-05-matter-assets-design.md`](../../docs/specs/2026-08-05-matter-assets-design.md).

## Key files / entry points

- `src/types.ts` — the closed vocabularies (classes, estate treatments, dispositions, valuation
  bases, document kinds, identifier kinds), the refused credential names, and the two bounds
- `src/classes.ts` — the class registry: label, attribute table, standing handling note, and whether
  the class's attributes have shipped
- `src/validation.ts` — every refusal as a code the route maps to a problem type
- `src/settings.ts` — the firm's interest-label catalog, read by hand
- `src/asset-statements.ts` / `src/asset-service.ts` — recording, editing, soft-deleting an asset,
  the class attribute rows, the inline valuation, and bulk quick entry
- `src/asset-type-statements.ts` / `src/asset-type-service.ts` — the per-firm catalog under a class
- `src/valuation-statements.ts` / `src/valuation-service.ts` — **the one write, and it appends**
- `src/as-of.ts` — the resolution read, and the only place a value is turned into an answer
- `src/interest-statements.ts` / `src/interest-service.ts` — interests, added and end-dated
- `src/document-link-statements.ts` / `src/document-link-service.ts` — the link over ordinary matter
  files; no bytes, ever
- `src/identifier-statements.ts` / `src/identifier-service.ts` — the sealed identifier, its one
  audited read path, and the credential refusal
- `src/encumbrance-statements.ts` / `src/encumbrance-service.ts` — what is secured against an asset.
  **There is no balance column and no balance argument**: a balance is an ordinary valuation row
  naming the encumbrance
- `src/equity.ts` — value minus what is in force against it, per currency, computed and never stored
- `src/schedule.ts` — the grouped estate schedule as of a date; five batched reads for a whole matter
- `src/custody-link-statements.ts` — the only file here that touches Custodian's tables, and the one
  place the who-owns-which-fact table is written down
- `src/queries.ts` — the matter's register list and the cross-matter interests-by-entity read

## Invariants that apply here

- **A valuation is appended, never updated and never deleted.** `matter_asset_valuation` carries
  BEFORE UPDATE / BEFORE DELETE / replace-guard triggers that `RAISE(ABORT)`, so an `UPDATE` or
  `DELETE` naming the table fails at runtime; `test/purity.test.ts` scans the source so it fails at
  review instead. A mistake is corrected by appending a row that names the row it corrects, which
  supersedes it in every read while both stay on the record. An estate needs the date-of-death value
  and today's value, and a figure editable after a schedule was filed means the register and the
  filed document can silently disagree with nobody able to say when they diverged.
- **There is no current-value column, on any table, at any point.** Every amount a read returns
  travels with the `as_of_date` and `basis` it came from — `ResolvedMatterAssetValue` is one object
  rather than three optional fields precisely so a caller cannot render one without the others.
  `test/append-only.test.ts` walks `PRAGMA table_info` on every asset table to hold it.
- **A date before an asset's first valuation resolves to NOTHING, never to the earliest figure.** An
  asset acquired after the date of death is not in the estate at the date of death, and extrapolating
  backwards would put a number on a schedule that no one asserted. An unvalued asset reports as
  unvalued, visibly, which is a true statement and an actionable one.
- **No credential is storable, in any column, plaintext or sealed.** No password, passphrase, seed or
  recovery phrase, private key, personal identification number, or safe combination. A sealed column
  is decryptable by any member holding the decrypt permission, and for a self-custodied digital asset
  the seed phrase IS the asset: storing it converts a records system into a bearer instrument. The
  write path refuses a request that names one BY NAME, with its own code, before anything is sealed,
  and the refusal message names the correct home — a sealed envelope in the custody register.
- **A full identifier has exactly one read path and it audits.** `matter_asset_identifier.value_
  ciphertext` is a registered protected column; the only reader is `readMatterAssetIdentifierValue`
  delegating to the data-access chokepoint, which gates the permission (absent → a named refusal, no
  decrypt, no audit), commits the audit row BEFORE any plaintext, and decrypts under the row-bound
  AAD. Every other read projects `display_suffix`, and the ordinary row shape carries no field a full
  value could ride on. Do not add a second reader; do not add a blind index (an exact-match channel
  over an account number is an unaudited confirmation oracle).
- **Nothing derives a legal conclusion.** No code infers probate inclusion from an interest label,
  computes a transfer eligibility, classifies a regulated item, or produces a deadline.
  `estate_treatment` is asserted by a person; the firearm handling note is rendered and branched on
  by nothing, and `test/classes.test.ts` asserts it names no jurisdiction, cites no statute, and
  carries no numeral.
- **An asset's class is frozen at creation.** A class change orphans the attribute row and moves the
  asset to a different merge subject, so it is a delete-and-record-again wearing an update. The patch
  schema deliberately ACCEPTS the field and the write path refuses it: a class silently stripped from
  a request is a change a person believes they made.
- **An asset's type must belong to the asset's class,** and attributes belonging to another class are
  refused rather than dropped. A foreign key cannot see the class column on the other side of it, so
  the write path checks it.
- **No money as a float.** Every amount is `amount_minor` plus a currency, the schema refuses one
  without the other, and no total is computed across two currencies.
- **An encumbrance's balance is a valuation row naming it, never a column.** `matter_asset_valuation.
  encumbrance_id`, set, means the row is that charge's balance as of a date — one append-only table,
  one trigger set, one as-of shape, and net equity as one read with a sign flip. A
  `balance_amount_minor` column would be a second, mutable, undated number answering the same
  question worse. The write path refuses a balance naming a charge on a DIFFERENT asset, because that
  makes the equity of two assets wrong and neither of them looks wrong on its own.
- **Equity is computed, never stored, and withheld rather than approximated.** No equity column
  exists, for the same reason no current-value column does. Three things make it unavailable rather
  than wrong: no value at or before the date, a charge in force whose balance nobody recorded (nil
  would overstate exactly the assets a firm must be careful about), and a balance in a different
  currency from the value (the exchange rate on a past date is not a fact the firm's data carries).
  Negative equity is a real answer and is reported as negative.
- **A schedule's as-of date is required and never defaulted.** `readMatterAssetSchedule` takes one and
  validates it; a schedule with an implied date is the failure this subsystem most wants to avoid,
  and the whole point is that the date of death and today give different answers over the same rows.
  The unvalued count is stated rather than hidden and `undetermined` is its own group.
- **Nothing identifying is a telemetry dimension or an audit-metadata field.** No description, no
  address, no parcel number, no entity name, no amount, no suffix. Identifiers, the class, and the
  basis, and nothing else.

## The firm's own fields live in the custom-fields engine, not here

An asset's third type layer — the firm's own fields — is `custom_field.target = 'matterAsset'`,
scoped per class through the engine's existing `attachment_id` column. **Nothing in this package
touches it**: no table, no statement, no service, and no import. The engine owns the definition, the
caps, the value history, the archive-as-absence rule, and the handle-not-name binding, and the
composition happens one level up in `apps/api-worker/src/http/routes/matters/matter-assets.ts`, which reads
`readCustomFieldValuesForScope` with the asset's class as the attachment. That keeps this package's
"depends on no other domain package" rule intact and keeps a firm's own field on an asset the same
object it is on a matter, rather than a second key/value system inside a second register.

**An asset field is deliberately not a merge field.** The catalogue admits the matter axis only,
because a `custom.<handle>` key is a scalar and an asset field's answers live on one of a matter's
many asset rows. Exposing them would mean per-item fields inside the asset collections, which is a
different feature from widening the target and is not built.

## The boundary with Custodian, stated so neither side drifts

Custodian describes **objects in the firm's possession** — where the paper deed is, who last touched
it, whether it may be released. The asset register describes **property in the client's ownership** —
what land that deed describes, what it was worth as of a date, who holds an interest, how the estate
treats it. They overlap on a minority of rows, are joined by one nullable `custody_item_id`, and
neither copies a fact from the other: the asset row carries no location, status, or movement history,
and Custodian carries no valuation. `custody_item.declared_value_amount_minor` and this history
answer different questions (a replacement value for the firm's own exposure, against a fair-market
value to the estate as of a date), so nothing syncs them and nothing derives one from the other.

`src/custody-link-statements.ts` is the ONLY file here that names a custody table, and it holds two
reads and no writes: does this item exist (the write path's whole check), and what does Custodian say
about it right now (the detail view's composition). `test/custody-link.test.ts` scans the package's
source in both directions — no file may name `declared_value_amount_minor`, `declared_value_currency`,
or `declaredValue` at all, because reading one is the first half of copying it, and no file may issue
an `INSERT`, `UPDATE`, or `DELETE` against any `custody_*` table. Direction is deliberate: the column
is on the asset, so Custodian never grows a matter-scoped column and never learns what an estate is.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `@magna-carta/money`. It depends on no other domain package: a Directory entity, a stored file, and
  a custody item all arrive as handles, following the `matter_party` precedent of an id column with
  no cross-domain foreign key.
- The route layer (`apps/api-worker/src/http/routes/matters/matter-assets.ts`) hands every service the firm-scoped
  database, the real clock, a crypto random source, the authenticated actor, and — for the sealed
  identifier alone — the firm key provider. None of those is client input.

## Gotchas

- **`matter_asset_document` is deliberately NOT unique on `file_id`,** diverging from `custody_scan`.
  One brokerage statement lists four accounts and one appraisal covers a house and its contents;
  requiring a file to belong to one asset would force a firm to upload the same statement four times,
  which is how a link stops being used. Do not "fix" it.
- **`matter_asset.custody_item_id` has no unique index either.** The same held object can be
  scheduled in two matters — the decedent's estate and the related trust — and forbidding that would
  force a firm to unlink to get past a constraint.
- **Unlinking a document is allowed; correcting a valuation is not.** A link is a filing decision and
  a deed attached to the wrong house should be detachable. A recorded figure is an assertion somebody
  may have filed.
- **The asset's own as-of read filters `encumbrance_id IS NULL`, and always must.** The two kinds of
  number share a table and mean different things; drop the filter and a mortgage balance resolves as
  the house's value.
- **The type catalog's class is written by a follow-up statement, not by the insert.** The shared
  classification-type shape owns the `(id, name, code)` insert, so this catalog's extra column rides
  beside it — the custody item type's intrinsic-value default precedent. There is deliberately no
  path that MOVES a type between classes: every asset already filed under it carries that class.
- **The interest-label catalog is the custody ownership-role catalog's shape, reused.** An empty
  catalog constrains nothing, and the comparison is case-insensitive and trimmed, because a firm
  writing "Trustee" against an entry of "trustee" has made no mistake and refusing it teaches people
  to stop using the field.
- **`ATTRIBUTE_BUILDERS` in `asset-service.ts` is the whole table of classes-with-structure.** Adding
  a class is a row there plus a row in `ATTRIBUTE_TABLE_BY_CLASS`, not a ninth `if` somebody has to
  remember to write in the same shape as the eight before it. The class-mismatch refusal falls out of
  the same loop, so it cannot be forgotten for the new class.
- **A schedule is read WHOLE and refuses past its bound rather than paging.** `MAX_MATTER_ASSET_
  SCHEDULE` is a refusal, not a page size: a firm that filed the first five hundred rows of an inventory
  could not tell that from an inventory of five hundred. The register list is what pages.
- **`ORDER BY` does the selecting in every batched as-of read.** `readMatterAssetValuationsAsOf` and
  `readEncumbranceBalancesAsOf` order so the winning row per subject sorts first and take the first
  row seen — no window function, no correlated sub-select per row, and no sort in memory.
