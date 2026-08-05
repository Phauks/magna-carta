---
slug: matter-asset-register
status: Proposed
area: Core domain / Matter assets
date: 2026-08-05
summary: "A matter-attached asset register: an asset row is ONE MATTER'S ASSERTION about one thing the client or estate owns, so it roots at the matter (NOT NULL) where Custodian roots at the Directory entity — the same house in a divorce and in an estate are different records with different dates, values, and privilege, and no cross-matter thing-identity exists. Typing is three layers with one job each: a CLOSED platform class enum (real property, financial account, vehicle, firearm, business interest, insurance policy, receivable, digital asset, personal property, other) because the class decides which structured columns, which merge subject, and which index exist; a per-firm type catalog UNDER a class following the shipped custody-item-type shape; and the custom-fields engine widened by one target value for the firm's own facts. Structured attributes live in one one-to-one table per class that has structure, and none for a class that does not. Every number is dated: valuations are an APPEND-ONLY history with a basis, corrected by compensating rows and enforced by RAISE(ABORT) triggers, with no current-value column anywhere — an encumbrance's balance is a valuation row naming the encumbrance, so net equity as of any date is one read. Identifiers split on a principled line: public-record ones (parcel number, vehicle identification number, firearm serial) are plaintext and searchable, credential-adjacent ones (account, policy, certificate, tax) are ciphertext through protected() with only the last four readable and no merge facet at all — and credentials themselves (seed phrases, private keys, combinations) are REFUSED outright in any column, because a protected column is decryptable and a seed phrase IS the asset. Firearms are recorded like cars and carry no transfer law: a standing non-jurisdictional handling notice, a regulated-category field that is asserted and never derived, and a jurisdiction catalog that stays empty until primary-source research fills it. Documents are a many-to-many link over ordinary matter files (no holding matter needed, unlike custody scans); a custody item link joins the two registers without either copying the other's facts. Asset classes enter the merge catalogue as ELEVEN COLLECTION-ONLY subjects riding ONE new source, because a scalar slot on a matter with two houses would be an absence every time. Permissions are matterAssets:read / matterAssets:manage bound to the matter."
---

**The asset register is matter-rooted, class-typed, and dated — every number carries the date it was
asserted as of, and nothing about ownership or transfer is inferred.**

**Context:** The owner asked, twice in one sitting on 2026-08-05: _"I would love a dedicated way to
add assets to any case (such as properties, with putting in address, apn, and the like, which you
can associate documents with)"_ and _"for assets, we can also show bank accounts, cars, guns, and so
many other items. this will be useful for keeping items together and make estates and asset logging
super easy."_ Every input exists: the Directory carries the people who hold interests, the File
Manager carries documents behind a quarantine gate, Custodian shipped the register idioms and the
distinction this depends on (it holds the deed; something else has to describe the house), and the
merge-field catalog design established the subject-and-facet shape while leaving the estate record
with no asset list to point at. The property-data research note already opens with date-of-death
valuation of real property as the driver for an integration port that has no domain record to write
into.

**Decision:**

1. **An asset row is one matter's assertion about one thing owned, and `matter_id` is NOT NULL.**
   This is the deliberate inverse of Custodian's Directory anchor, and each is right for its own
   failure mode: an unattributable custody envelope can never be released or destroyed, so the owner
   link there is structural; here the same house is genuinely a different record in a divorce and in
   an estate — different valuation dates, different encumbrances, different disposition, different
   privilege — and a shared row would have to reconcile them, which is a way to leak one matter's
   numbers into another. Carrying an asset forward from a prior matter is a copy with recorded
   provenance, later, never a shared row.

2. **Three typing layers, each with one job.** A **closed platform class enum**, because the class
   decides which structured attributes exist, which merge subject the row appears under, and which
   column a search hits — a firm cannot mint the concept "has a parcel number", and adding a class
   really does imply a migration, an index, a merge facet, and a report column. A **per-firm type
   catalog under a class** (the shipped `custody_item_type` shape: seeded, extended, soft-deactivated,
   never deleted) is where "so many other items" lives without schema work, with the invariant that a
   type must belong to its asset's class. And the **custom-fields engine widened by one target value**
   for the firm's own facts, scoped per class through the column the engine already has. The line
   between the last two: a kind of thing is a type, a fact about a thing is a field. The class is
   frozen at creation; a mis-classed row is deleted and re-added.

3. **Structured attributes are one one-to-one table per class that has structure, and none for a
   class that does not.** A wide nullable table makes every check conditional and lets a vehicle
   carry a parcel number; a generic attribute bag re-implements custom fields and turns "find the car
   with this identification number" into a scan over strings. Real-property column names mirror
   `PropertyReference` in `@magna-carta/property-links` exactly, so a scheduled property renders
   assessor, mapping, and listing lookups today with no new code — and so a parcel adapter later
   fills columns that already exist.

