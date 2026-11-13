# Community & Feedback Forum

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Community -->

- id: community
  name: Community and feedback forum
  scope: Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
  status: partial
  adrs: ADR-0044
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: The domain package (packages/community), the control-plane tables, the board's own worker (apps/community-worker, the API, the read-only and off switch, noindex on every answer), the one-time sign-in link from the app, and the board's screens (requests, questions, a post, the composer, the roadmap, known issues and the team's moderation, under apps/web/src/routes/community-board/) are built and tested; the worker's first deploy waits on the owner. Board home layout: option A, list with a product-area rail, picked by the owner 2026-11-10.

- id: community.board
  name: Feedback board
  scope: Feature requests with popularity-ranked upvotes, comments, tags, status pipeline, and roadmap-as-filtered-view-by-status.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Posting, voting (distinct-firm ranking, counts below five withheld), comments, the status pipeline with decline reasons, duplicates, accepted answers and the roadmap-by-status counts are built in packages/community/src/board-service.ts and tested against the control-plane schema, served by apps/community-worker under /api/, and drawn by the live screens under apps/web/src/routes/community-board/ (rerouted from the community host by apps/web/src/hooks.ts), the roadmap columns and the team's moderation queue and triage included.
  audience: public
  public-name: Feature requests and voting
  public-summary: Ask for what your firm needs, vote on what other firms have asked for, and see what we decided and why.
  awaiting-owner: Connect the magna-carta-community worker to Workers Builds and set COMMUNITY_HANDOFF_SECRET on it and on magna-carta; nothing on the community host is live until then.

- id: community.package
  name: Extractable community package
  scope: Clean @magna-carta/community package, platform-level and isolated from the per-firm data-access layer.
  status: shipped
  surface: internal
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: packages/community, isolated from the firm-scoped data-access layer by test/package-isolation.test.ts.

- id: community.confidentiality
  name: Confidentiality boundary
  scope: Posting always opt-in and user-authored; nothing flows automatically from private matters or the private bug pipeline into the public forum.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Format-only detector (packages/community/src/confidentiality-detector.ts) holds posts and comments that look like client detail; one confidentiality flag hides; author delete is one write. The composer warns before posting detected detail; "send to support instead" waits on an app route to receive it.

- id: community.identity
  name: Display-name identity and SSO
  scope: Better Auth SSO with display-name-only public identity; real name/firm never shown; aggregate vote counts only.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Separate community_profile record with a display name; firm written at write time and never returned; voter list never read. Sign-in is a one-minute, one-use link from the app (GET /api/v1/me/community-handoff) redeemed by the board's worker into its own host-only session.

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
  status: partial
  surface: awaiting-screen
  slices: service-status
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: The board's worker reads the status page's own store through the same public merge (apps/community-worker/src/known-issues.ts) and the Known Issues screen and the board's side panel show its unresolved events; it reaches readers once the board's worker is deployed.
  awaiting-owner: Connect the magna-carta-community worker to Workers Builds; the screen is not reachable until the board is deployed.

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
  status: deferred
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Design ships the board first with a dormant discussion seam for later.

- id: community.moderation
  name: Moderation and abuse handling
  scope: Permanent moderation, spam/abuse, and security operation of a public board, owned in-house.
  status: partial
  surface: awaiting-screen
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: First-contribution hold, detector hold, single-flag confidentiality hide, three-firm spam threshold, and the publish/remove decision are built in the package; the moderation screen and the read-only kill switch arrive with the worker.
