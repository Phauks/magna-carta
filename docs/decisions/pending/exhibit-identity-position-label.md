---
slug: exhibit-identity-position-label
status: Proposed
area: Documents
date: 2026-08-11
summary: "An exhibit is three facts that are never the same fact: a matter-scoped identity (`matter_exhibit`, carrying a symbolic `reference_name` minted once from the title and thereafter independent of it), a position in an ordered `exhibit_set`, and a label that is a pure function of position and the set's scheme — computed on read while the set is a draft, never stored. In-text references cite the identity and render the label, through a fourth placeholder form `{{@referenceName}}` that is deliberately neither a merge field nor an expression: a merge key is a platform-declared fact of the matter checked at template registration, and an exhibit is a firm-authored instance created during drafting, so binding one as the other would either make the subject registry firm-derived or make every reference a registration error. A multi-exhibit citation enumerates its members (`{{@leaseAgreement,@rentLedger,@noticeToQuit}}`) and the renderer computes the phrasing, because a two-endpoint range survives an insertion syntactically and dies semantically. Word's SEQ/bookmark/REF machinery is rejected on its own documented behaviour — fields do not update automatically, and an attached exhibit offers no in-document target to bookmark — while its cross-reference dialog is adopted as the insertion model; LaTeX's symbolic \\label/\\ref is the mechanism taken, because a number that never appears in the source is a number an author cannot make stale."
---

**Model an exhibit as identity, position, and label — three separately-changing facts — and make an
in-text reference a fourth placeholder form that cites identity and renders label, so a reorder moves
every citation at once and no author can write a number down.**

**Context:** A litigation matter generates exhibit lists from the exhibits attached to a document, and
the titles of those exhibits change over time while the exhibits are reordered. The naive reading is
"render a list from a collection"; the actual difficulty is that three things must stay in agreement
and each moves independently — the attachment (which has its own versions), the label (a pure function
of position, so an insertion renumbers everything after it), and every in-text reference a person
wrote in prose. A stale in-text reference pointing at the wrong exhibit is the defect the feature
exists to prevent, and it is worse than having no feature because the document looks correct. The
platform already carries the substrate: the assembly engine with repeating blocks whose own worked
example is an `exhibits` collection that has never existed, the expression language whose first open
question names `exhibits` as the list source it needs, the File Manager version model, and the design
system's merge-field picker and chip.

**Decision:** Adopt the model designed at
docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md. `matter_exhibit` is matter-scoped
identity, because the employment agreement is one thing that is Exhibit C to the motion and Exhibit 7
at trial and a per-set row would make those unreconcilable records. Its `reference_name` is minted
once from the title in lower camel form, unique per matter, and is thereafter independent of the
title — the same move the custom-fields engine made in binding by handle rather than by name, and for
the same reason. `exhibit_set` is an ordered membership for one document carrying its own numbering
scheme; `exhibit_set_member` is a position. The label is `labelFor(position, scheme)` in a pure module
that reads no clock, no database, and no firm setting, computed on every read of a draft set and never
stored — the calendar's rule that a fact which is a function of two other facts must not also be a
column, because three renumber-sweep write paths are three chances to be wrong where one function is
one test. An in-text reference is `{{@referenceName}}` with a closed catalog of rendering forms
(`full`, `bare`, `titled`, `asIssued`) checked statically through the `:format` suffix machinery that
already exists. It is a distinct placeholder form rather than a merge field, on three shipped rules:
subjects are platform-declared and never firm-derived, a template is registered once for every matter
before any exhibit exists so every reference would be `expression-unknown-key`, and a merge key names
a fact of the matter while an exhibit reference names an instance in one document. It is not an
expression either, because it would resolve against a scope the dictionary does not own, at a time the
checker does not run, over names the platform does not declare — three holes in the property the
language's security argument rests on. A multi-exhibit citation is a comma-separated list of names and
the phrasing is computed at render, so "Exhibits B through D" becomes "Exhibits B, D, and F" after an
insertion instead of silently acquiring a member nobody cited. Insertion is through a picker that
writes the token and a chip that renders its current resolution; detecting existing prose references
is a reported proposal a human confirms and never an applied rewrite, exactly as detected merge-field
conversions are.

**Consequence:** A new pure package `@magna-carta/exhibits` on the matter-assets and calendar seam,
four per-firm tables, and two matter-rooted permissions. `@magna-carta/document-assembly` gains an
`exhibits` subject that is collection-only on the `assetClass` precedent (no scalar facet, because a
set with one exhibit is not the normal case), the caller-supplied `ResolutionInput.exhibitSetId` on the
`assetsAsOfDate` pattern, and the token's recognition inside the existing run-reassembly pass rather
than a second scanner. This closes the expression-language design's first open question by supplying
the first list-valued dictionary source whose membership a caller chooses. Bytes never touch an exhibit
route: an exhibit is a link over a `file` the ingest chokepoint already produced, as
`matter_asset_document` is. `exhibit_reference` records which immutable `file_version` cites which
exhibit, written in the batch that files the version, and is acceptable as an index for the reason the
template field-binding index is: neither side ever changes, so there is no staleness mode. Reference
resolution fails an assembly rather than rendering a placeholder — a missing clause is invisible and a
wrong citation is confidently wrong — with a withdrawn exhibit the one warn-rather-than-fail case.
Eight owner flags carry recommended defaults the design already implements; the letter overflow form
past Z (`AA, BB, CC` versus `AA, AB, AC`) is wire-visible and wants an answer before the first firm.
