---
number: 434
slug: activity-names-its-rows-in-the-owning-source-behind-its-own-permission
status: Accepted
date: 2026-09-02
area: Calendar
summary: "The matter's Activity section names its rows through a `describe` declared on each timeline source, run server-side after the merge for the one matter in scope and gated by a `permission` the source now declares, rather than the client re-reading each subsystem's own listing and joining by row identity. The federated projection stays as thin as the day it shipped: a firm-wide read is never described, and a source without a describe keeps the platform's sentence. The client's half is an `ActivityContribution` that lives beside the owning subsystem's own code and is registered in one list, paired to the server's registry by a scanning test and to the section registry by a coverage lint, so a subsystem joining the timeline touches nothing in the Activity section itself."
---

**A consolidation view cannot know what its rows are. Only the subsystem that owns a row can name it,
and it names it once, on the server, for the one matter the reader is standing in.**

**Context:** The federated timeline deliberately projects no content — a source declares a
non-privileged label or declares that it has none — because the read spans every matter and a note's
opening words on it are a disclosure. The first Activity screen honoured that on the server and then
undid it on the client: for each of six sources it read that subsystem's own first page through its
own route and joined by row identity. That was right in principle (a signed-in member standing inside
a matter is not withheld from) and wrong in two ways in practice. The words were decided in the
Activity section's own files rather than the subsystem's, so a file's type was a name suffix instead
of the file manager's identification, and every new source was a change to the screen. And "the
subsystem's first page" named a row only if it happened to be on that page: a document older than the
Files section's first page showed no name, silently.

**Decision:** Two additions to the timeline source declaration, and one registry on the client.

- `permission: Permission | null` on every source: the read capability a description of its rows
  sits behind, named from the same registry matter-search names its capabilities from. It gates the
  description and nothing else. The entry itself carries no content, so a member who may not read
  notes still sees that a note was written; what they do not see is what it said.
- `describe?: (request) => SqlStatement[]` on a source whose rows have names: one statement through
  `describeSelect`, which binds the matter, the page's row ids, the visibility predicate and the
  LIMIT, and projects the fixed `row_id / title / type_text / facts_json` columns. The matter-scoped
  timeline route asks for it after the merge, at most one statement per source present on the page,
  so the cost scales with the registry and never with the rows. The firm-wide read never asks.
- `ActivityContribution` on the client, one per source key, living beside the owning subsystem's own
  web code and registered in `apps/web/src/lib/activity/contributions.ts`. It says how the source's
  rows read — the section word, the type word, the glyph, the facts as label and value — how a row
  opens, and how one is made. A scanning test fails on any source key without a contribution, and
  `lint:matter-timeline-coverage` fails on any source no section owns and has not declared ownerless.

**Consequences:** The Activity section names no source and switches on none; adding a subsystem to
the chronology is a describe on its source and a contribution beside its code. The description's
`facts_json` is the subsystem's own vocabulary, read only by its own contribution, so the timeline
never learns what a file or a time entry is made of. The label discipline on the projection is
unchanged and asserted: the firm-wide read is described by nothing, whatever it asks for.

**Alternatives considered:** Keeping enrichment on the client and reading by identity through each
subsystem's own batch endpoint — six requests per page and six endpoints to add, for a read the server
already makes in one round. Projecting titles on the federated read for a member who holds every
permission — wrong at the root, because the projection spans matters and the discipline is about the
read's shape, not the reader. A stored activity table — refused already, and still refused.
