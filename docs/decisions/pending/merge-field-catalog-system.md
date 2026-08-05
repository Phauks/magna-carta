---
slug: merge-field-catalog-system
status: Proposed
area: Document automation / merge-field catalogue
date: 2026-08-05
summary: "The merge-field catalogue scales to hundreds of fields as a CROSS PRODUCT of two small registries — subjects (the things a document talks about) and facets (the facts about a subject of that kind) — materialized into the same flat, exactly-matched key list every consumer already takes, rather than as hundreds of hand-written rows. A facet is a different FACT and gets a key; a format is the same fact rendered differently and gets a suffix, which is what keeps a catalogue of hundreds from being a catalogue of thousands: structured `name` and `address` value types carry the renderings, formats stay a closed named set with no arguments and no chaining, and composition is the expression language's job. Presentation metadata (label, group, subject, prominence, synonyms, examples) moves ONTO the dictionary entry so the merge-field catalog contract becomes its projection rather than a second catalogue. Keys are permanent, defaults are frozen, absence may only become more visible, and withdrawal is deprecation with an immutable per-version field-binding index making impact answerable. Facts the platform does not record — matter staffing, court/case identity, estate identity, party capacity — land as their owning AREA'S records with merge fields as a consumer, each costing exactly one batched read, so the source count goes from six to twelve while the field count goes from twenty-nine to roughly two hundred and sixty."
---

**The merge-field catalogue is generated from subjects crossed with facets, formats render facts
rather than duplicating them, and every shipped key is permanent.**

**Context:** Slice 2·6 shipped a declarative merge-field dictionary of 29 hand-written entries with
the right properties — one batched read per source, absence as a declared decision, ambiguity as an
answer, registration-time checking, binding by stable identity. The owner's ask on 2026-08-05 is for
the catalogue a firm's documents actually need: "hundreds of potential items … along with various
ways to format them. dates, multiple attorneys and types of attorneys on both sides, names of the
estate, and so much more." Nothing in the engine's mechanism is wrong at that size; three things
about how the catalogue is written down are. Hand-written rows become a copy-and-paste field where
one row in ten quietly diverges from its siblings. The presentation metadata a picker needs lives in
`packages/merge-field-catalog-contract`'s fixture rather than on the dictionary entry, which is
already a second catalogue describing keys the engine does not have. And a six-value grouping axis
puts a hundred and thirty rows under one heading.

**Decision:**

1. **The catalogue is a cross product, not a list.** A **subject** registry (the matter, each party
   role, each staffing role, the office, the firm, the court, the case, the estate) crossed with a
   **facet** registry (name, address, email address, phone, capacity, title, the firm's own entity
   fields, the `.all` collection) materializes the flat `DictionaryEntry[]` every consumer already
   takes. Roughly forty declared rows produce roughly two hundred and sixty keys. The shape
   generalizes what `DIRECTORY_ROLE_SOURCES` already does for four roles and three facets, for the
   reason recorded there: a hand-written copy per role is one chance per copy to give a sibling a
   different absence behaviour. The mistake mode inverts — a generated error is systematic and every
   test sees it at once, where a hand-written one is local and invisible.

2. **A facet is a different fact; a format is the same fact rendered differently.** The test that
   settles it: could both renderings appear in the same sentence about the same thing? "Ashcroft,
   Rowan" and "Rowan Ashcroft" cannot, so `lastFirst` is a format on one key; a party's name and a
   party's capacity can, so they are two keys. Structured `name` and `address` value types carry the
   parts the renderings need — the Directory already stores both. Formats stay a **closed named set
   per value type**, checked at registration by the shipped `legalFormatsFor` table: no arguments
   (a format string is a second little language with its own parser, fuzzing obligation, and escape
   from closed-set checking) and no chained suffixes (`{{= upper(client.displayName)}}` already
   composes, visibly, in the language built for it). The alternative — a key per rendering — would
   multiply the catalogue by about four and put twelve near-identical rows in front of an author
   choosing a client's name.

