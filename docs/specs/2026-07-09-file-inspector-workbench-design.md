# The file surface — one headerless file manager, many hosts

**Date:** 2026-07-09 · **Status:** design agreed in substance; **the visual design is still in development**

Seven tools in the `files` subject group each demand their own upload of the same bytes: convert, scrub
metadata, hash, unlock, verify type, detect AI text, repair. The user's question is never "which of seven
tools do I need." It is "I have a file — what can I do with it, and what is it?"

The first draft of this spec answered that with a standalone tool, the "File Inspector." That was too
small a frame. The same question — *what is this file, and what can I do with it* — is asked of a file
**inside a matter** just as often as of an ad-hoc upload in the Tools area. Answering it twice, in two
screens, would be building the same thing twice and letting the two drift.

So the design is inverted: there is **one file-management surface**, and the inspector is not a screen
beside it — **it is the detail view of it.** Select a file in the collection and its capabilities populate
the detail region. That surface is **headerless**: it renders no masthead of its own and makes no
assumption about where its files come from or whether they persist. Its host supplies those. The Tools-area
"File Inspector" is simply the **first host** of that surface; a file inside a matter is another.

It resumes the tools-workbench thread deferred on 2026-07-03 (capability registry with a `kind` axis;
tiles that recede when they do not apply) and settles the question that thread left open: what happens to
the bytes.

**The visuals are not settled.** Two mockups exist (`file-inspector-mockup.html`,
`file-inspector-mockup-2.html`, served locally, not part of the app). They establish the shape, not the
finish. Everything below about layout is a starting position, explicitly open to change.

## One surface, two axes of "view", N hosts

Two different things get called a "view," and the design only holds if they stay distinct:

- **Collection views** — how you look at *many* files: List, Tiles, Gallery. This is the shared multi-view
  shell already built ("duplicated three times, full stop"). Under this design it is not duplicated — it is
  **one body instanced per host.**
- **Capability views** — what you look at for *one* file: Overview, Hash, Type, Metadata, Scan, Convert,
  Unlock. This is the inspector's tab strip, now the surface's **detail pane.**

The body is therefore: a **collection region** (multi-view) + a **detail region** (the capability tabs).
It renders no chrome above itself. It depends on a **`FileSource`**, never on a `matterId`.

**Why `FileSource` and not `matterId` — the seam is real, not cosmetic.** The file-manager data plane
(`packages/file-manager/src/queries.ts`) is matter-scoped by identity: `listFiles` *requires* a `matterId`,
and the whole `file` / `file_version` / `folder` model presupposes a matter as the container, with durable
rows, versions, folders, scan verdicts, and an audit trail. The Tools-area upload has none of that — it is
an ephemeral scratch object reaped in hours (see byte disciplines below). The difference between the two is
**not the header. It is the data source and the lifecycle.** The body must not know which it is.

| | **Matter host** (later) | **Tools host** (first build) |
| --- | --- | --- |
| Source | durable `file` records — `listFiles(matterId)` | ephemeral scratch-object list, session-scoped |
| Collection | folders, versions, search over thousands | a handful of dropped files, no folders |
| Capabilities | inspection **+ Versions + History** | inspection only |
| Chrome | matter masthead / breadcrumb | "Tools" eyebrow / "File Inspector" masthead |
| Lifecycle | filed, permanent, audited | reaped on the hours schedule |
| History of inspections | **legitimate** (hangs off a filed record) | **forbidden** (see the ethereal principle) |

The Tools host is the **degenerate case** — few files, no folders, no history — which is why it is the
first build: it exercises the body without the matter machinery. The matter host is the general case and
reuses the body wholesale, switching on the capabilities the Tools host leaves off.

## Decided

- **Upload on arrival.** A file dropped here is uploaded immediately. If a user brings a file to the
  inspector they want it inspected; making them click twice buys nothing.
- **Multiple files at once**, because bulk conversion is a real need.
- **Two columns**: the document on one side, what we know about it on the other. Selection lives with the
  document.
- **The report of a lookup is evidence.** (Established for WHOIS; the same instinct governs here —
  a workbench that says what a scrub changed must be able to prove it.)

## The three byte disciplines that already exist, and why they force a scratch object

The tools do not agree on how bytes work today:

| Discipline | Tools | Shape |
| --- | --- | --- |
| Stream through, store nothing | `file-integrity` (hash), `file-type` | Raw request body, single pass. Their own descriptions say *"Nothing is stored."* |
| Whole file as base64 in JSON | `metadata.inspect`, `metadata.scrub` | 33% inflation, held in memory both ends, `rateLimit: "expensive"` |
| Store in R2, async job, reaped | `conversions` (`conversions/<firmId>/<jobId>/{source,result}`), `file-repair`, `decryption`, `ai-detection` | Presigned URLs, 300s TTL, an R2 lifecycle rule expires the object |

