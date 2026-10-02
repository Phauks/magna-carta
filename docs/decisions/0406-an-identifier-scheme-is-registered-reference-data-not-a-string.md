---
number: 406
slug: an-identifier-scheme-is-registered-reference-data-not-a-string
status: Proposed
date: 2026-08-30
area: Directory
summary: "An identifier type stops being a bare string and becomes a registered scheme descriptor shipped as reference data in the package: a stable dotted key, whether it applies to a person or an organization, whether it requires an issuing jurisdiction, the frozen normalize transform and blind-index policy it already had, a masked-display policy so a screen can render a value's shape without a decrypt, an entry-time format and check-digit rule, and whether name-plus-this-value meets a state breach statute's definition of personal information. The database CHECK stays open at length > 0 because a committed migration is immutable and a closed enumeration would turn every catalog addition into a fleet migration; a fitness probe over stored identifier_type values closes it instead, which is what would have caught two spellings of driver's licence on the day they landed rather than as a silently missed conflicts match. The issuing jurisdiction moves out of the sealed value and into its own column, and the frozen transform still sees identical bytes so no existing blind index is invalidated."
---

**An identifier scheme is registered reference data, and the catalog is closed by a fitness function
rather than by a constraint that cannot be amended.**

**Context:** `directory_identifier.identifier_type` carries a `length(...) > 0` CHECK; the
application catalog is a seven-value union in `packages/directory/src/types.ts`; the route validates
against it with `z.enum(...)`. That combination is open at rest and closed at the edge, which is the
worst of both. `IDENTIFIER_DECLARATIONS` is a `Record` keyed on the union, so any write path that is
not the route — a data import, a bulk loader — can store `drivers_licence` beside `drivers_license`,
and the next write for that type resolves a declaration of `undefined` and fails on a property access
rather than with a named domain error. The two spellings never blind-index against each other, so the
visible symptom is not an exception at all: it is a conflicts check that silently misses a match it
was built to find.

Separately, the issuing jurisdiction of a driver's licence is encoded **inside the sealed plaintext**
by a `"STATE:VALUE"` convention. It works, and it binds the state into the index correctly, but no
screen can say "Nevada driver's licence" without a permission-gated audited decrypt, no other scheme
gets the treatment, and a caller who omits the prefix silently normalizes under the empty state with
nothing able to detect it.

**Decision:** a scheme becomes a descriptor carrying a stable dotted key
(`us.state.drivers_license`, `us.passport`, `au.business_number`), the entity kinds it applies to,
whether an issuing jurisdiction is required, the frozen normalize transform and blind-index policy it
already has — moved, not rewritten, including the explicit never-index decisions and their stated
entropy reasons — a masked-display policy, an entry-time format and check-digit rule where the scheme
defines one, and a flag for whether name-plus-this-value meets the near-universal state breach-statute
definition of personal information.

It ships **in the package**, as reference data identical for every firm, on the precedent
`@magna-carta/trust-jurisdictions` set: a correction is a package release, never a migration against
every tenant.

`directory_identifier` gains a `jurisdiction` column. The frozen driver's-licence transform composes
`"{jurisdiction}:{value}"`, and after the change that composition is performed by the write path from
the column instead of arriving inside the plaintext. **The bytes handed to the frozen transform are
identical**, so every existing blind index still matches and no backfill is required for correctness.
A row with `jurisdiction IS NULL` means the jurisdiction, if any, is inside the value, and the read
path says exactly that rather than claiming the licence has no state.

**The CHECK stays open, and a fitness probe closes it.** A committed migration is immutable, so a
closed `IN (...)` enumeration would need a new fleet migration for every catalog addition and would
reject, on a firm mid-upgrade, a value the deployed code already emits. The pattern that already
works here is `directory_edge.edge_type`: open at rest, catalogued in code, policed by a coverage
test. The probe reports any stored `identifier_type` that is not a registry key.

**Considered and rejected:** a closed database enumeration (immutable migrations make it a permanent
tax, and it fails in the wrong direction during an upgrade); a per-firm catalog table (a scheme
correction becomes a migration against every tenant, and firms would diverge on what a social security
number is); a property per scheme in the schema.org style — `taxID`, `vatID`, `duns`, `leiCode` as
columns — which is a migration per scheme forever and is precisely what one-row-per-value already
avoids; a URI as the scheme key, FHIR-style, which federating organizations need and a single shipped
catalog does not; and re-deriving the blind index from a new transform, which would invalidate every
sealed value already stored.

**Consequences:** a screen can render "Nevada driver's licence" and a masked last four with no
decrypt, no permission and no audit row. Passport, the national tax-identifier family and the business
registration numbers become available as schemes without touching the sealing, and the high-entropy
ones among them become new tier-1 exact-identifier channels in conflicts — a detection the platform
does not have today. A misspelt type is caught by a probe rather than by a conflicts miss nobody sees.
The cost is that the catalog is enforced by a test rather than by the database, which is a real
weakening at the storage boundary and is accepted because the alternative fails worse.
