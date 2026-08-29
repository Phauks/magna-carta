# The PDF scrub does not remove active content

**Status:** analysis; the posture is the owner's call. Nothing has been built.

## What is true today

`sanitize_document` in [`crates/pdf-core/src/scrub.rs`](../../crates/pdf-core/src/scrub.rs) removes
`Info`, `Metadata`, `StructTreeRoot`, `MarkInfo`, `Outlines`, `Names/Dests`, `OCProperties`, form
field `V`/`DV`/`AP`, `XFA`, `Names/EmbeddedFiles`, `Collection`, and `AF` on the catalog and every
page.

It removes none of:

| Entry               | What it does                                                                      |
| ------------------- | --------------------------------------------------------------------------------- |
| `/Names/JavaScript` | Document-level scripts, available to everything else in the file.                 |
| `/OpenAction`       | Runs when the document is opened.                                                 |
| `/AA`               | Additional actions on pages and fields — fire on open, close, focus, blur, print. |

Verified against `main` at `8f3c4ec`. Nothing else in the crate removes them either.

**One near-miss worth stating so nobody mistakes it for coverage.** `generate.rs::split` does drop
`OpenAction`, `AA` and `Names` — but as page-subsetting fallout, not protection. Its own comment
gives the reason: a subset cannot preserve document-level entries, and leaving one in resurrects a
dropped page. Any PDF that does not pass through `split` keeps everything.

## Why it matters more than it did

[`apps/api-worker/src/assemblies/pdf-form-engine.ts`](../../apps/api-worker/src/assemblies/pdf-form-engine.ts)
calls this scrub as `scrubFormTemplate` — the fillable-PDF template path. A firm registers a form it
obtained elsewhere, the platform fills it, and the result is filed and sent under that firm's name.
An `OpenAction` script surviving that round trip executes in the recipient's reader. The platform
would be laundering active content into a document bearing the firm's name and addressed to its
client.

That module's own comment lists what the scrub takes out — metadata, attachments, the XFA dataset,
prior field entries, the structure tree, bookmarks, optional content. Scripts are not in the list,
and they are not in the code. The comment is accurate; the coverage is the gap.

The same scrub sits on every other PDF path already shipped: conversions, assembled output, e-sign
sealed documents, discovery review-set originals.

## The compensating control does not compensate

The malware scanner's PDF heuristics
([`containers/scan/src/heuristics/pdf.rs`](../../containers/scan/src/heuristics/pdf.rs)) **do**
detect this: they flag `/OpenAction`, `/AA`, `/JavaScript` and `/JS`, including inside object
streams. So a template carrying a script is seen.

It is seen and then admitted. The owner's standing ruling is that **nothing is ever blocked** — a
flag is a note, never a gate, and users always reach their files. That ruling is right for a file a
person uploads to their own matter, and it is the reason the scan cannot serve as the control here.
A template is not a file sitting in a folder: it is an input the platform _executes over_ to
manufacture documents it sends out. The thing being protected is the recipient, who never chose the
file and never sees the flag.

This is the crux, and it is a genuine tension between two of the owner's own positions rather than
an oversight in either.

## The three postures

**A. Strip unconditionally, everywhere the scrub runs.** `Names/JavaScript`, `OpenAction`, and `AA`
come out the way `XFA` and `EmbeddedFiles` already do, and the existing verification gate gains
assertions for them. Cost: a PDF whose legitimate behaviour depends on a script loses it — in
practice, calculation scripts on tax and court forms, which are common and which firms will notice.
No user-facing decision, no new surface.

**B. Strip, with a consent gate mirroring the macro strip.** The .docx path already has this shape:
the strip is the default, and a firm can opt a specific template out with an explicit acknowledgement
that is recorded. Cost: a real surface to build, and it puts a security question to someone who
cannot answer it well. Benefit: the calculation-script case has an answer that is not "give up".

**C. Refuse at registration.** A PDF carrying active content cannot become a template at all. Cost:
this is a block, and it contradicts the never-block ruling more directly than A does — though the
ruling was made about a person's own files, not about templates the platform executes over.

## Recommendation

**A for every path except template registration, and B for template registration.**

Stripping unconditionally is right everywhere the PDF is a _record_ — a conversion, a sealed
document, a discovery original. Nothing there needs to run, and a record that executes is a defect
whichever way you look at it.

Template registration is the one place where a script can be legitimate and where a person is
present, looking at the file, and able to say why they want it. That is exactly the situation the
macro-strip consent gate was built for, and reusing its shape means one idea rather than two.

If you want a single answer instead of two: **A everywhere.** It is honest, cheap, and the loss is
recoverable — a firm that needs a calculating form can be given the gate later, whereas a script
that reached a client cannot be recalled.

## What is NOT recommended

Leaning on the scan flag. It sees the problem and, by your own ruling, admits it anyway.

## If you pick a direction

The work is small and contained: three entries removed in `scrub.rs` beside the existing removals,
matching assertions in the verification gate that already checks `Names/Dests` and
`Names/EmbeddedFiles` survived nothing, and fixtures carrying each entry. Posture B additionally
needs the consent record and the surface, which is a slice rather than a fix.
