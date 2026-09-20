# Self-Serve Provisioning and Entitlements

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Signing up and plans -->

- id: self-serve
  name: Self-serve provisioning and entitlements
  scope: A stranger founding a firm without a platform operator, the free evaluation tier and what it withholds, the entitlement mask that enforces it, the lifecycle of an abandoned tenant, and the seam a future payments integration fills.
  status: partial
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The provisioning half of the design is built — apps/api-worker/src/routes/session/registrations.ts and apps/api-worker/src/firm-provision-consumer.ts turn a confirmed registration into a real firm off the request path. The entitlement half is not: there is no tier catalog, no tier column, no quota ceiling and no upgrade-required refusal anywhere in the tree.
  audience: public
  public-name: Signing up and plans
  public-summary: Start a firm yourself, evaluate it free, and move to a paid plan later without any of your work moving anywhere.
  notes: Pricing, the terms of service, payments themselves and per-subject erasure are all outside this capability; the design defines the seam a payments integration writes through and builds none of it.

- id: self-serve.registration
  name: Self-serve firm registration
  scope: The platform's one anonymous write — a visitor declares which of three doors they came through, and founding a firm writes one control-plane row and sends one email, with the firm built after the emailed link is followed.
  status: shipped
  surface: screen
  slices: 0-7b-auth-ui-deferred-surfaces
  adrs: ADR-0280
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: apps/api-worker/src/routes/session/registrations.ts holds both stages behind the public surface and the shared attempt budget, answering identically whether an address is free or taken; apps/api-worker/src/firm-provision-consumer.ts runs the shipped provisioner off a transactional-outbox row, keyed by the registration handle rather than by the firm's name, with the human name in firm.display_name in packages/database/src/control-plane-schema.ts.
  notes: Reachable end to end — apps/web/src/routes/register asks for an address and a password and nothing else, and register/confirm spends the emailed token through confirmRegistration, which now hands back a session so the visitor lands on the joining screen rather than at the front door. The three-way door fork is gone; register/firm and register/invitation survive unlinked, for a registration started before the reflow. The human-verification gate is mounted on this endpoint (enforceHumanVerification in apps/api-worker/src/routes/session/registrations.ts) but resolves to the not-configured verifier while TURNSTILE_SECRET_KEY is unset, and the default posture is fail-open, so the address-keyed attempt budget is what actually stands between the endpoint and a script today.

- id: self-serve.firm-lifecycle
  name: Firm lifecycle states
  scope: The states a firm passes through beyond provisioning — dormant, suspended, closing and closed, plus the read-only state a lapsed subscription lands in — and the activity signal that moves it between them.
  status: designed
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The firm status column in packages/database/src/control-plane-schema.ts carries the provisioning lifecycle only; the extended vocabulary, the materialized last-activity instant and the sign-in rules per state are specified and unwritten.
  notes: Only an active firm is enumerated by the fleet-wide sweep, which is what makes dormancy a cost recovery rather than a step toward deletion — the recurring cost of an abandoned tenant is recovered long before anything is destroyed.

- id: self-serve.reaping
  name: Reaping an abandoned tenant
  scope: The warning ladder for a free workspace nobody has touched, what destruction means when it finally happens, and which firms may never be proposed for it at all.
  status: designed
  adrs: ADR-0049, ADR-0084
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The ladder, the split between a never-activated tenant and a used-then-abandoned one, and the three recorded acts of destruction are specified over the shipped crypto-shred mechanism in apps/api-worker/src/firm-key-shred.ts; no sweep, no destruction request and no notice exists.
  awaiting-owner: The clock. Notices, dormancy, suspension, an export window and only then a proposal to destroy — the design proposes a ladder measured in months from last human activity, with a much shorter one for a tenant that was provisioned and never used, and settles none of the numbers. What turns on them is how long the platform carries a stranger's abandoned workspace and how much warning a lawyer who went quiet actually receives; the design deliberately recovers the recurring cost early in the ladder so the platform is never under cost pressure to shorten the destruction end of it. Self-serve provisioning design flag F2.
  notes: A firm holding client money, any hold, or any custody packet out is never auto-proposed at all, and a final notice that was not delivered stops the clock rather than counting as a warning.

- id: self-serve.entitlements
  name: Entitlement model
  scope: A tier catalog in code naming permission keys, a per-firm tier and its overrides in the control plane, and the mask that intersects a principal's permissions with what their firm's tier permits at the one existing chokepoint.
  status: designed
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The catalog module beside packages/access-control/src/registry.ts, the tier and verification columns, the override table and the isolate-local resolution on the pattern in apps/api-worker/src/usage/consent.ts are all specified and none is written; apps/api-worker/src/chokepoint/chokepoint.ts gains one denial branch rather than a step.
  awaiting-owner: Whether a withheld capability can be metered rather than locked. The container-backed tools — recognition, conversion, repair, unlocking — cost real compute per invocation, and a handful of runs demonstrates the tool while a locked button demonstrates nothing. Metering is a third enforcement shape, a counter with a period beside the mask and the quota ceilings, and it is real work; the alternative is to lock them for the first version and say so plainly in the catalog. Self-serve provisioning design flag F6.
  notes: This is a mask over the existing permission vocabulary, not a second authorization system — no vocabulary of its own, no enforcement point of its own, no per-route declaration; the only new thing on the wire is which refusal a denial renders.

