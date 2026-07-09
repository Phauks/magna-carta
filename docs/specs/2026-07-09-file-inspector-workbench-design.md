# File Inspector — the file workbench

**Date:** 2026-07-09 · **Status:** design agreed in substance; **the visual design is still in development**

Seven tools in the `files` subject group each demand their own upload of the same bytes: convert, scrub
metadata, hash, unlock, verify type, detect AI text, repair. The user's question is never "which of seven
tools do I need." It is "I have a file — what can I do with it, and what is it?"

This is the workbench that answers that. One surface, one upload, many capabilities.

It resumes the tools-workbench thread deferred on 2026-07-03 (capability registry with a `kind` axis;
tiles that recede when they do not apply) and settles the question that thread left open: what happens to
the bytes.

**The visuals are not settled.** Two mockups exist (`file-inspector-mockup.html`,
`file-inspector-mockup-2.html`, served locally, not part of the app). They establish the shape, not the
finish. Everything below about layout is a starting position, explicitly open to change.

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

## Capabilities are not peers

Flattening every tool into an equal verb in a row is the one thing that would do real harm here.

| Class | Capabilities | Treatment |
| --- | --- | --- |
| Cheap, in-house, reversible | Type, Hash, **Malware Scan**, Metadata inspect | Run automatically on arrival |
| In-house, produces a new artifact | Convert, Repair, Metadata scrub | One click; result is a new object, the original is untouched |
| **Discloses content outside the firm** | AI Text (sends text to Pangram, billed per document) | **Explicit consent, per file. Never in bulk.** |
| **Spends real compute, needs a secret** | Unlock (password, GPU) | **Explicit consent, per file. Never in bulk.** |

Consent for AI Text and Unlock is required. The disclosure sits at the point of action, not in a
preference read once.

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

The current thinking, drawn but not settled:

- File **selection** is navigation, not content. It wants to be scannable and out of the way, and to scale
  from four files to sixty. A narrow rail (thumbnail, name, scan dot, checkbox) rather than a pane. With a
  single file it collapses entirely.
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

## Two entrypoints, and only one of them may have a history

**From the tools area** (today): an ad-hoc upload. No matter, no filing, nothing retained past the session.
Giving *this* a history would mean retaining information about files the firm never filed — exactly what
the ethereal principle forbids.

**From a file inside a matter** (later): the document already has an identity, a version, a scan verdict,
and an audit trail. Inspecting it needs no upload at all, and **a history of inspections is legitimate**,
because it hangs off a record that already exists.

These are two features wearing one name. The spec says so deliberately, because the difference is a
confidentiality boundary and not an implementation detail.

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
