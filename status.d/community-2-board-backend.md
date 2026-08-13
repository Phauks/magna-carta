---
slice: Community surfaces 2 — the board backend
group: cross-cutting
order: 92
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 5"
built: done by="Opus 5"
ui: todo
load-profile: n/a
tested: done by="Opus 5"
branch: claude/community-board
active-work: docs/active-work/claude/community-board.md
next: The screens, and the changelog back-link plus the subscriber-carry notification.
link-spec: docs/specs/2026-08-11-community-surfaces-design.md
link-plan: docs/specs/2026-08-13-community-board-remaining-slices-plan.md
adrs:
blocked-by:
---

**Surfaces two and three of the community design, reconciled into one board with two post kinds,
built backend-first.** Control-plane schema (six tables plus the post-number sequence pair), the
`@magna-carta/community` package (category taxonomy, format-only confidentiality detector,
distinct-firm ranking with a display floor, public projections, statement builders), and
`apps/community-worker` — a new deployable binding the control-plane database and one key-value
namespace and nothing else, which is what replaces the per-firm database boundary on the platform's
one deliberately cross-firm surface. Public to read, signed-in member of a provisioned firm to
write, platform operator to moderate. Remove-first confidentiality: one-write author delete, single
report hides, format-only detector with a null-actor moderation record, and a key-value kill switch
built with the first write endpoint. Load profile `[-]`: no per-firm data surface and no per-firm
binding exists for one.

**Deferred to later slices, with the plan as their home:** every screen (`apps/web` is untouched);
the changelog back-link and the subscriber-carry notification email; the RSS feed; the scheduled
archive and triage sweeps as cron rather than operator-invoked routes; attachments (off by design at
launch); Turnstile on the write path; and the generated typed client, which needs the board's
OpenAPI document folded into the client pipeline.

**One question is open for the owner and is in the plan:** how a session token reaches
`community.magnacarta.esq`, given that the platform's session cookie is host-only by deliberate
design. Reads are unaffected; writes need an answer before the board is reachable in production.
