---
number: 391
slug: a-seed-is-the-whole-supply-so-an-ungranted-permission-is-a-refusal
status: Proposed
date: 2026-08-19
area: Access control / RBAC
summary: "Nine of the twelve registered permissions that no role_permission seed granted are seeded: the four co-editing keys the chokepoint has enforced since 2026-06-22 (documents:edit and documents:checkout to the three content-writing seats, documents:reconcile to Owner/Admin and Attorney, documents:forceReleaseLock to Owner/Admin alone) and five Tools catalogue manifests (the four public-record link libraries to every default role, the shipping tile to Owner/Admin, matching shipping:manage). The other three are correct and stay ungranted: firm:provision and support:mintSession ride surface: public routes whose RBAC gate the chokepoint skips, and diagnostics:overview is carried by a diagnostic support session rather than by any firm role. The load-bearing fact behind all of it is that role_permission and direct_grant have no write statement anywhere in the product, so the migration seeds are the entire supply and an ungranted permission is a permanent refusal rather than a default a firm can change. Whether documents:forceReleaseLock should also reach Attorney is left as an owner question on the ledger."
---

**A permission the seeds do not grant is not a default a firm can change. It is a refusal nobody can
lift, and it is indistinguishable from a firm having configured things that way.**

**Context.** The permission registry declares 102 keys. The `role_permission` seeds across
`packages/database/drizzle` granted 90. Twelve were declared and granted to nobody, and the question
that decides what to do about them is whether anything else can supply a permission. Nothing can:

- `effectivePermissions` (`packages/access-control/src/resolver.ts`) is the union of the member's
  role rows and their unexpired direct grants. No wildcard, no owner bypass, no namespace fallback.
- `packages/data-access` has exactly two statements touching either table and both are `SELECT`
  (`selectMemberPermissionsStatements`). Nothing in `apps/worker` writes `role_permission` or
  `direct_grant`. The role-editor surface is `not-started` on the ledger and the access-request half
  that would write a direct grant is `partial` with nothing writing a row.
- Firm provisioning assigns a member to a role; it does not create or amend a role's grants.

So the seeds are the whole supply, and there is no narrow-then-widen path a firm can walk on its own.
That is the fact that makes this a defect rather than a configuration choice, and it is also what
constrains how narrow a new seed may safely be.

**Decision, permission by permission.**

| Permission                    | Seeded to                          | Why that set                                                                                                                    |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `documents:edit`              | Owner/Admin, Attorney, Paralegal   | Where `files:upload`, `files:organize` and `documents:assemble` already sit — cutting a version by typing is cutting a version   |
| `documents:checkout`          | Owner/Admin, Attorney, Paralegal   | The offline form of the same act; check-in rides it, or taking a copy out is a trap                                             |
| `documents:reconcile`         | Owner/Admin, Attorney              | Decides the firm's text of record and can set aside a colleague's work — the `files:delete` / `esign:seal` bracket               |
| `documents:forceReleaseLock`  | Owner/Admin                        | Displaces another member's hold; an override every editor also holds is not an override                                         |
| `tools:propertyListings`      | every default role                 | A public-record link: reads nothing of the firm's, holds no credential, stores nothing                                          |
| `tools:propertyRecords`       | every default role                 | Same                                                                                                                             |
| `tools:businessLookup`        | every default role                 | Same                                                                                                                             |
| `tools:attorneyLicense`       | every default role                 | Same                                                                                                                             |
| `tools:shipping`              | Owner/Admin                        | Matches `shipping:manage`, which gates every operation behind the tile                                                          |
| `firm:provision`              | **nobody, correctly**              | `surface: "public"`; the chokepoint skips session, authn and RBAC for it and a header-token guard does the work                 |
| `support:mintSession`         | **nobody, correctly**              | Same lane                                                                                                                        |
| `diagnostics:overview`        | **nobody, correctly**              | Carried by a diagnostic support session via `resolveSupportPermissions`, never by a firm role                                    |

**Why the four link libraries reach Read-only.** The comparison that decides it is the one already
made for `notifications:read` against `trust:read`: what matters is not how many seats a key reaches
but whether holding it reveals anything the member could not already reach. These four open a
government or listing website in a new tab. Every other credential-less lookup in the catalogue —
`tools:whois`, `tools:safeBrowse`, `tools:fileIntegrity`, `tools:fileTypeVerifier`,
`tools:metadataScrubber`, `tools:aiTextDetection`, `tools:emailInspector` — is already seeded to all
five, and a Read-only seat asked to check whether an opposing lawyer is in good standing should not
need a role change to answer.

**Why these five were ungranted at all, which is not the same story as the editing keys.** They are
the only five tools declared in the baseline registry under the comment "Role-seeding lands with the
Tools UI shell". The shell landed — the listing page is `shipped` with a real screen — and the
seeding did not follow it. Every tool added to the catalogue afterwards shipped with its own seed in
the same commit, and eleven of the thirteen seeded tools have no page of their own and render as
"Soon", so the repository's own practice is grant-then-build-page. These five are the residue of a
promise, not a policy of withholding.

**Considered and rejected.**

- **Seeding `documents:forceReleaseLock` alongside the editing keys.** It would make the override
  reachable by everyone it can be used against, which is not an override. Rejected on that, not on
  risk: the act is recoverable and audited on both sides.
- **Seeding `documents:reconcile` to Paralegal.** A paralegal is exactly the member who takes a copy
  offline and diverges it, so it is tempting to let them close their own conflict. But the choice
  discards or promotes a version of the firm's document, and the paralegal is not the member
  answerable for its text. The conflicting copy is retained forever either way, so nothing is lost by
  routing the decision upward.
- **Leaving the five Tools keys ungranted until each tool has a page.** Rejected on the repository's
  own precedent above: eleven seeded tools have no page, and withholding these five is what kept four
  whole subject groups off the page rather than showing them as "Soon" like the rest.
- **Granting the three platform keys to Owner/Admin for consistency.** Rejected: two of them gate
  nothing (the chokepoint skips RBAC on a public surface) and the third would hand every member of
  every firm the help-desk diagnostic view that the support-tier split exists to keep separate.

**Left open, and flagged rather than decided.** Whether `documents:forceReleaseLock` should also
reach **Attorney** — the member responsible for a matter, who may need to free a document when the
firm's administrator is away — is a product judgement about how a small firm actually works, not a
repair. The narrow version is built and the question is recorded as an `awaiting-owner:` line on
`documents.editing.checkout` in the feature ledger, so it appears on the decision desk. Widening a
seed later is one additive migration; narrowing one is a conversation with every firm that had got
used to the wider default.

**Consequences.** Additive migration only — thirty `INSERT`s into `role_permission`, no schema
statement, no `OR REPLACE`, nothing that touches an existing grant. A firm provisioned before it
receives the rows when its `FirmDatabase` Durable Object next wakes and applies pending migrations,
and permissions are resolved per request, so the capability appears on the member's next request with
no re-login. The editing suites were rewritten to hold seeded roles rather than the direct grants
they had been inserting for themselves, so each denial they assert is now a claim about the seed
rather than about the test's own setup. The remaining reach problem is unchanged and is not this
decision's to solve: there is still no surface by which a firm can grant, revoke, or create anything
— `auth.access-control.role-editor-ui` and the write half of
`auth.access-control.access-requests`.
