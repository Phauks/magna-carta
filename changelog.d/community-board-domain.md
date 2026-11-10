---
category: Added
audience: internal
---

**Community board, domain and storage.** A new `@magna-carta/community` package holds the rules for
the public feature-request and question board that will live on `community.magnacarta.esq`: posting
into one of seventeen product areas (there is no general area), voting ranked by distinct firms with
counts below five withheld, comments with a marked team reply, the request status pipeline (New,
Future, Planned, Building now, Beta, Completed, Not on the roadmap with a required reason, and
Duplicate), accepted answers on questions, and moderation that holds a first contribution and
anything a format-only detector reads as a case name, docket or matter number, email, phone number
or an amount beside a name. One confidentiality flag hides a post; spam needs three firms. Five
additive control-plane tables back it (`community_profile`, `community_post`, `community_vote`,
`community_comment`, `community_flag`). The package cannot reach a firm's own database, held by a
test. No route or screen yet; the board's worker and its screens follow.
