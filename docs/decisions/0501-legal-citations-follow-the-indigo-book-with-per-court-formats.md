---
number: 501
slug: legal-citations-follow-the-indigo-book-with-per-court-formats
status: Accepted
date: 2026-11-09
area: Documents
summary: "Legal citations are one pure engine (`@magna-carta/citations`) behind a stand-alone tool and embeddable components. The rules come from The Indigo Book (CC0), never the Bluebook's copyrighted text or trademarked name; a pasted link is read first and typed fields override it; each court or state is a format of differences on a base style, resolved document, then matter court, then matter state, then firm default."
---

**Legal citations follow the Indigo Book, read from a link first, with per-court formats.**

**Context:** The owner asked (2026-11-09) for the Bluebook rules of citation as a general feature,
usable as a stand-alone tool and inside other components; then that a pasted link should be parsed
for details with manual entry as an override, and that states have different formats. The Bluebook's
text is copyrighted and its name a trademark its publisher has enforced against a compatible project.

**Decision:** Implement the Uniform System of Citation from The Indigo Book (CC0), citing its rule
numbers, labelled "Uniform System (Indigo Book)". The California Style Manual is a second base style.
One pure package recognizes links and rough citations, keeps per-field provenance (link, lookup,
typed; typed wins), formats full, short and id. forms, and resolves formats. Design-system components
(`FormattedCitation`, `CitationField`) and a `/legal-citations` tool consume it. Case lookups go
through Worker adapters (CourtListener, govinfo, later Westlaw/Lexis through the legal-research port).

**Consequences:** No surface hand-assembles a citation. Formats are reviewed data like the trust
profiles. Lookups cost a provider token and are rate-limited, so the engine works offline for
self-describing links and rough citations and marks unread fields rather than guessing. Design:
`docs/specs/2026-11-09-legal-citations-design.md`.