A browser stream cannot be replayed to four server capabilities. The base64 path cannot carry a 180MB
deposition. Convert, repair and unlock are asynchronous jobs needing durable bytes. **The lowest common
denominator is an object at rest**, so the workbench uploads once into a firm-scoped scratch object and
every capability addresses that key.

This is not a new exposure. `conversions/<firmId>/<jobId>/source` already does exactly this. What changes
is that four independent uploads with four independent lifetimes and no correlation become **one object,
one lifetime, one hash, one audit trail.** Re-uploading per capability would push the same privileged
bytes across the network four times, which is worse, not better.

### Retention

The `bundles/` prefix is retained ~7 days by a native R2 lifecycle rule. **That duration does not
transfer.** A bundle is an artifact the user asked to build and needs time to download. A workbench
scratch object is an unfiled upload with no matter, no document type, and no owner beyond a session.

Retention is measured in **hours**: the session plus a short grace. The surface states what is held and
until when, and offers a Discard that deletes now. Enforced by **both** a lifecycle rule on the scratch
prefix and a cron reaper — belt and braces, because see the defect below.

**The hours rule holds only because nothing here waits days. One capability would break it — and it does
not belong in the workbench.** See "Decryption splits in two", below.

## Capabilities are not peers

Flattening every tool into an equal verb in a row is the one thing that would do real harm here.

| Class | Capabilities | Treatment |
| --- | --- | --- |
| Cheap, in-house, reversible | Type, Hash, **Malware Scan**, Metadata inspect | Run automatically on arrival |
| In-house, produces a new artifact | Convert, Repair, Metadata scrub | One click; result is a new object, the original is untouched |
| **Discloses content outside the firm** | AI Text (sends text to Pangram, billed per document) | **Explicit consent, per file. Never in bulk.** |
| **Decrypt with a known password** | Unlock | **Explicit consent, per file.** Fast — reads the scratch object, produces a decrypted result within the session. |
| **Recover an unknown password** | Password recovery | **Not a workbench capability — it hands off.** See below. |

Consent for AI Text and Unlock is required. The disclosure sits at the point of action, not in a
preference read once.

## Decryption splits in two

The backend already draws this line, and the first draft of this spec wrongly flattened it into one
"Unlock" tab. There are two distinct operations, and only one fits a workbench:

- **Decrypt with a known password.** The user has the password. The result is produced in milliseconds.
  This is a workbench capability: it reads the scratch object, decrypts, done. Fine within the hours-long
  session.
- **Recover an unknown password.** A crack. `decryption.recover` mints a job, fans the search across the
  `RecoveryJobCoordinator` Durable Object, and the client polls; it runs on a GPU-cost tier ladder and
  **can take days.** This cannot live in the workbench: the workbench holds bytes for hours and reaps
  them, but a multi-day job would either force the scratch object to persist past its lifetime — breaking
  the ephemeral rule — or outlive its own input.

The backend already resolved exactly this tension: `decryption.recover` **takes the extracted hashcat hash,
not the file bytes**, and identifies the target by digest so it never retains content. The workbench does
the same. "Recover the password" is therefore **not a tab that runs inside the workbench** — it is a
**handoff**: extract the hash from the scratch object, start the recovery job, and route the user to a
dedicated recovery screen. The workbench never waits on it, and the scratch object is reaped on the normal
hours schedule while the job — carrying only the digest — continues on its own.

### The dedicated recovery screen (its own surface, later)

A recovery job needs a home a workbench file cannot be: it is addressed by `jobId`, survives reload, shows
the tier ladder, progress, cost, and teardown, and drives the poll loop. Because a recovery job is a
durable, auditable thing (`decryption.recover_started` writes a chain-of-custody row — who started it,
against which file by digest, never the password), **it is exactly the entrypoint that legitimately has a
history**, unlike an ad-hoc inspection. This screen is out of scope for the first workbench build; the
handoff seam is what the workbench provides, and it launches into a surface the recovery tool already owns.

### Malware scan gates everything else

`POST /api/v1/scan/diagnose` exists — permission `firm:scanFile`, raw bytes, a firm-configurable size cap,
`audited: true` precisely because it stores nothing, so the audit row is the only record the scan
happened. A `malware-scan` tool now exists in the catalog against that permission.

The workbench is an untrusted-file surface by definition. Every arriving file is scanned. **A flagged file
is excluded from every subsequent capability and from every bulk action.** Its bytes are not converted,
scrubbed, previewed, or handed to a third party.

### The hash is the object's identity

Hash on arrival; hash again after any transform. That is what lets the workbench *state* what a scrub
removed or a repair changed, rather than assert it. It is also what makes an exhibit possible.

A digest computed in the browser is feedback, not evidence. If a digest goes into a record, the server
computes it over the bytes it received. Never let the fast one masquerade as the authoritative one.

