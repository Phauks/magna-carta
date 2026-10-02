---
number: 407
slug: an-organization-has-a-kind-a-jurisdiction-and-a-life
status: Proposed — deferred by the owner, 2026-08-30
date: 2026-08-30
area: Directory
summary: "directory_organization holds a legal name, a display name, the merge-graph status and timestamps, against a directory_person carrying five name parts, a member mapping and a six-column pronoun declension. The thinness is already causing harm inside the same schema: court_entity_id and estate_entity_id both point at directory_organization and neither can filter for what it points at, so a picker that must offer the courts has no column to read. It gains an organization_kind on a registered catalog, a formation jurisdiction, formation and dissolution dates, an organization_lifecycle_status deliberately not named status because that column is the merge-graph state and overloading it would be a live bug, and the legal form as registered so the match key's legal-form strip stays recoverable. Two organizations of the same name in different states are different legal persons, and the formation jurisdiction lets a conflicts reviewer see that in a second — as an attribute on the evidence, never as a filter, because suppressing a hit converts a fast dismissal into a missed conflict."
---

**An organization has a kind, a jurisdiction of formation, and a life with a beginning and an end.**

**Deferred by the owner, 2026-08-30.** The direction was that an organization stays "a basic group
combining individuals for now". So nothing below is built in this pass: no `organization_kind`
taxonomy, no `formation_jurisdiction`, no formation or dissolution date, no lifecycle status, no
`legal_form_text`.

**Recorded rather than dropped, because the finding that prompted it is still true.** The two columns
described below — `court_entity_id` and `estate_entity_id` — still point into
`directory_organization` and still cannot say what they are pointing at, so a picker that must offer
the courts has no column to filter on and a conflicts reviewer still has nothing to tell two
identically named organizations apart. Those costs are being carried deliberately rather than
overlooked.

**What makes the deferral cheap.** Every column below is a nullable `ALTER TABLE ADD COLUMN` against a
table whose existing rows stay valid, so building it later costs what building it now would cost.
Nothing in the contact-point work depends on it and nothing in it depends on the contact-point work.
The one thing to avoid meanwhile is encoding a kind of organization into a name or a category label,
because that is the shape that has to be unpicked rather than added to.

**Context:** `directory_organization` carries `legal_name`, `display_name`, the merge-graph `status`
and `merged_into_id`, `needs_review` and timestamps. Nothing else. `directory_person` beside it
carries five name parts, a member mapping, and a six-column pronoun declension with a completeness
constraint.

The harm is not hypothetical and it is already inside the same schema file. `court_entity_id` is
documented as "FK to `directory_organization.id` (the court)" and `estate_entity_id` as "the estate's
own record" — and there is no column on the row that distinguishes a court from an insurer from an
estate. A picker that must offer _the courts_ has nothing to filter on. A conflicts reviewer looking
at a tier-2 name agreement between two organizations called "Meridian Holdings" has nothing to tell
them apart.

**Decision:** `directory_organization` gains `organization_kind` (company, partnership, limited
liability company, sole proprietorship, trust, estate, nonprofit, government body, court, law firm,
insurer, bank, school, association, union, other — a registered catalog with an open CHECK and a
fitness probe, the same shape the identifier registry takes), `formation_jurisdiction`,
`formation_date`, `dissolution_date`, `organization_lifecycle_status` (active, dissolved, in
administration, struck off, unknown), and `legal_form_text` for the form as registered.

`organization_lifecycle_status` is **deliberately not named `status`**. That column already exists and
means the merge-graph state — `active` or `merged_into` — and an organization that is dissolved is
emphatically not an organization that was merged away into another directory record. Overloading it
would be a live bug the day someone wrote a dissolution.

`legal_form_text` earns its place because `normalized_match_key_bare` strips legal form to let
"Smith & Jones LLP" meet "Smith & Jones LLC" one step weaker; storing the form keeps that strip
recoverable rather than discarded.

**Formation jurisdiction disambiguates a conflicts hit and must never suppress one.** Two
organizations with the same name in different states are different legal persons, and the temptation
is to let the engine drop the hit. It must not. The mismatch is recorded as an attribute on the
evidence so a reviewer dismisses it in a second; the hit still surfaces. Suppression would convert a
fast dismissal into a missed conflict, which is the single failure this engine exists to prevent, and
it would break the standing guarantee that raising strictness can only add candidates.

**Considered and rejected:** schema.org's subtype tree (`Corporation`, `GovernmentOrganization`,
`NGO`) — a type system's answer, and this is a database, so the kind is a column; a per-firm
organization-kind table (firms would diverge on what a trust is, and a picker would differ per
tenant); making `organization_kind` `NOT NULL` (every existing row would be invalidated, and
expand-contract forbids it — the route contract requires it instead, while the column stays nullable);
reusing `status` for the lifecycle.

**Consequences:** the court and estate links become filterable the day the column exists. A conflicts
reviewer gets a jurisdiction beside a name agreement. The cost is one more required field at
organization creation, and a catalog whose granularity is an open owner question — sixteen values
covers a general practice and a firm doing municipal or tribal work will want more.