- id: self-serve.entitlements.quotas
  name: Quota ceilings
  scope: The numeric limits — stored bytes, members, matters, files — checked where they are consumed rather than at the permission chokepoint, and refused with the same upgrade-required answer.
  status: designed
  adrs: ADR-0078
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The measurement is already built and reused rather than rebuilt — the incremental per-firm storage rollup behind apps/api-worker/src/routes/firm/firm-usage.ts — and the checks at presign, at version commit and in each subsystem's create path are specified and unwritten.
  awaiting-owner: The free tier's actual numbers: the storage ceiling, the member ceiling and the matter ceiling. This is the flag the founding-a-firm screen is waiting on — it already tells a visitor their firm starts on the free tier while nothing in the tree defines what that tier is, and the registration screen, the upgrade panel, the refusal body and the enforcement are all meant to read the same catalog so a limit cannot be right in one place and stale in another. Two recommendations on shape rather than value: the member ceiling is the single most effective anti-abuse limit and should be small, and the storage ceiling should be small enough that an abandoned free tenant's bytes are never individually worth worrying about. Self-serve provisioning design flag F1.
  notes: An over-quota firm is never deleted down to fit — new writes are refused and everything it already holds stays.

- id: self-serve.free-tier
  name: Free evaluation tier
  scope: What a free workspace withholds and why — the capabilities withheld because an unverified firm should not do them, and the ones withheld because they spend real money or a scarce account resource per use.
  status: designed
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The withheld list is specified key by key against the shipped permission registry — trust accounting, invoice finalization, the platform seal, the discovery loading act, the assistant and its search index, the container-backed tools, capture addresses, postage and the client portal — and nothing enforces any of it.
  awaiting-owner: Whether trust accounting unlocks on verification or for any paying firm. The design argues verification: a card proves somebody will pay and does not prove a real practice is holding real client funds, and withholding trust from a free tenant is also what makes the rule against reaping a firm holding client money absolute rather than a judgement call. Unlocking it for any paying firm is a real revenue edge and it means an unverified stranger with a card keeps a ledger the platform's own jurisdiction rules have not certified. Self-serve provisioning design flag F3.
  notes: The lock list is short on purpose — matters, the directory, conflicts, time, costs, documents, automation, custody, the calendar and search are all deliberately not withheld, because a free tier that showcases nothing showcases nothing.

- id: self-serve.verification
  name: Firm verification
  scope: A second axis beside the tier — evidence that a real practice exists — unlocking the capabilities withheld for integrity rather than for cost.
  status: designed
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: Specified as a verification column beside the tier, with the mask taking the intersection of both so that paid-but-unverified and free-but-verified are each expressible; no column, no check and no operator surface exists.
  awaiting-owner: What verification is at launch — a human reviewing each firm, or an attestation the firm makes that a person spot-checks and an operator can revoke. Review is stronger and becomes a bottleneck at exactly the volume self-serve exists to reach; attestation plus spot-check is the recommendation, and it decides whether this ships as a review queue or as a form. Either way there is no national registry to call and per-state scraping is a maintenance liability, so the first version records a claimed bar number and jurisdiction and control of a matching domain, and must never be worded anywhere as though the platform checked something it did not. Self-serve provisioning design flag F4.

- id: self-serve.upgrade-seam
  name: Upgrade and lapse seam
  scope: The single writer that moves a firm's tier, what a future payments integration must supply to call it, and what happens to a paid firm whose subscription lapses.
  status: designed
  spec: docs/specs/2026-08-10-self-serve-firm-provisioning-and-entitlements.md
  evidence: The design defines the seam and builds none of it: one internal writer that sets the column, records the act and invalidates the cached resolution, reachable today from an operator-guarded route on the working template in apps/api-worker/src/routes/platform/platform-release-channel.ts and tomorrow from a payments integration. Nothing writes a tier because no tier column exists.
  notes: On upgrade nothing moves — the firm, its bucket, its database and every byte stay exactly where they are and one column changes, which is the property a shared workspace for free tenants would destroy. A lapsed paid firm is never reaped and is never downgraded to the free tier: it goes read-only with export open, indefinitely, because applying free-tier ceilings to a firm holding real matters means either destroying data to fit or leaving it permanently over-quota.
