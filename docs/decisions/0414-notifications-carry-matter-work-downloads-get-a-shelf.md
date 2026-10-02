---
number: 414
slug: notifications-carry-matter-work-downloads-get-a-shelf
status: Accepted
date: 2026-08-31
area: Reports
summary: "The notification feed carries what happened to the firm's WORK; a file the platform generated is platform mechanics and never enters it (owner ruling, 2026-08-31). Downloads get their own register instead: a per-member shelf at /downloads listing what the platform produced for that member, held for a short retention window and downloadable again until it expires. Two row kinds share one table because the member asks one question: a kept ARTIFACT points at bytes that cannot be re-derived (a bulk bundle, a conversion result) and re-downloads as a freshly minted presigned GET; a kept SNAPSHOT stores the tabular export DOCUMENT rather than a rendered file, so every format stays available from one row and the figures are frozen rather than recomputed. The register hands out links and never moves bytes, so the browser's own download manager keeps pause and resume. It is a shelf, not a history and not the file room: filing an export to a matter remains a separate audited act. Spec: docs/specs/2026-08-31-download-register-design.md."
---

**A notification is about the firm's work. A generated file is not, and it gets a shelf of its own.**

**Context:** The export framework and the server-side Word/PDF printer landed with nowhere for their
output to live: a member who closed the tab lost the artifact, and the two genuinely asynchronous
producers (bulk bundles, conversions) are addressed only by a handle the caller must already be
holding, with state confined to a Durable Object and an R2 object and no D1 row anywhere recording
that a member ever asked. Routing completions through the notification feed was considered and
rejected by the owner: that surface is where a firm looks for its own business, and platform
mechanics would dilute it.

**Decision:** as the summary states, with the shape and bounds in the spec. The choices worth
holding to when this grows:

- **No producer raises a notification to say an artifact is ready.** It writes a row on the shelf.
  The two surfaces stay separate in both directions.
- **The register never proxies bytes.** It mints links, because the browser's download manager owns
  pause, resume and speed and a standing convention forbids taking that back.
- **A snapshot stores the document, not the file** — the platform already holds that an export is a
  document and formats are renderers, so one row serves every format and none of them can disagree
  about the figures.
- **The shelf is per member.** A colleague's exports are not the reader's business; a firm-wide or
  administrative view is a different question with a different key.
- **Retention is short and swept**, aligned with the artifact prefixes' own lifecycle rules. The
  register must never be the reason an object outlives its rule.
