# Firm Usage

Firm Usage shows what your firm holds on the platform and what it uses, as plain figures. Find it
under **Tools → Firm Usage**. It is visible to Owner and Admin seats, runs outside any matter, and
saves nothing — every number is computed at the moment you open the page, so what you see is
current. **Refresh** recomputes on the spot, and **Download Report** saves everything on the page
as a dated plain-text file you can keep or paste into an email.

## Storage

How much the firm's documents occupy, split by storage class. **Standard** holds what is in active
use; **Infrequent Access** holds what the platform has tiered down because nobody has touched it in
a long while — it costs less to keep. The totals row is the whole of the firm's document storage,
reconciled nightly against the underlying store.

## Matters by Type

One row per matter type in your firm's own catalog, with prospective, open, and closed counts. A
matter that carries no type appears under **No Type Assigned** — the rollup never drops a matter for
being untyped. Create a new matter type and it appears here as a row the same day.

## Files and Versioning

- **Current Files** — files with a live version, and the space those versions occupy.
- **Prior Versions** — superseded versions kept for history.
- **All Versions** — the two above together.
- **Deleted Files** — files that have been deleted but are still held until the retention sweep
  runs, and the space they still occupy.

Generated working copies (previews, extracted text) count toward Storage above but are not files,
so the two sections measure different things on purpose.

## By Location

One row per office or file room, with its matter and staff counts. Click any column heading to
sort. A matter that names no location is counted on the **No Location Assigned** row. **Custodian
Items** is reserved: physical holdings tracked in Custodian will report here when that rollup is
connected.

## People and Organizations

How many distinct people and organizations the firm's Directory holds, and how many staff members
can sign in. A person who appears on several matters counts once, and merged duplicate records are
not double-counted.

## AI Usage

Every AI meter the platform keeps for your firm, one figure per row: Magnus tokens in and out,
request counts, search queries by kind, and AI detection volume. **Managed Search Storage** reads
"Not yet measured" because the search provider publishes no per-firm storage figure — the row is
there so the gap is visible rather than pretending to be zero.

## Compute and Activity

Request volume, compute time, and data egress are not measured per firm yet; the section shows what
will report there once the platform's analytics credential is connected.
