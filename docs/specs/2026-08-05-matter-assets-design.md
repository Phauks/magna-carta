# Matter assets — design (proposed slice 4·3)

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 13 are open. No product code in this cycle.
**Scope:** The matter-attached asset register — what an asset row is and what anchors it, the
three-layer type system (platform class, per-firm catalog, the firm's own fields), the per-class
structured attributes, the append-only valuation history and its as-of reads, encumbrances and net
equity, interests held by Directory entities, the document link, the custody link, the estate
schedule, the merge-field subjects, the permission family, the HTTP contract, telemetry, and the
load-profile fit. Excludes: the user interface (named as seams only, section 11), the probate
inventory **form** for any jurisdiction, transfer law for any asset class, estate accounting
(receipts and disbursements), claims against an estate, external valuation and parcel adapters, and
the firm's own property register — each is named in section 2 with the reason it is out.
**White-paper home:** _Core domain — Matters and File Manager_, with _Directory_ (whose interests
these are), _Custodian_ (the physical originals, and the boundary in section 2), _Document
Automation_ (the schedule as a document), _Trust accounting_ (where sale proceeds land, as a seam),
and _Tenancy and data isolation_ as the surrounding context.
**Governing decisions:** ADR-0003 (tenancy), ADR-0084 (`protected()` fields), ADR-0107 / ADR-0108
(the custom-fields engine and its lifecycle), ADR-0014 and the ratified custodian flags (the
register/ledger idioms this reuses — firm-configurable role labels, business numbers left
unprotected, no platform defaults on a jurisdiction-bound fact), ADR-0008 (append-only discipline,
borrowed by analogy for the valuation history), ADR-0067 (route metadata and the chokepoint),
ADR-0077 (immutable versions), ADR-0081 (the one ingest chokepoint), ADR-0083 (load-profile
accretion), ADR-0085 / ADR-0086 (the Directory model), ADR-0210 / ADR-0211 (the document-assembly
engine and template model).
**Decision inputs:** the owner's ask, verbatim, over two turns — _"I would love a dedicated way to
add assets to any case (such as properties, with putting in address, apn, and the like, which you
can associate documents with)"_ and _"for assets, we can also show bank accounts, cars, guns, and so
many other items. this will be useful for keeping items together and make estates and asset logging
super easy."_ The shipped substrate this design is obliged to reuse:
[`packages/custodian`](../../packages/custodian) and
[`docs/specs/2026-08-04-custodian-design.md`](2026-08-04-custodian-design.md) (the register idioms
and the boundary), [`packages/directory`](../../packages/directory) (entities, the `matter_party`
no-cross-domain-foreign-key precedent), [`packages/file-manager`](../../packages/file-manager) (the
ingest chokepoint and the version model), [`packages/custom-fields`](../../packages/custom-fields)
(the per-firm field axis), [`packages/money`](../../packages/money) (minor units),
[`packages/property-links`](../../packages/property-links) (free external lookups for a parcel),
[`docs/specs/2026-08-05-merge-field-catalog-system-design.md`](2026-08-05-merge-field-catalog-system-design.md)
(the subject × facet catalogue these become subjects in), and
[`docs/research/property-data-integrations.md`](../research/property-data-integrations.md) (the
deferred parcel and valuation adapters this design leaves a shape for).

## Why now

The owner asked for it twice in one sitting, which is the strongest signal in this repository, and
every input it needs is already on `main` or already designed. The Directory carries the people and
organizations that hold interests. The File Manager carries documents behind a quarantine gate, and
because an asset belongs to a matter, attaching a deed to a house needs no new storage of record and
no new ingest path at all. Custodian shipped the register idioms — the per-firm type catalog, the
firm-configurable role label, the append-only ledger with correcting rows — and shipped the
distinction this design depends on: it holds the deed, and something else has to describe the house.
The merge-field catalog design, merged yesterday, established the subject × facet shape and
explicitly left `matter_estate` as the estate's identity while noting it has no asset list to point
at.

There is also a gap worth naming. `docs/research/property-data-integrations.md` opens with
date-of-death valuation of real property for the estate inventory as the driver for a whole
integration port — a port with no domain record to write into. This design is that record. It is
also what makes the port cheap when it arrives: a parcel adapter fills columns that already exist,
and a valuation adapter appends rows to a history that already has a `basis` for a machine estimate.

## 1. The one-sentence model, and the boundary that follows from it

**An asset row is one matter's assertion about one thing the client or the estate owns, and every
number on it is dated.**

Both halves are load-bearing.

**"One matter's assertion"** is why the asset register roots at the matter and Custodian roots at
the Directory. Custodian's anchor is the entity because a firm holds a will for a client whose last
matter closed eleven years ago; an unattributable envelope is its catastrophic failure. The asset
register's anchor is the matter because the same house is a different record in the husband's
divorce and in his mother's estate — different valuation dates, different encumbrances, different
disposition, and different privilege. A cross-matter "thing" identity would have to reconcile those,
and reconciling them is not a feature anyone asked for; it is a way to leak one matter's numbers
into another. So `matter_asset.matter_id` is `NOT NULL`, and carrying an asset forward from a prior
matter is a copy with recorded provenance (section 2, deferred to 4·3·4), never a shared row.

**"Every number is dated"** is why there is no `current_value` column anywhere in this design.
Section 5.

**The boundary with Custodian, stated crisply because it is the question a reader arrives with:**

| Question                                                                         | Owner                           |
| -------------------------------------------------------------------------------- | ------------------------------- |
| Where is the paper deed, and who last touched it?                                | Custodian                       |
| What land does that deed describe, and what is it worth as of the date of death? | The asset register              |
| We hold an envelope for a former client with no open matter                      | Custodian, and only Custodian   |
| The estate owns a house whose deed the firm has never seen                       | The asset register, and only it |
| The estate owns the jewelry that is in our safe                                  | Both, linked once (section 7.2) |

Custodian describes **objects in the firm's possession**. The asset register describes **property in
the client's ownership**. They overlap on a minority of rows and are joined by one nullable column;
neither copies a fact from the other. A firm that holds a share certificate for a former client and
never opens an estate has a custody packet and no asset row, and that is correct. A firm
administering an estate holding a brokerage account has an asset row and no custody packet, and that
is correct too.

## 2. What ships, and what does not

| Slice     | Ships                                                                                                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4·3·1** | The register core: the asset row, the class spine, the per-firm type catalog, interests, the append-only valuation history with as-of reads, document links, bulk quick entry, real property and financial accounts. |
| **4·3·2** | The remaining classes (vehicle, firearm, business interest, insurance policy, receivable, digital asset), encumbrances and net equity, the grouped schedule read, the custody item link, disposition.                |
| **4·3·3** | The merge-field asset subjects and the one new assembly source; the firm's own fields on an asset (`custom_field.target` widening); the schedule as an assembled document.                                           |
| **4·3·4** | Carry-forward from a prior matter with recorded provenance; the parcel and valuation integration adapters against the ports the research note describes; portal visibility of a client's own schedule.               |

**Non-goals, named so they are not re-derived.**

_Transfer law for any class._ Section 6 is the whole treatment: the register records what is owned
and refuses to say who may receive it. This is not caution for its own sake — it is the same posture
the custodian design took on will-deposit statutes and the same one
[`docs/research/2026-08-05-nevada-will-custody-statutes.md`](../research/2026-08-05-nevada-will-custody-statutes.md)
was written to satisfy: a jurisdiction fact is encoded from verified primary text or it is not
encoded.

_The probate inventory form._ The register produces a grouped schedule with dated values and net
equity. Turning that into the form a particular court accepts is document automation plus a verified
form catalog, and the Nevada research established that the relevant rules run **below** state level
(county court rules), which is exactly the depth at which a guessed form is worse than none.

_Estate accounting._ Receipts and disbursements, the fiduciary accounting, and claims against the
estate are a ledger, not a register — different grain, different invariants, and the platform
already has a ledger core. A likely cousin; not this subsystem. The register's contribution to it is
the opening inventory.

_Liabilities in general._ An **encumbrance on an asset** is in scope (section 5.4) because it is
what makes a schedule's equity column correct. Unsecured debts — a credit card, a medical bill — are
claims against an estate and belong to estate accounting above.

_The firm's own property register._ Equipment, depreciation, insurance schedules. Custodian already
declared this a non-goal for the same reason it is one here: firm property has a different duty, a
different audience, and different answers to every access and reporting question. If it is ever
built it is `firmAssets:*`, not a class on this table.

_Credentials, in any form._ Section 4.4. No password, no seed phrase, no private key, no safe
combination, in any column, protected or otherwise.

_Cross-matter asset identity._ Section 1.

## 3. The type system — three layers, each with one job

The ask spans real property, bank accounts, cars, guns, "and so many other items". A single flat
type list cannot serve that, because the whole point of typing a house is that it has a parcel
number and the whole point of typing a car is that it has a vehicle identification number. Three
layers, and which layer a fact belongs to is decided by **who needs to reason about it**.

### 3.1 Layer 1 — the asset class, a closed platform enum

`matter_asset.class`, ten values, closed:

`realProperty` · `financialAccount` · `vehicle` · `firearm` · `businessInterest` ·
`insurancePolicy` · `receivable` · `digitalAsset` · `personalProperty` · `other`

**Closed, deliberately against the custodian precedent, and the divergence is the interesting
part.** `custody_item_type` is a per-firm catalog because the type there drives iconography and one
default flag — nothing branches on it, so a firm inventing a type costs nothing. Here the class
**decides which structured attributes exist**, which merge subject the row appears under, and which
column a search hits. A firm cannot mint the concept "has a vehicle identification number"; that is
a schema fact with a table, an index, a merge facet, and a report column behind it. So adding a
class is a platform change with a migration, and that cost is correct: it is exactly the work adding
a class actually implies.

`other` and `personalProperty` are the pressure valve, and they carry no attribute table — a
description, a value history, documents, and the firm's own fields are the whole of them. Nothing is
ever blocked; what an unforeseen thing loses is structured search, which is honest.

### 3.2 Layer 2 — the asset type, a per-firm catalog under a class

`matter_asset_type` — `id`, `name`, `class`, optional `code`, `active`, position, timestamps —
following `custody_item_type` / `document_type` / `matter_type` exactly: seeded on provisioning,
extended by the firm, soft-deactivated and never deleted, unique name per firm.

This is where "so many other items" lives without a schema change. Under `realProperty`:
single-family residence, condominium, vacant land, timeshare, mineral interest, leasehold. Under
`financialAccount`: checking, savings, brokerage, certificate of deposit, individual retirement
account, employer retirement plan, education savings. Under `vehicle`: automobile, truck, motorcycle,
boat, trailer, recreational vehicle, aircraft. Under `firearm`: handgun, rifle, shotgun. Under
`personalProperty`: jewelry, artwork, collection, household furnishings, livestock.

The invariant: **an asset's type must belong to the asset's class.** Enforced in the write path (the
type is a foreign key and the class is a column; a mismatch is a refusal with its own problem type).
A firm that wants "IRA" under `vehicle` is making a data-entry error, not expressing a preference.

The type is **optional on the asset**. A paralegal logging "the house on Elm Street" at intake
should not have to decide between "single-family residence" and "residence" before the row exists.

### 3.3 Layer 3 — the firm's own fields

`custom_field.target` widens to include `matterAsset`, which is the same one-value additive change
to a shipped engine the custodian design specified for `custodyPacket` — and it is the
reuse-before-building answer, because the alternative is a second key/value system inside a second
register. Handle-not-name binding, the engine's existing lifecycle, the engine's existing limits.

Scoped per class through the existing `attachment_id` column, so "slip number" appears on vehicles
and not on bank accounts, and a firm that wants a field on everything leaves the scope empty. This
matches how the engine already scopes matter-axis fields and needs no new mechanism.

**The line between layer 2 and layer 3, stated once:** a _kind_ of thing is a type (a row in the
catalog); a _fact about_ a thing is a field. "Timeshare" is a type. "Week number" is a field on it.

### 3.4 The core row

`matter_asset` — `id`, `matter_id` (NOT NULL), `class` (frozen at creation), `asset_type_id`
(nullable, must match the class), `description` (NOT NULL, non-empty), `acquired_on` (nullable),
`estate_treatment`, `disposition`, `disposition_on`, `custody_item_id` (nullable — section 7.2),
`notes`, `created_at` / `created_by`, `updated_at`, `deleted_at`.

**Only two fields are required: the class and a description.** This is the deliberate inversion of
Custodian's mandatory owner link. There, orphan prevention is structural because an unattributable
original is the catastrophe. Here the catastrophe is a register nobody fills in, and every required
attribute is a reason to keep the list in a spreadsheet instead. A row that says
`personalProperty / "contents of the garage, not yet itemized"` is a useful row.

**The class is frozen at creation.** A class change is a delete-and-recreate wearing an update — it
orphans the attribute row and moves the asset to a different merge subject — and the register's
answer to a mis-classed row is to delete it and add it again, which is cheap because the row is
minutes old and soft-delete already exists. Freezing costs nothing and removes a whole family of
partial-migration states.

**`estate_treatment`** — `probateEstate` · `nonProbateTransfer` · `undetermined` (default).
**Asserted by a person, never derived.** Whether a jointly held house passes outside probate turns
on the form of co-ownership, which is jurisdiction-specific, unevenly named, and the single fact
this design most refuses to infer (section 4.3). The register records what the firm concluded; it
does not conclude.

**`disposition`** — `retained` (default) · `sold` · `transferred` · `distributed` · `abandoned` ·
`lost`, plus a date. The _price_ of a sale is not a column here: it is a valuation row with basis
`sale` (section 5.2), so the history already tells the whole story and there is one home for every
number.

## 4. Per-class attributes

### 4.1 One table per class that has structure, none for a class that does not

Three shapes were considered. **One wide table** with every class's columns nullable makes every
check constraint conditional, lets a vehicle carry a parcel number, and turns each new class into a
column sprawl on the hottest table in the subsystem. **A generic attribute bag** re-implements
custom fields, loses typed constraints, and makes "find the car with this vehicle identification
number" a table scan over strings. **A one-to-one attribute table per class** gives real check
constraints, real indexes on the identifiers people actually search by, and a merge facet set that
is literally the column list.

The third, then — and a class with no structure gets no table at all. `personalProperty` and `other`
carry the core row and nothing else.

| Table                            | Columns                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `matter_asset_real_property`     | `street`, `city`, `region`, `postal`, `county`, `parcel_number`, `legal_description`, `recording_reference`              |
| `matter_asset_financial_account` | `institution_name`, `institution_organization_id` (optional Directory organization)                                      |
| `matter_asset_vehicle`           | `make`, `model`, `model_year`, `vehicle_identification_number`, `plate_number`, `plate_region`                           |
| `matter_asset_firearm`           | `make`, `model`, `caliber_or_gauge`, `serial_number`, `regulated_category` (free text, asserted — section 6)             |
| `matter_asset_business_interest` | `entity_name`, `entity_organization_id` (optional Directory organization), `jurisdiction_of_organization`, `entity_form` |
| `matter_asset_insurance_policy`  | `carrier_name`, `carrier_organization_id`, `face_amount_minor` + `face_amount_currency`, `insured_entity_id`             |
| `matter_asset_receivable`        | `debtor_entity_id`, `principal_amount_minor` + currency, `interest_rate_e4`, `maturity_on`, `secured` (boolean)          |
| `matter_asset_digital_asset`     | `platform_name`, `account_handle`, `custody_model` (`custodial` / `selfCustodied` / `unknown`)                           |

Notes that are decisions rather than description:

**Real-property column names match `PropertyReference` in `@magna-carta/property-links` exactly**
(`street` / `city` / `region` / `postal` / `apn`, carried here as `parcel_number` per golden rule 12
with the mapping done at the boundary). That is not cosmetic: it means a real-property asset renders
assessor, mapping, and listing-site lookups today, through
`resolvePropertyLinks(...)`, with no new code, no credential, and no adapter. It is also the shape a
parcel adapter would later fill.

**The face amount of a policy is a term of the contract, not a valuation.** It sits on the attribute
row. What the policy is _worth_ — cash surrender value — is a valuation row like any other. Two
different numbers that a schedule reports in two different columns; collapsing them would make every
term-life policy look like a liquid asset.

**A business interest optionally _is_ a Directory organization.** The firm probably already has the
company as an entity, and pointing at it brings its address, its registered agent, and its
relationships for free. Optional, because a client's twelve-percent interest in a company the firm
has never dealt with does not deserve a Directory row.

**No cross-domain foreign keys on Directory handles** — `institution_organization_id`,
`debtor_entity_id`, `insured_entity_id`, `entity_organization_id` are id columns with no reference,
following the `matter_party` and `custody_owner` precedent.

### 4.2 Identifiers: public-record ones are columns, secret ones are ciphertext

The sharpest confidentiality question in the subsystem, and it has a principled line rather than a
per-field judgement:

> **An identifier that appears on a public record is an ordinary searchable column. An identifier
> that functions as a credential-adjacent secret is stored only as ciphertext, and only its last
> four digits are readable without a decrypt.**

Public record, therefore plaintext and indexed: the **parcel number** (on the assessor's roll), the
**vehicle identification number** (on the title and etched in the windscreen), the **plate number**,
the **firearm serial number** (on the bill of sale and on the transfer paperwork), the **legal
description**, the **recording reference**. Every one of these is a thing a person searches by, and
searching by them is the point.

Secret, therefore protected: **full account numbers, policy numbers, certificate numbers, and tax
identifiers.**

`matter_asset_identifier` — `id`, `asset_id`, `kind` (`accountNumber` · `policyNumber` ·
`certificateNumber` · `taxIdentifier` · `other`), `display_suffix` (plaintext, at most four
characters), `value_ciphertext`, `created_at` / `created_by`. The ciphertext column is registered in
`PROTECTED_COLUMNS` and reaches the world only through the `protected()` chokepoint: encrypted on
write, permission-checked and audited on read, with the acting member's decrypt permission required
and a `protected.decrypt` audit row per read.

**Every list, report, and merge field reads `display_suffix` and nothing else.** The full value has
exactly one read path, and it is a deliberate act with an audit row. This is why `display_suffix`
lives on the identifier row rather than on the financial-account attribute row: one home for the
fact, and the attribute table stays free of a number that has to stay in step with a ciphertext.

**A firm may record no full number at all** — `value_ciphertext` is nullable, `display_suffix` alone
is a complete and often preferable record. The register never asks for the whole number to function.

### 4.3 What the register refuses to infer

Three refusals, each with a real failure behind it:

- **Form of co-ownership, and therefore probate inclusion.** Recorded as an interest label the firm
  chose (section 7.1) and an `estate_treatment` a person set. Nothing derives one from the other.
  Encoding "joint tenancy means non-probate" would be right in most states and catastrophic in the
  ones where it is not, on the one document a court reads.
- **Value.** No default, no carry-forward from a purchase price, no estimate. An asset with no
  valuation row reports as unvalued, visibly, which is a true statement and an actionable one.
- **Whether an asset is complete.** No required-attribute matrix per class, no completeness score,
  no "this house needs a parcel number" gate. The schedule report surfaces what is missing; the
  write path never blocks on it.

### 4.4 Credentials are refused outright

**No column in this subsystem holds a password, a passphrase, a seed or recovery phrase, a private
key, a personal identification number, or a safe combination — not in plaintext and not as a
protected value.** A protected column is decryptable by any member holding the decrypt permission,
and for a self-custodied digital asset the seed phrase _is_ the asset: whoever reads it can take it,
irreversibly, with no record. Storing it converts a records system into a bearer instrument.

The write path refuses a request that names one (a dedicated problem type, so the refusal is
explainable rather than a validation shrug), the `digital_asset` attribute table has no column that
could hold one, and the documented answer is the one the platform already has: a sealed envelope in
the custody register, where a physical object has a location, a hold, and an append-only record of
every hand it has passed through. That is the correct home for a secret whose disclosure is a
transfer of the asset, and it is a good example of the two subsystems doing their own jobs.

## 5. Valuation over time

### 5.1 The invariant

**A valuation is appended, never updated and never deleted, and there is no current-value column.**

An estate needs the date-of-death value and today's value and, in a long administration, several in
between; a family-law matter needs date-of-marriage and date-of-separation values for the same
house. One mutable number cannot answer two of those questions, and a number that can be edited
after a schedule was filed means the register and the filed document can silently disagree with
nobody able to say when they diverged.

Enforced exactly as the custody movement ledger is, because that is what append-only means in this
tree rather than a fourth invented pattern: `BEFORE UPDATE` and `BEFORE DELETE` triggers that
`RAISE(ABORT)`, a `BEFORE INSERT … WHEN EXISTS` trigger that refuses an `INSERT OR REPLACE`
masquerading as an insert, and a source-scan fitness function rejecting any `UPDATE` or `DELETE`
naming the table. Triggers are not modelable in drizzle-kit, so the migration is hand-written raw
SQL — the constraint the conflicts and custody migrations already live with.

**A typo is corrected by a compensating row** carrying `corrects_valuation_id` and a reason, which
supersedes the corrected row in every read. The same discipline the financial ledger applies to a
mis-posted entry, and the same one the custody ledger applies to a mis-recorded movement. The cost
is that fixing a fat-fingered figure takes one extra field; the benefit is that the register can be
handed to a court.

### 5.2 The row

`matter_asset_valuation` — `id`, `asset_id` (NOT NULL), `encumbrance_id` (nullable — section 5.4),
`as_of_date`, `amount_minor` + `currency`, `basis`, `source_note`, `supporting_file_id` (nullable),
`corrects_valuation_id` (nullable), `recorded_by`, `recorded_at`.

**`as_of_date` and `recorded_at` are separate**, for the reason the custody ledger separates
`occurred_at` from `recorded_at`: an appraisal dated the day of death is typed in four months later,
and collapsing the two makes back-dating either impossible or indistinguishable from falsification.
Reports read `as_of_date`; `recorded_at` proves when the assertion was made.

**`basis` is a closed platform vocabulary**, because unlike a type catalog this one is read by
reports, by merge fields, and eventually by a court, and a firm inventing "guesstimate" as a basis
is not a capability anyone wants: `appraisal` · `statement` · `taxAssessment` · `marketQuote` ·
`guideBook` · `broker` · `sale` · `purchasePrice` · `courtDetermined` · `clientEstimate` ·
`automatedEstimate`.

Two of those earn a sentence. **`sale`** is how a disposition's price enters — one home for numbers.
**`automatedEstimate`** exists now, with nothing writing it, so the valuation adapter the research
note anticipates has a truthful basis to write and can never masquerade as an appraisal.

**`supporting_file_id`** points at the appraisal, statement, or bill of sale behind the figure — an
ordinary matter file, linked the same way section 7.3 links every other document. A valuation whose
support is in the file is worth more than one that is not, and this is the cheapest possible way to
say so.

**Money is `amount_minor` plus a currency through `@magna-carta/money`, never a float.** A schedule
spanning currencies reports per currency and refuses to sum across them; the aggregate is not
approximated.

### 5.3 The as-of read

The register's characteristic query: **for each asset, the valuation whose `as_of_date` is the
latest at or before a requested date, excluding any row a correction supersedes.**

Three properties this must have, and they are the reason it is stated as a rule rather than left to
the implementation:

- **A date before an asset's first valuation resolves to nothing, not to the earliest value.** An
  asset acquired after the date of death is not in the estate at the date of death, and extrapolating
  backwards would put a number on a schedule that no one asserted.
- **The answer always travels with its date.** Every read that returns an amount returns the
  `as_of_date` and `basis` it came from. There is no path in this subsystem by which a value is
  rendered without the date it belongs to — including merge fields (section 8), where an undated
  figure in a filed document is the failure mode with the worst consequences.
- **Where the date comes from is not this subsystem's fact.** For an estate it is the date of death,
  which the merge-field catalog design places on `matter_estate` and which is that record's fact
  alone. The register reads a date; it never stores a second copy of one. Until `matter_estate`
  lands, the caller supplies the date, and the estate record becomes its source with no change to
  this contract.

The query _shape_ — a correlated sub-select, a window function, or a maintained pointer column — is
a measurement, not a preference (section 10, and open question 1).

### 5.4 Encumbrances and equity

`matter_asset_encumbrance` — `id`, `asset_id`, `kind` (`mortgage` · `deedOfTrust` · `lien` ·
`judgment` · `securityInterest` · `taxLien` · `pledge` · `other`), `holder_entity_id` (optional
Directory handle), `holder_name` (free text where no Directory record exists — the custody borrower
precedent, and for the same reason: writing every lender into the Directory pollutes the conflicts
corpus), `recorded_reference`, `released_on`, timestamps.

**An encumbrance's balance is a valuation row.** `matter_asset_valuation.encumbrance_id`, when set,
means the row is that encumbrance's balance as of a date rather than the asset's value as of a date.
One append-only table, one trigger set, one as-of query shape, and net equity as of any date is one
read over one table with a sign flip. Two tables that differ only in what the number means would
have been two of everything.

**Equity is computed, never stored.** Value as of the date, minus every unreleased encumbrance's
balance as of the same date, per currency.

### 5.5 Valuations are not `protected()`

The ratified custodian flag C9 settled this shape for declared values and the reasoning transfers
without change: a valuation is a business number about an object, not an identifier about a person,
and the `protected()` chokepoint's cost — a permission check and an audit row per read — is the
right price for a tax identifier and the wrong price for forty figures in a schedule view. The
register's confidentiality is handled where it actually lives: the permission family (section 9.1),
the telemetry rule (section 9.3), and the firm-scoped data-access layer.

## 6. Firearms, and type-specific legal handling

The owner named guns explicitly, and they are the class where recording and advising are easiest to
confuse. The design's position is narrow and complete:

**The register records a firearm the way it records a car.** Make, model, caliber or gauge, serial
number, a value history, documents, and an interest. That is a records capability, it is what a
lawyer administering an estate needs on day one, and it carries no more legal weight than writing
the same facts on a legal pad.

**The register encodes no transfer law, and will not guess at any.** It does not determine who may
receive a firearm, does not decide whether a transfer needs a licensed dealer, does not classify an
item under the National Firearms Act, does not check a prohibited-person status, does not generate
transfer paperwork, and does not compute a deadline. Federal law and fifty states' laws vary on
every one of those points, they vary by the recipient as well as the item, and a rule that is ninety
percent right is worse than no rule because it will be trusted.

**`regulated_category` is asserted, never derived.** A free-text field a person fills in when they
have concluded something ("NFA — suppressor, Form 4 pending"), carrying no behaviour. Nothing
branches on it; it exists so the conclusion a lawyer reached is written next to the item rather than
in an email.

**A standing, non-jurisdictional notice, authored once.** Where a class carries known type-specific
legal handling, the class registry carries a `handling_note` — a short, owner-reviewed sentence
shown on the class's surfaces. For firearms: transfers are regulated by federal and state law, and
this register records what is held rather than who may receive it. It names no rule, cites no
statute, and states no deadline, so it cannot be wrong when the law changes; it exists so nobody
reads a tidy row and infers the platform has checked something. The same mechanism is available to
any class the owner wants it on and is empty for the rest.

**The jurisdiction catalog is a named seam with nothing in it.** If firearm transfer handling is
ever encoded it follows the pattern the trust-rules catalog established and the custodian design
re-affirmed: jurisdiction-keyed reference data, verified against primary text at build time, shipped
one jurisdiction at a time, with an explicit "not encoded for your jurisdiction" state for the rest
and never a silent generic fallback. The Nevada will-custody research is the template for what
"verified" means here. Owner flag A5 asks whether that work is wanted at all.

The same reasoning applies, less loudly, elsewhere: vehicle title transfer varies by state, a
business interest's transferability turns on an operating agreement the platform has not read, and a
retirement account's beneficiary designation overrides a will. In each case the register records the
fact and the seam, and says nothing about the consequence.

## 7. Relations

### 7.1 Interests — who owns it

`matter_asset_interest` — `id`, `asset_id`, `entity_id` (a `directoryPerson_` or
`directoryOrganization_` handle, no cross-domain foreign key), `interest_role`,
`share_numerator` / `share_denominator` (both nullable), `effective_from`, `effective_to`,
timestamps.

**The owner link is optional here, and mandatory in Custodian.** The inversion is deliberate and
follows from section 1: a custody packet with no owner is an orphan nobody can release; an asset
with no recorded interest is simply an asset of the matter, which is the common case for an estate
where everything is the decedent's. Interests are for the exceptions — the jointly held house, the
business the client owns thirty percent of, the account with a named beneficiary — and forcing a row
for the common case would be friction with no failure behind it.

**`interest_role` is a firm-configurable label validated against a per-firm catalog**, exactly the
ratified custodian C5 answer, for exactly the same reason: tenancy forms are jurisdiction-specific
and unevenly named, and the platform has no engine that consumes them, so a closed enum would be
false precision in schema that a later engine has to migrate away from. Seeded set: owner, joint
owner, co-owner, titleholder, life tenant, remainderman, trustee, beneficiary, payable-on-death
beneficiary, secured party, lessee.

**A fractional share is a rational number, not a decimal.** `share_numerator` /
`share_denominator` — because one third is not representable as a decimal, and three siblings whose
shares sum to 99.99 percent on a court filing is a defect the schema should make impossible rather
than a rounding note. Both null means the share is unstated, which is different from zero.

### 7.2 The custody link — one nullable column, no duplicated facts

`matter_asset.custody_item_id`, nullable, pointing at a **custody item** rather than a packet,
because the item is Custodian's unit of description and an asset corresponds to a described thing —
a packet holding a will, a deed, and a share certificate contains at most one of them that is also a
scheduled asset.

**Who owns which fact, stated so neither side drifts:**

| Fact                                                    | Home                                              |
| ------------------------------------------------------- | ------------------------------------------------- |
| Where the object is; who has it; every movement it made | Custodian                                         |
| Whether it may be destroyed or released; holds          | Custodian                                         |
| What it is worth, as of a date, on what basis           | The asset register                                |
| Who holds an interest in it; the estate treatment       | The asset register                                |
| What it is                                              | Described on both, independently and deliberately |

The asset row copies no location, no status, and no movement history; a detail view that wants them
reads Custodian. Custodian copies no valuation.

**The one fact that looks duplicated is not.** `custody_item.declared_value_amount_minor` and the
asset's valuation history answer different questions: the custody figure is what the object is worth
as a thing in a safe (an insurance and risk number for the firm's own exposure), and the valuation
is what the property is worth to the estate as of a date on a stated basis. A signed first edition
in the safe has a replacement value and a fair-market value and they are not the same number.
Nothing syncs them, nothing derives one from the other, and each subsystem's reports use its own.

**No unique index on `custody_item_id`.** The same held object can be scheduled in two matters — the
decedent's estate and the related trust — and forbidding that would force a firm to unlink to get
past a constraint, which is how a link stops being trustworthy.

**Direction:** the column is on the asset, so Custodian never grows a matter-scoped column and never
learns what an estate is. The newer, narrower subsystem points at the older, broader one.

### 7.3 Documents — the association the owner named first

`matter_asset_document` — `id`, `asset_id`, `file_id`, `kind` (`deed` · `title` · `statement` ·
`appraisal` · `policy` · `registration` · `billOfSale` · `photograph` · `correspondence` · `other`),
`note`, `linked_at`, `linked_by`.

A link over ordinary File Manager files — the `custody_scan` shape, reused — and it is **simpler
here than it was there**, which is worth pointing out because it is a direct dividend of
matter-rooting. Custodian had to solve `file.matter_id NOT NULL` against a packet that may have no
matter, and the answer was a per-firm system holding matter. An asset always has a matter, so its
documents are ordinary matter documents in an ordinary matter folder, and the holding-matter
machinery is neither needed nor used. **A deed attached to a house is still in the matter's file
list, still previewable, still convertible, still under any legal hold, still in discovery.** It
gained an association; it lost nothing.

Bytes never reach an asset route: upload is the File Manager's existing presigned-upload and
quarantine chokepoint, and this route links the resulting handle. One ingest chokepoint, no
exceptions.

**Many-to-many, unlike `custody_scan`'s unique index on `file_id`.** One brokerage statement lists
four accounts; one appraisal covers a house and its contents; one photograph shows a room of
furniture. Requiring a file to belong to one asset would force a firm to upload the same statement
four times, which is how a link stops being used. The divergence from the custody precedent is
deliberate and is stated here so a reader does not "fix" it.

**Unlinking is allowed and audited.** A link is a filing decision, not a record of a historical
event; a deed attached to the wrong house should be detachable. The valuation history, by contrast,
is not.

### 7.4 Trust — a seam, not a build

Sale proceeds land in the trust account. That is a **trust ledger movement** — a receipt into the
matter's leaf, governed by the trust subsystem's invariants and its two-person rules — and this
design writes none of it. The register's whole contribution is that the sale is recorded as a
disposition with a `sale`-basis valuation on the date it happened, so the schedule reconciles
against the trust receipt by eye and, later, by report.

No column here references a trust movement, no code path posts an entry, and no balance is derived.
When a reconciliation view is wanted it joins two subsystems that each already hold their own truth
— which is only possible because neither tried to hold the other's.

## 8. Merge fields, the schedule, and estate framing

### 8.1 Asset classes become list-valued subjects

The merge-field catalog design's shape holds without amendment: a flat exactly-matched key, subjects
crossed with facets, `.all` as the collection a repeating block walks, one batched read per source.
Assets enter as **eleven new subjects of a new subject kind `assetClass`** — one per class, plus an
aggregate `assets` — and **one new source**.

**Asset subjects are collection-only, and this is the one place the catalog's rules produce a
different answer than they do for parties.** A party subject has a singular slot (`client.displayName`)
because a matter has one client. An asset subject has no singular slot at all: an estate with two
houses is the normal case, so a scalar `realProperty.parcelNumber` would resolve to an absence
naming the count on most real matters — level 1 of the ambiguity rule producing a technically
correct answer that is useless every time. So the register declares `realProperty.all`,
`vehicle.all`, `assets.all` and no scalars, and the ambiguity rule is honoured by not creating slots
it would have to refuse.

**Facets ride `itemFields`**, the property the dictionary entry already carries. The common item
fields on `assets.all`: `description`, `className`, `typeName`, `value`, `valueAsOf`, `valueBasis`,
`estateTreatment`, `disposition`. A class subject's items add that class's attributes —
`realProperty.all` items carry `address` (the structured `address` value type the catalog design
adds, so every address format works), `parcelNumber`, `legalDescription`, `county`;
`vehicle.all` items carry `make`, `model`, `modelYear`, `vehicleIdentificationNumber`;
`financialAccount.all` items carry `institutionName` and `accountSuffix`.

**No protected value is ever a merge facet.** `accountSuffix` is the facet; the full account number
has no key at all. A merge field that decrypts an identifier into an assembled document writes the
secret into a file whose confidentiality is then the file's problem, and the audit row says a
decrypt happened without saying where the value went. The suffix is what a letter needs
("account ending 4417"), and the exception, if the owner ever wants one, is a deliberate later
decision with its own flag rather than a silent consequence of the catalogue growing.

**Every value facet is accompanied by its date.** `value` and `valueAsOf` are declared together, and
the register's user documentation says plainly that a template printing one without the other is a
template bug. This is the strongest reason the design has for exposing no total-value scalar.

**Totals are expression aggregates, not keys**, per the catalogue's rule that anything the
expression language can compute is not a key — and per the aggregates work already accepted. A
mixed-currency aggregate refuses, visibly, rather than summing.

### 8.2 One source, one read

Per the catalog's source budget: **assets add exactly one source and one read.** A statement over
the matter's assets, left-joined to their class attribute rows and to the as-of valuation resolution
(section 5.3), returning every class's items in one pass. Eleven subjects ride it, because a subject
is a pass over rows already in memory. **Adding the twelfth class adds no read** — the property the
catalog design's whole shape exists to preserve, holding here on the first outside subsystem to
join it.

### 8.3 The schedule

`GET /api/v1/matters/{matterId}/asset-schedule?asOf=…` — the probate-inventory _shape_, without the
form: grouped by class, each row carrying description, type, the value as of the requested date with
its basis and actual as-of date, unreleased encumbrances with their balances as of the same date,
computed equity, and estate treatment; subtotals per class per currency; a count of unvalued assets
stated rather than hidden.

Three things this is not. It is **not a court form** (section 2). It is **not a stored document** —
it is a read, and assembling it into a document is document automation over the same subjects. And
it **does not decide what is in the estate** — it groups by the `estate_treatment` a person
asserted, and reports `undetermined` as its own group rather than guessing.

"Keeping items together", the owner's phrase, is this section plus section 7.3: everything the firm
knows about a thing — what it is, what it is worth and when, who has an interest, what secures it,
which documents evidence it, and whether the firm holds the original — reachable from one row.

### 8.4 Easy logging, taken as a requirement

"Super easy" is a design constraint, so it gets mechanisms rather than an intention:

- **Two required fields** (section 3.4), and the type is optional.
- **A bulk route in the first slice, not deferred.** `POST /api/v1/matters/{matterId}/assets/batch`
  takes a bounded list of rows in one idempotent call, so a paralegal working from a client
  questionnaire enters twenty items in one submit rather than twenty round trips. Deferring it means
  the interface builds a client-side loop that half-fails, and retrofitting idempotency onto that is
  worse than building the route now.
- **A valuation may be supplied inline at creation** and is written in the same batch as the asset —
  one call, two rows, one audit entry. The common intake gesture is "a house on Elm Street, about
  four hundred thousand", and making that two requests would be the design losing to a spreadsheet.
- **No completeness gate anywhere** (section 4.3).
- **Carry-forward from a prior matter** is the remaining half of easy logging and is deferred to
  4·3·4 (section 2), because copying rows between matters needs a provenance record and an explicit
  read of the source matter, and neither is a first-slice question.

## 9. Tenancy, permissions, and confidentiality

### 9.1 The permission family — argued, since the alternative is credible

Three options were live. **Riding `matters:read` / `matters:manage`** is the cheapest and is wrong:
the register concentrates a matter's financially sensitive facts — what the estate owns, what it is
worth, account suffixes, firearm serial numbers, home addresses — in one surface, and a firm that
gives a scheduling paralegal `matters:manage` has not thereby decided to give them the estate's asset
ledger. **A four-key family** (`assets:read`, `assets:manage`, `assets:value`, `assets:configure`)
adds gates no workflow needs and keys that get seeded carelessly, which the ratified custodian C10
answer already rejected on the same grounds.

**Two keys, `matterAssets:read` and `matterAssets:manage`, bound to `resource: "matter"`.**

The namespace is `matterAssets` rather than `assets` because the shorter word already means two
other things in this repository — Workers Static Assets, and the firm's own property register that
section 2 deliberately excludes — and a permission key is read by people deciding who can see what.
Golden rule 12 settles the tie toward the unambiguous name.

The resource binding is `matter`, unambiguously, and it is the clean contrast with Custodian's
deliberate `firm` binding: `custody:*` binds the firm because a packet may have no matter by
construction, and `matterAssets:*` binds the matter because an asset row _is_ a matter's assertion
and cannot exist without one. `RESOURCE_BY_PERMISSION_NAMESPACE` gains one row.

**The protected identifier read is separately gated** by the existing decrypt permission through the
`protected()` chokepoint, so `matterAssets:read` alone never reveals a full account number. That is
the third gate the four-key option was reaching for, and it already exists.

### 9.2 Personal data

The register holds personal data and its metadata alone is sensitive — "this person owns these
eleven things" is a disclosure with no document attached. Every new person-referencing table is
classified in the personally-identifiable-information registry **in the same change that creates
it**, with the coverage fitness function forcing it:

| Table                           | Subject reference                   | Treatment                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter_asset_interest`         | Directory entity                    | `retain-under-matter` (the `matter_party` precedent)                                                                                                                                                                  |
| `matter_asset_real_property`    | a person's home address             | `retain-under-matter`                                                                                                                                                                                                 |
| `matter_asset_identifier`       | ciphertext plus a suffix            | `retain-under-matter`; crypto-shred reaches it                                                                                                                                                                        |
| `matter_asset_receivable`       | debtor entity                       | `retain-under-matter`                                                                                                                                                                                                 |
| `matter_asset_insurance_policy` | insured entity                      | `retain-under-matter`                                                                                                                                                                                                 |
| `matter_asset_encumbrance`      | holder entity **and** `holder_name` | `retain-under-matter`, with the free-text name a value-keyed subject key (the frozen-email-address precedent — keying only on the entity id would leave every lender with no Directory record unreachable by erasure) |
| `matter_asset_valuation`        | `recorded_by`                       | `pseudonymize-keep` — append-only rows are never deleted                                                                                                                                                              |

### 9.3 Telemetry and logs

No address, parcel number, vehicle identification number, plate, serial number, institution name,
account suffix, description, entity name, or amount is ever a telemetry dimension or a log field.
Dimensions are the class, the basis, the outcome, and coarse buckets. Section 10.

## 10. The API surface, telemetry, and load-profile fit

### 10.1 Routes

Code-as-contract per the API conventions: `createRoute` blocks with Zod schemas for every status,
`RouteMeta` on every route, all of it through the one chokepoint. Lists are cursor-paginated
`{ data, nextCursor }`.

| Route                                                        | Permission                    | Audited | Idempotency | Notes                                                                                        |
| ------------------------------------------------------------ | ----------------------------- | ------- | ----------- | -------------------------------------------------------------------------------------------- |
| `GET /api/v1/matters/{matterId}/assets`                      | `matterAssets:read`           | no      | none        | Filter by class, type, disposition, estate treatment, valued/unvalued.                       |
| `POST /api/v1/matters/{matterId}/assets`                     | `matterAssets:manage`         | yes     | required    | Class plus description; a valuation and interests may ride the same call.                    |
| `POST /api/v1/matters/{matterId}/assets/batch`               | `matterAssets:manage`         | yes     | required    | Bounded bulk entry; one audit row per asset, one batch.                                      |
| `GET /api/v1/matters/{matterId}/asset-schedule`              | `matterAssets:read`           | no      | none        | The grouped schedule as of a date (section 8.3).                                             |
| `GET /api/v1/matter-assets/{assetId}`                        | `matterAssets:read`           | no      | none        | Core, class attributes, interests, current valuation, encumbrances, documents, custody link. |
| `PATCH /api/v1/matter-assets/{assetId}`                      | `matterAssets:manage`         | yes     | optional    | Descriptive and class attributes; never a valuation, never the class.                        |
| `DELETE /api/v1/matter-assets/{assetId}`                     | `matterAssets:manage`         | yes     | optional    | Soft delete.                                                                                 |
| `POST /api/v1/matter-assets/{assetId}/valuations`            | `matterAssets:manage`         | yes     | required    | Appends. A correction names `correctsValuationId`. No update path exists.                    |
| `GET /api/v1/matter-assets/{assetId}/valuations`             | `matterAssets:read`           | no      | none        | The full history, newest first, corrections shown as corrections.                            |
| `POST /api/v1/matter-assets/{assetId}/interests`             | `matterAssets:manage`         | yes     | required    | Ending an interest is temporal, never a delete.                                              |
| `POST /api/v1/matter-assets/{assetId}/encumbrances`          | `matterAssets:manage`         | yes     | required    | Its balance is a valuation row naming the encumbrance.                                       |
| `POST /api/v1/matter-assets/{assetId}/documents`             | `matterAssets:manage`         | yes     | required    | Links an already-ingested `file` handle. No bytes.                                           |
| `DELETE /api/v1/matter-assets/{assetId}/documents/{id}`      | `matterAssets:manage`         | yes     | optional    | Unlink; the file is untouched.                                                               |
| `POST /api/v1/matter-assets/{assetId}/identifiers`           | `matterAssets:manage`         | yes     | required    | Writes through `protected()`; refuses a credential kind.                                     |
| `GET /api/v1/matter-assets/{assetId}/identifiers/{id}/value` | `matterAssets:read` + decrypt | yes     | none        | The one full-value read path. Audited per read.                                              |
| `GET /api/v1/matter-asset-types`                             | `matterAssets:read`           | no      | none        | The per-firm catalog, by class.                                                              |
| `POST /api/v1/matter-asset-types`                            | `matterAssets:manage`         | yes     | optional    | Add a type under a class; deactivate, never delete.                                          |

**There is no route that edits or deletes a valuation**, which is the API expression of section 5.1
— the same way Custodian has no route that sets a status directly.

Problem types, additive registry entries: `matter-asset-type-class-mismatch`,
`matter-asset-class-frozen`, `matter-asset-valuation-append-only`,
`matter-asset-currency-mismatch`, `matter-asset-credential-storage-refused`,
`matter-asset-batch-too-large`, `matter-asset-encumbrance-not-on-asset`,
`matter-asset-identifier-decrypt-forbidden`.

### 10.2 Telemetry

**Event** — `matterAssets.assetRecorded`, fields `[class, entryMode]` where `entryMode` is `single`
or `batch`. No description, no identifier, no amount.

**Counters** —

- `matterAssets.assets`, dimensions `[class, outcome]` — what firms actually log, and where writes
  fail.
- `matterAssets.valuations`, dimensions `[basis, outcome]` — whether the basis vocabulary matches
  reality, which is the evidence for ever changing it.
- `matterAssets.scheduleReads`, dimensions `[outcome]` — the read the subsystem exists to produce.
- `matterAssets.protectedIdentifierReads`, dimensions `[outcome]` — how often the one decrypt path
  is used, which is the check that it stayed exceptional.

### 10.3 Load-profile fit

Per the accretion rule, a `matterAssets` volume profile extends the harness in-area rather than
adding a bespoke benchmark. The corpus shape: a small number of assets per matter (an estate of
forty is large), each with a handful of valuations, but a long administration and a firm that keeps
matters for decades — so the valuation table grows without bound while the asset table does not, and
the risk is the as-of resolution over history, not volume.

Measured operations added to the committed baseline:

- The matter's asset list with class and disposition filters, keyset-paginated.
- **The as-of schedule read** across a matter with many assets and long valuation histories — the one
  query with a genuinely non-obvious plan, and the one to watch.
- The assembly's asset source read at the widened merge catalogue, asserted on **source count**, not
  duration, per the catalogue's rule.
- The bulk-entry batch at its maximum size.
- The interests-by-entity read across the firm ("what does this person hold an interest in"), which
  is the one read that spans matters.

The plan-scan check must show index walks, not scans, on all five.

**What must never be on the request hot path:** as-of resolution recomputed per row; any read of
document bytes; any decrypt not explicitly requested; equity computed by a second query per asset.
The only synchronous work is the paginated reads, the resolved schedule, and single-batch writes.

## 11. User-interface seams

The owner designs the interface; this spec defines only the contract behind it. Five seams:

1. **The matter's Assets section** — the register for one matter, grouped or flat, filterable by
   class, with the quick-add row at the top.
2. **Quick add and bulk add** — one row of fields (class, description, value) that commits without
   opening anything, and a paste-or-list bulk surface over the batch route.
3. **Asset detail** — attributes, the valuation timeline with basis and support, interests,
   encumbrances and equity, linked documents, and the custody link rendered by reading Custodian.
4. **The schedule** — grouped, as-of a date the user picks, with subtotals and the unvalued count,
   and the export or assemble action.
5. **Real-property lookups** — the external assessor, mapping, and listing links
   `@magna-carta/property-links` already produces from an address or a parcel number, which is why
   section 4.1 matched its field names.

## 12. Test strategy

The risk concentrates in four places and the strategy follows them.

**The append-only valuation invariant, tested at the database.** A direct `UPDATE` aborts, a direct
`DELETE` aborts, an `INSERT OR REPLACE` on an existing id aborts. Migration tests against a real
SQLite database, because the guarantee is the trigger's — a service test proves only that the
service did not try. Plus the source-scan fitness function.

**As-of resolution, as a table.** A date before the first valuation resolves to nothing. A date
exactly on a valuation resolves to it. A date between two resolves to the earlier. A corrected row
never resolves; its correction does. An encumbrance's balance resolves independently of its asset's
value. Equity nets them, per currency, and a mixed-currency schedule refuses to total rather than
approximating.

**Refusals, each with a test.** A type whose class differs from the asset's is refused. A class
change is refused. A valuation edit has no route to attempt. A credential-shaped identifier write is
refused with its own problem type. A batch over the bound is refused. An identifier read without the
decrypt permission is a named failure, never a blank, and writes no plaintext anywhere. An asset in
another firm is unreachable by construction through the firm-scoped data-access layer, asserted
anyway.

**Worker integration under the Miniflare pool.** The chokepoint contract per route (401 / 403 /
404-not-403 for a deactivated member); idempotency on every mutating route, including a retried
batch writing each asset exactly once; and the end-to-end path the subsystem exists for: open an
estate matter, bulk-add nine assets across six classes, attach a deed to the house and a statement to
the account, record a date-of-death appraisal and a later broker figure, add a mortgage and its
balance, link the jewelry to the custody item that holds it, and read a schedule as of the date of
death whose equity, groups, and unvalued count are all correct — then read it again as of today and
watch only the numbers move.

**Fixtures.** A synthetic asset corpus in the load-profile generator: non-privileged, programmatically
built, spread across all ten classes, with long valuation histories on a fraction of rows,
encumbrances on the real property, and a slice of assets linked to custody items.

## 13. Owner decisions required

Short list; each has a recommended default the plan builds to unless told otherwise.

| Flag   | Decision                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | **An asset belongs to one matter, with no cross-matter identity.** Recommended: yes. The same house in a divorce and in an estate are genuinely different records with different dates, values, and privilege; a shared row would have to reconcile them. Carry-forward is a copy with provenance, later. |
| **A2** | **A closed platform class enum with a per-firm type catalog under it**, rather than Custodian's fully firm-defined type list. Recommended: closed. The class decides which structured columns, which merge subject, and which index exist — a firm cannot mint "has a parcel number".                     |
| **A3** | **Full account and policy numbers protected, with only the last four readable** — while parcel numbers, vehicle identification numbers, and firearm serials stay plaintext and searchable. Recommended: yes; the line is public record versus credential-adjacent secret.                                 |
| **A4** | **Its own permission pair (`matterAssets:read` / `matterAssets:manage`) rather than riding the matters permissions.** Recommended: its own. A scheduling paralegal with `matters:manage` should not thereby hold the estate's asset ledger.                                                               |
| **A5** | **Firearms: record-only, with a standing non-jurisdictional handling notice and no transfer law encoded — and is a verified jurisdiction catalog wanted later at all?** Recommended: record-only now; the catalog only ever behind primary-source research, one jurisdiction at a time.                   |

## 14. Open questions

1. **The as-of query shape.** A correlated sub-select, a window function, or a maintained
   latest-valuation pointer on the asset row. The answer is the measurement in section 10.3, not a
   preference; all three are additive to the same schema and only the index set differs. This is the
   custody-subtree question of this subsystem.
2. **Whether `personalProperty` should support a lot/group grain.** "Contents of the garage" as one
   row is what a firm logs first and what an appraiser later splits into eleven. A parent/child
   relationship on the asset row would express the split without losing the original valuation; it
   also opens a tree with all the reads that implies. Deferred deliberately — the first real estate
   inventory answers whether it is needed.
3. **Whether an interest should be able to point at a matter party rather than a Directory entity
   directly.** Pointing at the entity is the precedent and survives the party link changing; pointing
   at the party link would carry the role the matter already recorded. The Directory area's call.
4. **Portal visibility.** A client asking "what does the estate own" is an obvious portal surface and
   an obvious way to show one beneficiary another's inheritance. Granularity — per matter, per asset,
   per class — should be settled before the portal grant model hardens rather than after.
5. **Whether the custody link should be bidirectionally discoverable.** Today a custody item does not
   know it is scheduled anywhere; a firm looking at a packet may reasonably want to see that the ring
   is on an estate inventory. That is a read that joins two subsystems, and whether it deserves a
   Custodian-side surface belongs to that area.
6. **A `confidential` flag on an asset**, suppressing it from exports and portal surfaces. Named and
   deliberately not built: what it suppresses is undefined until there is a consumer to suppress it
   from, and a boolean whose meaning is decided later is the kind of column the custodian design
   refused on capacity for the same reason.
