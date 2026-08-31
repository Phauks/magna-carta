# The download register — a shelf for what the platform made you

**Status:** accepted (owner-directed, 2026-08-31)

## The ruling this rests on

The owner's direction, verbatim in substance: _a download center, so that users can see what has
been created and downloaded, or be ready to download again_ — and, deciding against routing
completions through the alerts feed, _notifications relate to matter work, not downloads_.

That second sentence is the load-bearing one and it generalizes past this surface. The notification
feed carries what happened to the firm's **work** — a deadline moved, a document was checked out, a
conflict was hit. A file the platform generated for you is **platform mechanics**, not a fact about
a matter, and putting it in the feed would dilute the one surface a member has to trust for the
firm's own business. The two never merge, and a producer that wants to tell a member its artifact is
ready does it by putting a row on the shelf, never by raising a notification.

(The ruling belongs in `docs/conventions/design-corrections.md`. It is recorded here instead because
`claude/focused-cori-b8z77b` has asked concurrent streams to stay out of the ruling ledger until it
lands; it should be lifted across afterwards.)

## What this is, and what it deliberately is not

**A shelf, not a history.** Every row is held for a short retention window and then swept. The owner
set that shape directly: _we could have the downloads retained for short periods of time anyways_.
So the register answers "what did the platform make me lately, and can I have it again" — it does
not answer "what have I ever downloaded", which is an audit question the `audit_log` already records
and which a different surface with a different permission would serve.

**Not a transfer manager.** `docs/conventions/network-resilience.md` rule 1 puts every large download
on a presigned GET so the browser's own download manager owns pause, resume and speed, and rule 2
forbids regressing that by proxying bytes through the client. The register hands out links; it never
moves bytes itself and shows no progress bar for a transfer the browser owns.

**Not the file room.** A row here is a disposable convenience under an expiry. Filing an export into
a matter — where it becomes a document the matter team can see and the record keeps — remains a
separate, audited act that this slice does not build.

## The two kinds of row, and why one table holds both

A member's shelf mixes two genuinely different things, and collapsing them would make one of them
lie.

**A kept artifact** is bytes the platform built that cannot be re-derived: a bulk-download bundle
(`bundles/<contentHash>.zip`) or a conversion result
(`conversions/<firmId>/<jobId>/result`). They are the firm's own files, assembled or transcoded, and
they exist in R2 already. The row POINTS at the object; "download again" mints a fresh short-TTL
presigned GET, and when the object has been swept the row says `expired` rather than handing over a
dead link. Nothing about the existing producers' storage changes.

**A kept snapshot** is an export: the tabular document a screen built from what it was showing. Here
the row stores the **document, not the file**, because this platform already decided that an export
IS a document and formats are renderers — the same `RenderableTabularDocument` the composer takes.
Storing the recipe rather than five rendered binaries is smaller, keeps every format available from
one row (the browser re-renders text, CSV and Excel; the platform re-renders Word and PDF through
`POST /api/v1/reports/exports`), and makes the row honest about what it is: a snapshot of figures
frozen at an instant, not a file that happens to exist. The figures cannot drift, because the
document is stored rather than recomputed.

One table, discriminated on `kind`. The reason they share it: the member's question is "what did the
platform make me", asked once, answered in one list, sorted by one clock. Two tables would be two
lists to merge in the reader's head.

## Where it lives

A **sidebar destination at `/downloads`**, on the `/notifications` precedent — a place you navigate
to, because the whole point is coming back to it later.

Not new top-bar chrome. The actions cluster already carries the version chip, the bell, the timer
chip and the profile menu with `+New` holding reserved geometry; a fifth control spends a budget the
shell is keeping, and a tray icon in the chrome reads as a transfer manager, which this must never
be. Two concurrent streams also hold claims over the shell composition. An ambient in-flight
indicator is a later, separable decision.

Not a Tools entry: every tool manifest is stateless and the Tools screen defines itself as running
outside any matter, whereas this is per-member and stateful.

## The record

A per-firm table, per-member, hand-written migration with its journal entry and its
`role_permission` seed in the same commit.

Columns carry: the owning member, `kind` (`artifact` | `snapshot`), a display title, the producer
(`bundle` | `conversion` | `export`), the R2 key for an artifact or the stored document's key for a
snapshot, the byte size where one is known, the formats already taken, `created_at`, `expires_at`,
and the state. The formats-taken list is what answers "what has been downloaded" — a member seeing
they already took the Word copy is the difference between the shelf being useful and being a pile.

Scope is the **member**, not the firm: a colleague's exports are not the reader's business, and a
firm-wide view is a separate administrative question. A bundle is content-addressed and shared
between two members who asked for the same selection; the artifact is shared, the rows are not.

## Retention

One constant, swept on the existing daily per-firm cron pass, aligned with the `bundles/` lifecycle
rule already live at seven days. A row whose artifact R2 has already reaped reports `expired` before
the sweep reaches it, so the two need not be in lockstep — but the register must never be the reason
an object outlives its prefix's rule.

A snapshot's stored document is the register's own object and is swept with its row.

## Bounds and non-goals

- No transfer UI, no progress bar for a download the browser owns.
- No filing to a matter; that stays a separate audited act.
- No firm-wide or administrative view in this slice.
- No new top-level path family (`/api/v1/downloads/*` already routes worker-first).
- The artifact kind is BUILT — the table carries it, the shelf reads it, the fetch route mints a
  presigned GET for it, and `artifactShelfStatement` is the producers' one-line write — but the bulk
  download and conversion producers are NOT wired to it in this slice. Neither has a client that can
  create one (`bundleDownloadRequest` is dead code; there is no converter screen), so wiring them now
  would put rows on a shelf nobody can reach and would be untestable end to end. Each wires in with
  the surface that finally creates it: the route writes the row `building` when it enqueues, and the
  consumer flips every row pointing at that object key to `ready` when the bytes land — one flip for
  all of them, because a content-addressed bundle is genuinely shared between the members who asked
  for the same selection.

## Tests

Data access: the member scope holds (one member's list never carries another's row), the formats-taken
list accumulates rather than replaces, the sweep selects only past-expiry rows. Routes: the shelf
lists only the session member's rows, a re-download of a reaped artifact answers `expired` rather
than a broken link, a snapshot re-renders to the same bytes the original render produced (the
composer is byte-reproducible, so this is assertable), and the permission gate refuses a member
without the key. Screen: an honest empty state, and the expiry stated rather than implied.