4. **Every number is dated; there is no current-value column.** Valuations are an append-only history
   carrying `as_of_date`, amount in minor units, a closed `basis` vocabulary, an optional supporting
   file, and a compensating-correction path — enforced by the `RAISE(ABORT)` trigger idiom the
   custody movement ledger already uses, plus the append-only source scan. An estate needs the
   date-of-death value and today's value; a family-law matter needs date-of-marriage and
   date-of-separation values for the same house; one mutable number cannot answer two of those, and
   an editable one lets the register and a filed schedule silently disagree. Three rules travel with
   it: a date before an asset's first valuation resolves to **nothing** rather than extrapolating
   backwards, every read that returns an amount returns its date and basis, and the as-of date itself
   is not this subsystem's fact (the estate record owns the date of death). An encumbrance's balance
   is a valuation row naming the encumbrance, so one table, one trigger set, one query shape, and net
   equity as of any date is one read with a sign flip. Equity is computed, never stored; nothing sums
   across currencies. Valuations are not `protected()`, on the ratified reasoning that a business
   number about an object is not an identifier about a person.

5. **Identifiers split on public record versus credential-adjacent secret — and credentials are
   refused entirely.** Parcel numbers, vehicle identification numbers, plate numbers, firearm serial
   numbers, legal descriptions, and recording references are plaintext and indexed, because they
   appear on public records and searching by them is the point. Account, policy, certificate, and tax
   identifiers are stored as ciphertext through the `protected()` chokepoint with only a four-character
   suffix readable, the full value has exactly one audited read path, and it is never a merge facet —
   a merge field that decrypts a number into an assembled document makes the secret the file's
   problem and the audit row cannot say where the value went. Passwords, passphrases, seed and
   recovery phrases, private keys, personal identification numbers, and safe combinations have **no
   column at all**, protected or otherwise: a protected column is decryptable by any holder of the
   decrypt permission, and for a self-custodied digital asset the seed phrase *is* the asset, so
   storing it converts a records system into a bearer instrument. The documented answer is a sealed
   envelope in the custody register, which is what that subsystem is for.

6. **Firearms are recorded like cars, and no transfer law is encoded.** Make, model, calibre or
   gauge, serial number, value history, documents, interests — a records capability carrying no more
   legal weight than the same facts on a legal pad. The register does not determine who may receive a
   firearm, whether a dealer is required, whether an item is federally regulated, or what any deadline
   is; those vary by item, by recipient, and by jurisdiction, and a rule that is ninety percent right
   is worse than none because it will be trusted. `regulated_category` is free text a person asserts,
   with nothing branching on it. A class registry carries an optional short, non-jurisdictional
   `handling_note` — for firearms, that transfers are regulated by federal and state law and this
   register records what is held rather than who may receive it — naming no statute, no deadline, and
   no jurisdiction, so it cannot go stale. A verified jurisdiction catalog remains a named empty seam
   on the trust-rules pattern, gated on primary-source research the way the Nevada will-custody work
   was.

7. **Relations reuse the shipped links and duplicate nothing.** Interests point at Directory entities
   with no cross-domain foreign key (the `matter_party` precedent), carry a firm-configurable role
   label (the ratified custody ownership-label answer, for the same reason — tenancy forms are
   jurisdiction-specific and no engine consumes them), and express a fractional share as a
   numerator/denominator rational, because three siblings whose shares sum to 99.99 percent on a court
   filing is a defect the schema should make impossible. Documents are a **many-to-many** link over
   ordinary matter files — diverging from `custody_scan`'s unique index because one statement lists
   four accounts — and because an asset always has a matter, the custody holding-matter machinery is
   neither needed nor used. One nullable `custody_item_id` joins the two registers: Custodian owns
   where the object is and every hand it passed through, the register owns what it is worth and who
   holds an interest, and the apparent duplicate (a custody declared value versus a valuation) is two
   different questions — replacement value for a thing in a safe, fair market value as of a date for
   an estate — that nothing syncs. Trust is a seam only: a sale is a disposition plus a `sale`-basis
   valuation, and no code path here posts a ledger entry or derives a balance.

8. **Asset classes enter the merge catalogue as collection-only subjects riding one source.** Eleven
   subjects of a new `assetClass` kind (ten classes plus an aggregate), each declaring `.all` with
   per-class `itemFields` and **no scalar facets** — a matter with two houses would make every scalar
   an absence naming the count, which is the ambiguity rule producing a technically correct answer
   that is useless every time, so the slot is not created. One new assembly source answers all eleven,
   preserving the catalogue's property that a subject costs nothing and only a source costs a read.
   `value` and `valueAsOf` are declared together and neither exists without the other; totals are
   expression aggregates, not keys.

9. **`matterAssets:read` / `matterAssets:manage`, bound to the matter.** Not riding
   `matters:manage` — the register concentrates what the estate owns, what it is worth, account
   suffixes, serial numbers, and home addresses in one surface, and a firm granting a scheduling
   paralegal matter management has not decided to grant them the asset ledger. Not four keys — the
   third gate a finer split reaches for is the decrypt permission, which already exists. The namespace
   is `matterAssets` rather than the bare word because that word already means Workers Static Assets
   and the deliberately excluded firm-property register.

**Consequence:** The register is buildable in four slices against inputs that all exist. Slice 4·3·1
ships the spine with real property and financial accounts; 4·3·2 adds every other class,
encumbrances, and the grouped schedule; 4·3·3 makes it a document-automation input and links it to
Custodian; 4·3·4 carries assets forward between matters and opens the parcel and valuation ports the
property-data research already scoped. The refusals are the load-bearing part: no transfer law, no
inferred probate inclusion, no derived value, no completeness gate, no credential storage, and no
court form for any jurisdiction. Five owner flags remain open (matter-rooting, the closed class enum,
the protected-identifier line, the permission pair, and the firearms posture); the plan builds to the
recommended default of each unless told otherwise.
