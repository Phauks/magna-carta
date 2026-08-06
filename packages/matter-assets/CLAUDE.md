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
- **Nothing identifying is a telemetry dimension or an audit-metadata field.** No description, no
  address, no parcel number, no entity name, no amount, no suffix. Identifiers, the class, and the
  basis, and nothing else.

## The boundary with Custodian, stated so neither side drifts

Custodian describes **objects in the firm's possession** — where the paper deed is, who last touched
it, whether it may be released. The asset register describes **property in the client's ownership** —
what land that deed describes, what it was worth as of a date, who holds an interest, how the estate
treats it. They overlap on a minority of rows, are joined by one nullable `custody_item_id`, and
neither copies a fact from the other: the asset row carries no location, status, or movement history,
and Custodian carries no valuation. `custody_item.declared_value_amount_minor` and this history
answer different questions (a replacement value for the firm's own exposure, against a fair-market
value to the estate as of a date), so nothing syncs them and nothing derives one from the other.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`, and
  `@magna-carta/money`. It depends on no other domain package: a Directory entity, a stored file, and
  a custody item all arrive as handles, following the `matter_party` precedent of an id column with
  no cross-domain foreign key.
- The route layer (`apps/worker/src/routes/matter-assets.ts`) hands every service the firm-scoped
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
- **`encumbrance_id` on the valuation row is declared and unused.** It lands now because adding it
  later means rebuilding a table whose append-only triggers have to be dropped to do it; the
  encumbrance table itself arrives in slice 4·3·2, and until then every as-of read filters
  `encumbrance_id IS NULL`.
- **The type catalog's class is written by a follow-up statement, not by the insert.** The shared
  classification-type shape owns the `(id, name, code)` insert, so this catalog's extra column rides
  beside it — the custody item type's intrinsic-value default precedent. There is deliberately no
  path that MOVES a type between classes: every asset already filed under it carries that class.
- **The interest-label catalog is the custody ownership-role catalog's shape, reused.** An empty
  catalog constrains nothing, and the comparison is case-insensitive and trimmed, because a firm
  writing "Trustee" against an entry of "trustee" has made no mistake and refusing it teaches people
  to stop using the field.
- **The five classes with no attribute table yet are declared and refused by name.** A caller asking
  for a firearm gets "arrives in slice 4·3·2", not "no such thing" — the class spine, the labels, and
  the handling note are settled once rather than twice.