## The preview is a sandbox problem, not a layout problem

These are untrusted files. Rendering one in the application's own origin is precisely the attack that
safe-delivery exists to prevent. The preview goes through `PreviewGrant` and the cookieless `FILES_ORIGIN`
host, never a blob URL in this origin. `PreviewGrant` already returns `download-only` with a reason when
it cannot render safely, and the workbench must honour that rather than route around it.

Consequence: many files have **no** preview — an archive, an encrypted document, an executable. Reserving
dead space for one is worse than not offering it. When there is nothing to show, the analysis takes the
full width and the surface says *why* there is no preview.

## Absence is typed, never blank

The same discipline the WHOIS report needs, for the same reason. Three different silences:

- **Not run** — the capability has not been invoked.
- **Not applicable** — the document is not encrypted, so Unlock has nothing to do.
- **Withheld** — the file was flagged, so the capability will not run on it.

A blank cell says none of these.

## Layout — a starting position, still in development

The body is a **collection region** + a **detail region**; the notes below are how each might look in the
Tools host. The same two regions serve the matter host — the collection region there is denser (folders,
versions, thousands of files) and the detail region gains the History and Versions tabs, but the split is
the same. Drawn but not settled:

- The **collection region** is navigation, not content. It wants to be scannable and out of the way, and to
  scale from four files to sixty (and, in the matter host, to thousands). In the Tools host: a narrow rail
  (thumbnail, name, scan dot, checkbox) rather than a pane. With a single file it collapses entirely.
- **Preview** is the subject and takes the larger share. Target: never shorter than roughly 60% of viewport
  height when it is showing.
- **Analysis** is dense but bounded — eight rows for Overview, a long table for Metadata.
- The split ratio follows the **capability**, not a constant: preview-led when the question is *what is
  this* (Overview, Type, Hash, Scan); analysis-led when the answer is a table (Metadata, Convert).
  Draggable via the existing `Resizable` component, remembered via the persisted-preference primitive.
- Capability navigation follows the matter section-nav pattern: a horizontal strip beneath the masthead,
  with capabilities that do not apply receding rather than disappearing.

**Open on visuals:** whether the file rail reads as a third navigation surface next to the app sidebar and
the capability tabs — three levels may be one too many. A horizontal chip strip avoids that but caps out
around eight files.

Selection semantics: focusing one file shows its details; checking several offers the bulk actions that
apply to all of them, minus any that are flagged, minus the two that require per-file consent.

## The confidentiality boundary lives in the host, not in two screens

The earlier draft called these "two features wearing one name" and warned the difference was a
confidentiality boundary, not an implementation detail. That was right about the boundary and wrong about
the remedy. The remedy is not two screens — it is **one body whose host supplies the boundary.**

**From the tools area** (first build): an ad-hoc upload. No matter, no filing, nothing retained past the
session. Giving *this* a history would mean retaining information about files the firm never filed — exactly
what the ethereal principle forbids. The Tools host therefore wires in **no history source and no version
source.** History is absent *by construction*, not by a screen remembering to omit it.

**From a file inside a matter** (later): the document already has an identity, a version, a scan verdict,
and an audit trail. Inspecting it needs no upload at all, and **a history of inspections is legitimate**,
because it hangs off a record that already exists. The matter host wires those capabilities *in.*

This is the whole payoff of the headerless model: the two hosts behave **identically** for everything that
is not the confidentiality-differentiated part — same collection views, same capability tabs, same typed
absence, same preview sandbox — and they differ **only** where they must, at the `FileSource` and the
capability set the host hands the body. A guarantee, where the old framing had a discipline.

## Defects and corrections found while writing this

- **`ai-text-detection` does not accept a file.** Its route takes `{ text: string }` — pasted text. To run
  it against a document, something must extract the text first: another capability, another disclosure
  decision, possibly a different tool. **The AI Text tab as drawn in the mockups is wrong.** Resolve
  before building.
- **`metadata`'s base64-in-JSON path is a workbench blocker.** It must move to the scratch-key model.
- **No R2 lifecycle rule is declared in `wrangler.jsonc`** for `bundles/` or `conversions/`, though code
  comments depend on one existing. Like the R2 CORS configuration, it may be an out-of-band dashboard
  setting — or absent, in which case artifacts are accumulating. **Verify before relying on it.**
- **`contextTags` was wrong** for `file-converter` and `metadata-scrubber` (both declared `["none"]` while
  plainly accepting a file). Fixed. A workbench filtering on that tag would have silently dropped them.
- `file-decryption` carries `["file"]` where its siblings carry `["file","none"]`. Possibly deliberate.
  Worth a consistency pass.

## Not in scope

No caching. No history for the ad-hoc entrypoint. No matter attachment — pulling a file into a matter
remains a deliberate, separate act. The Tools area stays ethereal.
