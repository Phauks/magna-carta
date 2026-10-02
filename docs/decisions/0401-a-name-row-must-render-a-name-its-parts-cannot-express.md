---
number: 401
slug: a-name-row-must-render-a-name-its-parts-cannot-express
status: Proposed
date: 2026-08-30
area: Directory
summary: "A directory_name row carries five Western name parts plus a lowercased normalized display that is the FTS5 content column, and the human-readable form is reconstructed by joining the parts. So a mononym, a family-name-first name and a name with a particle all render wrong in a name history, in a search hit and in anything assembled from one. A display_text column holds the name exactly as written and is never derived, following FHIR HumanName's text element, which exists for precisely this; normalized_display and both match keys are untouched, so nothing about search or duplicate detection changes. The role catalog also gains legal and preferred, because goes-by-Bob-legal-name-Robert can only be recorded as an alias today, which is correct for conflicts and wrong for a salutation. A repeating middle-name table is rejected: NIEM and vCard both allow many, one column holding Anne Marie has cost nobody anything, and a table would be a join on every name read."
---

**A name row must be able to render a name its parts cannot express.**

**Context:** `directory_name` carries `name_prefix`, `name_given`, `name_middle`, `name_family`,
`name_suffix`, and `normalized_display` — the lowercased, stripped form that is the FTS5 content
column and a frozen contract across every firm. There is no column holding the name as a human would
write it, so the display in a name history or a search hit is reconstructed by joining the parts.

That reconstruction is wrong for a mononym, for a name written family-first, and for a name with a
particle whose capitalization and spacing carry meaning. It is wrong in a name **history**, which is
the one place a firm looks to see what a person was called — and the platform's whole name-corpus
argument is that a search must be able to report which name a hit landed on so the reader can tell it
is not the current one.

FHIR's `HumanName` carries a `text` element holding the name as it should be rendered, alongside the
parts, for exactly this reason.

**Decision:** `directory_name` gains `display_text` — the name exactly as written, never derived from
the parts and never overwritten by them. `normalized_display`, `normalized_match_key` and
`normalized_match_key_bare` are untouched, so search, duplicate detection and the conflicts name
channels behave identically.

`NAME_ROLES` gains `legal` and `preferred`. "Goes by Bob, legal name Robert" can only be recorded as
`alias` today, which is the correct answer for conflicts and the wrong answer for a salutation merge
field. Neither addition disturbs the balanced default set, and `over_inclusive` searches every role by
construction, so the guarantee that raising strictness only adds candidates holds without an edit.

The schema comment on `name_role` is corrected in the same change: it currently documents a catalog of
`legal`, `preferred`, `maiden` and `trading` that no code has ever written, while the catalog in use
is `current`, `former`, `alias`, `aka`, `maiden`, `dba`.

**Considered and rejected:** a repeating middle-name table — NIEM allows `PersonMiddleName [0..*]` and
vCard's `N` takes a comma-separated list of additional names, but one column holding "Anne Marie" has
cost nobody anything and a table would be a join on every name read; documented as a known limitation
instead. Also rejected: deriving `display_text` from the parts when it is absent (that is the current
behaviour and the bug); adopting FHIR's required, non-extensible name-use value set verbatim
(`anonymous` and `temp` are clinical concerns and `dba` and `trading` are legal ones FHIR has no word
for).

**Consequences:** a name history renders correctly for a name the five Western parts cannot decompose,
and a firm can record a legal name and a preferred name as different things rather than as one name
and an alias. The cost is one nullable column and a write path that must stop treating the joined parts
as authoritative.