3. **The shipped `displayName` key gains the name formats rather than acquiring a `name` sibling**,
   with its default rendering byte-identical to today's, so no registered template changes behaviour.
   Two keys for one fact would sit in front of every author forever, which is precisely the confusion
   the facet-versus-format rule exists to prevent. The cost accepted is an odd-looking suffix on a
   key whose label reads "Client's name" anyway. **A rendering that needs a fact the record does not
   carry is an absence with a reason, never a fallback to a different rendering** — an organisation
   asked for a family name, or a record whose name was never split, produces a marker and a sentence,
   because a plausible-looking wrong name is the failure nobody catches by reading.

4. **Presentation metadata lives on the dictionary entry.** `label`, `group`, `subject`,
   `prominence`, `synonyms`, per-format example renderings, `status`, and `tags` join the entry;
   `availability` is derived from source and subject optionality rather than declared three hundred
   times. The catalog contract becomes the entry's projection, its fixture becomes a checked
   projection rather than an invention, and its value-type union is pinned to the engine's instead of
   drifting beside it. One home per fact, applied to the catalogue itself.

5. **Keys are permanent; defaults are frozen; withdrawal is deprecation.** A shipped key is never
   renamed, retyped, re-sourced, or removed — a committed golden key list makes that a test rather
   than a promise. A default format never moves, because the manifest records a format only when the
   author overrode one, so changing a default silently changes every document every existing template
   produces; new renderings ship as new format names. Absence behaviour may move in one direction
   only, toward a more visible hole. A withdrawn key is `deprecated` with `supersededBy`: it still
   resolves, it leaves the picker's default view, and the field inspector names its replacement.
   Impact is answerable because registration writes an immutable
   `document_template_field_binding (template_version_id, merge_key)` row per key — which the
   custom-fields hard-delete guard's own objection ("a second copy of a fact the manifest already
   states, with its own way of going stale") does not reach, since a template version is immutable and
   a row derived from it in the same batch has no update path and therefore no staleness mode.

6. **New facts land as their owning area's records, with merge fields as a consumer.** Matter
   staffing (`matter_assignment`), the court-case record (`matter_court_case`, including the two
   designation words that make a caption read in its own jurisdiction's vocabulary), the estate
   record (`matter_estate`, whose style is **stored rather than composed** because a designation a
   court has fixed is not a string a template may invent), and `matter_party.capacity`. The available
   alternative — leaving all of it to per-firm custom fields — is rejected for the platform core
   because a custom-field key is a per-firm handle, so a template written against it is not portable,
   not shareable as starter content, and not nameable in platform documentation. The tail stays
   custom fields; the facts every firm in a practice area records get platform keys.

7. **Side is not a key axis, and capacity composes in the resolver.** `side × role × type` would
   double every key for a fact most matters lack, force probate and transactional work into a
   two-sided shape they do not have, and fix a vocabulary (plaintiff/defendant versus
   petitioner/respondent versus appellant/appellee) that is jurisdiction- and posture-specific. Side
   is recorded once on the court-case record as the words that court uses. Likewise a capacity phrase
   — "Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased" — is a single
   `capacityLine` facet composed from three declared facts with **one absence for the whole phrase**,
   rather than three placeholders a template concatenates into stray punctuation when one is missing.

8. **Ambiguity resolves to nothing with a reason at every level of a key's path**, not only at the
   subject. Which link fills a slot (shipped), which of a subject's addresses or emails is meant
   (primary wins; no primary and exactly one resolves it; no primary and several is an absence naming
   the count), and the same questions per item inside a collection. One rule learned once.

**Consequences:** The field count goes from 29 to roughly 262 platform keys plus a firm's own, while
**the read count goes from six sources to twelve** — a subject costs no read at all (it is a pass over
rows already in memory, the shipped role-source property generalized) and a facet costs at most one
read once, shared across every subject. Four new per-firm tables (`matter_assignment`,
`matter_court_case`, `matter_estate`, `document_template_field_binding`), one new column
(`matter_party.capacity`), and one optional firm-typed input (a role-alias map, the only place a
firm's own words enter platform key resolution, and they enter as a declared mapping rather than a
guess). Two new value types, eleven new formats, and no moved default. The `documentAutomation` load
profile widens automatically, because its probe template already declares every key the firm's
dictionary offers. Bar numbers and tax identifiers become the first `sensitivity: protected` entries,
under the existing decrypt-permission-plus-audit path, with one rule added: a protected facet on a
subject that resolved ambiguously is an absence **before** any decryption is attempted, so an
assembly cannot leave a decrypt trail for a party the document never names.
