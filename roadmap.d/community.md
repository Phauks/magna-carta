# Community & Feedback Forum

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Community -->

- id: community
  name: Community and feedback forum
  scope: Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
  status: designed
  adrs: ADR-0044
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Native-build design on main (amending ADR-0044 away from self-hosted Fider after the 2026-06-17 tool survey); no code. Implementation explicitly deferred to a later slice.

- id: community.board
  name: Feedback board
  scope: Feature requests with popularity-ranked upvotes, comments, tags, status pipeline, and roadmap-as-filtered-view-by-status.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Board-first build shape specified; no code.
  audience: public
  public-name: Feature requests and voting
  public-summary: Ask for what your firm needs, vote on what other firms have asked for, and see what we decided and why.
  awaiting-owner: Two calls, both on the open pull request. Whether to ratify a named exception to the firm-scoped data rule, since a shared board is cross-firm by definition; and how a signed-in member's session reaches the community host, which is a different origin from the application.

- id: community.package
  name: Extractable community package
  scope: Clean @magna-carta/community package, platform-level and isolated from the per-firm data-access layer.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Packaging pattern specified; the precedent packages it copies (packages/government-links, packages/property-links) are shipped.

- id: community.confidentiality
  name: Confidentiality boundary
  scope: Posting always opt-in and user-authored; nothing flows automatically from private matters or the private bug pipeline into the public forum.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Non-negotiable boundary specified in the design and ADR-0044; the package isolation is the enforcement mechanism.

- id: community.identity
  name: Display-name identity and SSO
  scope: Better Auth SSO with display-name-only public identity; real name/firm never shown; aggregate vote counts only.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Specified; Better Auth foundation shipped (slice 0-4) as substrate.

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
  status: deferred
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Design ships the board first with a dormant discussion seam for later.

- id: community.moderation
  name: Moderation and abuse handling
  scope: Permanent moderation, spam/abuse, and security operation of a public board, owned in-house.
  status: designed
  spec: docs/specs/2026-06-17-community-feedback-board-design.md
  evidence: Acknowledged as an owned commitment in the design; no tooling exists.
