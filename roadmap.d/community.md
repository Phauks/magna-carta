# Community & Feedback Forum

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: community
  name: Community and feedback forum
  scope: Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
  status: partial
  adrs: ADR-0044
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: The board's backend is built — control-plane schema, packages/community, apps/community-worker — and every screen is unbuilt. Sequencing and the reconciliation of the two surfaces into one board are settled in the 2026-08-11 design.

- id: community.board
  name: The board — one surface, two post kinds
  scope: Requests (votable, status pipeline, on the roadmap) and questions (votable answers, no pipeline) on one board; distinct-firm ranking, the roadmap as a projection by status, and a question converting to a request in one operator action.
  status: partial
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: Backend built (packages/community, apps/community-worker, one control-plane migration); no screens. Follow-on plan: docs/specs/2026-08-13-community-board-remaining-slices-plan.md.

- id: community.board.screens
  name: Board screens
  scope: The category index, the post and thread, the composer, the roadmap board, and the operator's moderation queue.
  status: not-started
  spec: docs/specs/2026-08-13-community-board-remaining-slices-plan.md
  evidence: apps/web is untouched; the routes the screens consume are live and enumerated in the plan.

- id: community.board.tenancy
  name: The cross-firm tenancy exception
  scope: The board's records in control-plane D1 with a never-rendered firm identifier, argued as a named exception to the firm-scoped data-access rule rather than assumed.
  status: shipped
  evidence: Decision recorded and enforced structurally — a deployable with no per-firm binding, a package that cannot import the firm-scoped layer, and a projection chokepoint whose public types have no firm field; each guarded by a test.

- id: community.package
  name: Extractable community package
  scope: Clean @magna-carta/community package, platform-level and isolated from the per-firm data-access layer.
  status: shipped
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: packages/community holds the taxonomy, the detector, the ranking, the projections, the contract and the statement builders, declares its own SQL interface, and is held isolated by test/purity.test.ts.

- id: community.confidentiality
  name: Confidentiality boundary
  scope: Posting always opt-in and user-authored; nothing flows automatically from private matters or the private bug pipeline into the public forum.
  status: shipped
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: Enforced in three places rather than one — apps/community-worker binds no per-firm resource, packages/community imports no per-firm module, and the format-only detector never consults a firm's records. Remove-first removal is built: a one-write author delete, a single confidentiality report hiding the subject, and a null-actor moderation record for every automatic hide.

- id: community.identity
  name: Display-name identity and SSO
  scope: Better Auth SSO with display-name-only public identity; real name/firm never shown; aggregate vote counts only.
  status: shipped
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: Real display name by default with an account-level pseudonym permitted, a staff badge, the firm rendered nowhere, the voter list never returned, and the distinct-firm count withheld below five firms. The board profile is a record of its own, so the display name is never the account's name column.

- id: community.escalation-bridge
  name: Private-report escalation bridge
  scope: One-way, user-opted escalation of a private diagnostic report into a public feature request or known-issue check.
  status: designed
  adrs: ADR-0038
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Specified; the private incident pipeline it bridges from is shipped (slice 0-6).

- id: community.known-issues
  name: Known-issues view
  scope: Public known-issues view mirroring the live status content.
  status: designed
  slices: service-status
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: The KV status source it mirrors is shipped (packages/status); the forum view is design-only.

- id: community.changelog-sync
  name: Shipped-items changelog sync
  scope: Requests marked shipped sync to the changelog; popular requests inform the roadmap.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Specified as a read of the product-updates artifact; neither side is built.

- id: community.agent-status-posts
  name: Agent status posts
  scope: Maintenance/diagnostics agents post public status on known issues, propose-only, never exposing privileged detail.
  status: designed
  adrs: ADR-0016
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Propose-only agent posture decided; no board for them to post to.

- id: community.discussion
  name: Open discussion forum
  scope: General peer-discussion forum beyond the feedback board.
  status: not-planned
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: Still not built, and now with the reference product as the evidence: it has no first-party discussion forum and closed the request for one. The dormant discussion seam was woken instead as the board's second post kind, which is scoped to product usage.

- id: community.moderation
  name: Moderation and abuse handling
  scope: Permanent moderation, spam/abuse, and security operation of a public board, owned in-house.
  status: partial
  spec: docs/specs/2026-08-11-community-surfaces-design.md
  evidence: The operator surface is built — a queue with confidentiality first, hide/restore/remove, status with a required decline reason, convert, merge, first-write approval, and a key-value kill switch that takes every write read-only with no deploy. Scheduled archive and triage sweeps and a distributed rate limiter are in the follow-on plan.
